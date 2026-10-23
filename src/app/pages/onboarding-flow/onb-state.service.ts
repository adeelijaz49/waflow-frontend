import { Injectable, computed, inject, signal } from '@angular/core';
import { OnbApiService } from './onb-api.service';
import type { OnbState } from './onb.types';

const TOKEN_KEY = 'waflow_auth_token';
const HINT_KEY = 'waflow_onb_hint';
const LANDED_KEY = 'waflow_onb_landed';
const MAX_RETRIES = 2;
const MIN_FORCED_GAP_MS = 5000;
// A failed first load is retried on a LATER navigation, never within this gap of the failure (no hammering).
const RETRY_GAP_MS = 2000;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function ssSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the hint is only an optimisation */
  }
}
function ssRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** FNV-1a 32 bit hash as hex: stored instead of the token (never the token itself). */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// A definitive answer is not worth retrying; a transient one (network, timeout, 429, 5xx, no HTTP status) is.
function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

// HTTP 404 (flag off / unknown route) and 403 ONBOARDING_NOT_AVAILABLE both mean "not enrolled".
function isNotEnrolledAnswer(err: unknown): boolean {
  const e = err as { status?: unknown; error?: { code?: unknown } } | null;
  if (e?.status === 404) return true;
  return e?.status === 403 && e.error?.code === 'ONBOARDING_NOT_AVAILABLE';
}

/** Where a merchant belongs right now (pure; null = nowhere special / not enrolled / finished). */
export function landingUrlOf(s: OnbState | null | undefined): string | null {
  if (!s || s.enrolled !== true) return null;
  const sub = s.subscription?.state ?? 'none';
  if (sub === 'none' || sub === 'pending' || s.view === 'billing') return '/setup/billing';
  if (s.view === 'done') return null;
  switch (s.nextStep) {
    case 'business': return '/setup/business/name';
    case 'number': return s.number?.paused === true || s.progress?.status === 'paused_number' ? '/setup/number/paused' : '/setup/number';
    case 'connect': return '/setup/connect';
    case 'approvals': return '/setup/approvals';
    case 'customers': return '/setup/customers';
    case 'products': return '/setup/products';
    case 'promotion': return '/setup/promotion';
    case null: return null;
    default: return '/setup';
  }
}

// The one place the app asks "is this workspace enrolled in the onboarding flow?" (recipe of HubStateService /
// LocalizationFlagService): one cached GET /api/onboarding/state per login token, fail-open (any error = not enrolled).
@Injectable({ providedIn: 'root' })
export class OnbStateService {
  private readonly api = inject(OnbApiService);

  readonly state = signal<OnbState | null>(null);
  readonly loaded = signal(false);
  readonly failed = signal(false);

  readonly enrolled = computed(() => this.state()?.enrolled === true);
  readonly subState = computed(() => this.state()?.subscription?.state ?? 'none');
  readonly takeover = computed(() => this.enrolled() && (this.subState() === 'none' || this.subState() === 'pending'));
  readonly finished = computed(() => this.enrolled() && this.state()?.view === 'done');
  readonly locked = computed(() => this.enrolled() && this.state()?.locked === true);
  readonly landingUrl = computed(() => landingUrlOf(this.state()));
  readonly remindersPending = computed(() => {
    if (!this.finished()) return false;
    const p = this.state()?.prompts;
    const open = (v: string | undefined): boolean => v === 'pending' || v === 'skipped';
    return open(p?.customers?.state) || open(p?.products?.state);
  });
  readonly hostNeeded = computed(() => this.enrolled() && (this.takeover() || !this.finished() || this.remindersPending()));
  readonly level = computed(() => this.state()?.connection?.level ?? null);
  readonly sendingPaused = computed(() => this.state()?.sendingPaused ?? null);
  readonly unread = computed(() => {
    const n = this.state()?.notifications?.unread;
    return typeof n === 'number' && n > 0 ? n : 0;
  });

  /** Set by the shadow route components while they are on screen (the late redirect must not fire then). */
  shadowActive = false;

  private pending = false;
  private seq = 0;
  private loadedToken: string | null | undefined = undefined;
  private transientFailure = false;
  private retriesLeft = MAX_RETRIES;
  private lastAnswerAt = 0;
  private lastForcedAt = 0;
  private failedAt = 0;
  private readonly waiters = new Set<() => void>();
  private readonly sessionEndListeners = new Set<() => void>();
  private landedMemory: string | null = null;

  /**
   * Registers a function that clears the PER-LOGIN data a service keeps in memory (the customers list, the help sheet's contacts, the
   * test-message choice ...). It runs when the session ends (logout, no token any more) and when another login token replaces the one
   * the answer was loaded for, exactly when this service forgets the previous merchant's state (R6-13). A listener that throws never
   * stops the others or the reset itself.
   */
  onSessionEnd(listener: () => void): void {
    this.sessionEndListeners.add(listener);
  }

  private notifySessionEnd(): void {
    for (const listener of Array.from(this.sessionEndListeners)) {
      try {
        listener();
      } catch {
        /* the previous merchant's data is cleared on a best-effort basis: never block the reset */
      }
    }
  }

  /** Token-aware and idempotent; never throws; no token = forget everything and make no request. */
  ensureLoaded(): void {
    if (!readToken()) {
      if (this.loadedToken !== undefined || this.loaded() || this.pending) this.reset();
      return;
    }
    this.load();
  }

  /** Forced reload (>= 5 s apart). A failed refresh keeps the last good answer. */
  refresh(): void {
    if (!readToken()) return;
    const now = Date.now();
    if (now - this.lastForcedAt < MIN_FORCED_GAP_MS) return;
    this.lastForcedAt = now;
    this.load(true);
  }

  /** refresh() for enrolled sessions only, and only when the last answer is older than minAgeMs. */
  refreshIfStale(minAgeMs: number): void {
    if (!this.enrolled()) return;
    if (Date.now() - this.lastAnswerAt < minAgeMs) return;
    this.refresh();
  }

  load(force = false): void {
    const token = readToken();
    if (!token) {
      if (this.loadedToken !== undefined || this.loaded() || this.pending) this.reset();
      return;
    }
    if (this.loadedToken !== undefined && token !== this.loadedToken) {
      // another merchant/session in the same SPA session: the previous answer must never leak
      this.state.set(null);
      this.loaded.set(false);
      this.failed.set(false);
      this.transientFailure = false;
      this.retriesLeft = MAX_RETRIES;
      this.lastAnswerAt = 0;
      this.lastForcedAt = 0;
      force = true;
      this.notifySessionEnd();
    }
    if (this.loaded() && !force) return;
    if (this.pending && !force) return;
    this.loadedToken = token;
    const mine = ++this.seq;
    this.pending = true;
    this.transientFailure = false;
    const hadGood = this.loaded() && !this.failed() && this.state() !== null;
    this.api.getState().subscribe({
      next: (s) => {
        if (mine !== this.seq) return;
        this.pending = false;
        const answer: OnbState = s && typeof s === 'object' && s.enrolled === true ? s : { enrolled: false };
        this.state.set(answer);
        this.failed.set(false);
        this.loaded.set(true);
        this.lastAnswerAt = Date.now();
        this.writeHint(token, answer.enrolled === true);
        this.settle();
      },
      error: (err: unknown) => {
        if (mine !== this.seq) return;
        this.pending = false;
        if (isNotEnrolledAnswer(err)) {
          this.state.set({ enrolled: false });
          this.failed.set(false);
          this.loaded.set(true);
          this.lastAnswerAt = Date.now();
          this.writeHint(token, false);
        } else if (hadGood) {
          // a failed refresh must not un-enrol a working session: keep the last good answer
          this.transientFailure = false;
        } else {
          this.failed.set(true);
          this.failedAt = Date.now();
          this.transientFailure = isTransient(err);
          this.loaded.set(true);
        }
        this.settle();
      },
    });
  }

  /** A transient failure of the first call is retried (max 2 per login session) on the next navigation. */
  retryIfFailed(): void {
    if (!this.failed() || !this.transientFailure || this.pending || this.retriesLeft <= 0) return;
    if (Date.now() - this.failedAt < RETRY_GAP_MS) return;
    if (readToken() !== this.loadedToken) return;
    this.retriesLeft--;
    this.load(true);
  }

  /**
   * For router guards: resolves the state, or null (no token / hint says legacy / failed / timeout). Never rejects.
   * Without a token no request is made, so the existing route's own authGuard behaves exactly as today.
   */
  resolveForGuard(maxWaitMs: number): Promise<OnbState | null> {
    try {
      const token = readToken();
      if (!token) return Promise.resolve(null);
      const answered = (): OnbState | null =>
        this.loaded() && !this.failed() && this.loadedToken === token ? this.state() : null;
      if (this.loadedToken === token && this.loaded()) return Promise.resolve(answered());
      if (this.hintFor(token) === '0') {
        this.ensureLoaded();
        return Promise.resolve(null);
      }
      this.ensureLoaded();
      if (this.loadedToken === token && this.loaded()) return Promise.resolve(answered());
      return this.awaitSettled(maxWaitMs, answered);
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Forced reload that resolves with the new answer (null on failure/timeout). Not throttled: used by the checkout return. */
  reloadNow(maxWaitMs = 4000): Promise<OnbState | null> {
    const token = readToken();
    if (!token) return Promise.resolve(null);
    this.lastForcedAt = Date.now();
    const answered = (): OnbState | null => (this.loaded() && !this.failed() && this.loadedToken === token ? this.state() : null);
    const waiting = this.awaitSettled(maxWaitMs, answered);
    this.load(true);
    return waiting;
  }

  private awaitSettled(maxWaitMs: number, answered: () => OnbState | null): Promise<OnbState | null> {
    return new Promise<OnbState | null>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.waiters.delete(finish);
        if (timer !== undefined) clearTimeout(timer);
        resolve(answered());
      };
      this.waiters.add(finish);
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.waiters.delete(finish);
        resolve(null);
      }, Math.max(0, maxWaitMs));
    });
  }

  /** True ONCE per login token (first landing after login/payment); false afterwards and without a token. */
  firstLandingThisSession(): boolean {
    const token = readToken();
    if (!token) return false;
    const mark = fnv1a32(token);
    if (ssGet(LANDED_KEY) === mark || this.landedMemory === mark) return false;
    this.landedMemory = mark;
    ssSet(LANDED_KEY, mark);
    return true;
  }

  /** Optimistic local update after a successful write. */
  patch(partial: Partial<OnbState>): void {
    const s = this.state();
    if (s) this.state.set({ ...s, ...partial });
  }

  /** Logged out / token changed: forget the previous merchant's answer (a late answer for them is ignored). */
  reset(): void {
    this.seq++;
    this.pending = false;
    this.loadedToken = undefined;
    this.transientFailure = false;
    this.retriesLeft = MAX_RETRIES;
    this.lastAnswerAt = 0;
    this.lastForcedAt = 0;
    this.state.set(null);
    this.failed.set(false);
    this.loaded.set(false);
    ssRemove(HINT_KEY);
    this.notifySessionEnd();
    this.settle();
  }

  private settle(): void {
    for (const w of Array.from(this.waiters)) w();
  }

  private writeHint(token: string, enrolled: boolean): void {
    ssSet(HINT_KEY, `${fnv1a32(token)}:${enrolled ? 1 : 0}`);
  }

  private hintFor(token: string): '0' | '1' | null {
    const raw = ssGet(HINT_KEY);
    if (!raw) return null;
    const [hash, flag] = raw.split(':');
    if (hash !== fnv1a32(token)) return null;
    return flag === '0' ? '0' : flag === '1' ? '1' : null;
  }
}
