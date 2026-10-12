import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { LocalizationSettings } from '../localization.types';

const TOKEN_KEY = 'waflow_auth_token';
function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// R1-06: how often a failed FIRST settings load is retried per login session (see retryIfFailed()).
const MAX_RETRIES = 2;

// A definitive answer ("not allowed / not available / logged out") is not worth retrying; a transient one
// (network error, timeout, 429, 5xx, anything without an HTTP status) is.
function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

// Shared state for the hub and every tab inside it: the merchant's
// localisation settings (including the per-merchant arabic_enabled flag).
// Loaded once by the hub shell; tabs read the signals and call update() after
// they change something.
@Injectable({ providedIn: 'root' })
export class HubStateService {
  private readonly api = inject(LocalizationApiService);

  readonly settings = signal<LocalizationSettings | null>(null);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly enabled = computed(() => this.settings()?.arabicEnabled === true);

  // In-flight guard: shell, tabs and the existing screens (via LocalizationFlagService) may all ask
  // before the first answer arrives; only ONE settings request runs at a time. A forced reload starts
  // a newer request and the older answer is ignored (seq).
  private pending = false;
  private seq = 0;
  // The login token the current answer belongs to (undefined = nothing requested yet). The settings are
  // per merchant: when another token is logged in inside the same SPA session (no page reload) the
  // previous merchant's answer is dropped and requested again, so a flag never leaks across workspaces.
  private loadedToken: string | null | undefined = undefined;
  // R1-06: the last load failed for a transient reason, and how many retries are left for this login session.
  private transientFailure = false;
  private retriesLeft = MAX_RETRIES;

  load(force = false): void {
    const token = readToken();
    if (this.loadedToken !== undefined && token !== this.loadedToken) {
      this.settings.set(null);
      this.loaded.set(false);
      this.failed.set(false);
      this.transientFailure = false;
      this.retriesLeft = MAX_RETRIES; // another merchant/session: a fresh budget
      force = true;
    }
    if (this.loaded() && !force) return;
    if (this.pending && !force) return;
    this.loadedToken = token;
    const mine = ++this.seq;
    this.pending = true;
    this.failed.set(false);
    this.transientFailure = false;
    this.api.getSettings().subscribe({
      next: (s) => {
        if (mine !== this.seq) return;
        this.pending = false;
        this.settings.set(s);
        this.loaded.set(true);
      },
      error: (err: unknown) => {
        if (mine !== this.seq) return;
        this.pending = false;
        this.failed.set(true);
        this.transientFailure = isTransient(err);
        this.loaded.set(true);
      },
    });
  }

  // R1-06: a TRANSIENT failure of the settings call would otherwise leave a flagged merchant without the
  // Arabic controls until a page reload. LocalizationFlagService calls this on every router NavigationEnd:
  // it re-requests at most MAX_RETRIES times per login session, only after such a failure, never while a
  // request is in flight, never for a 401/402/403/404 answer and never when the token changed (load()
  // already started a fresh request for that, so something is pending). A success never retries, so an
  // unflagged merchant still makes ONE request.
  retryIfFailed(): void {
    if (!this.failed() || !this.transientFailure || this.pending || this.retriesLeft <= 0) return;
    if (readToken() !== this.loadedToken) return;
    this.retriesLeft--;
    this.load(true);
  }

  // Logged out: forget the previous merchant's settings (a late answer for them is ignored).
  reset(): void {
    this.seq++;
    this.pending = false;
    this.loadedToken = undefined;
    this.transientFailure = false;
    this.retriesLeft = MAX_RETRIES;
    this.settings.set(null);
    this.failed.set(false);
    this.loaded.set(false);
  }

  update(patch: Partial<LocalizationSettings>): void {
    const current = this.settings();
    if (current) this.settings.set({ ...current, ...patch });
  }
}
