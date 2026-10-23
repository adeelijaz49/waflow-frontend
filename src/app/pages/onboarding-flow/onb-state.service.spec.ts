import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { OnbApiService } from './onb-api.service';
import { OnbStateService, fnv1a32, landingUrlOf } from './onb-state.service';
import type { OnbState } from './onb.types';

const TOKEN_KEY = 'waflow_auth_token';

interface Rig { svc: OnbStateService; calls: Subject<OnbState>[]; getState: ReturnType<typeof vi.fn> }

function rig(token: string | null = 'token-A'): Rig {
  TestBed.resetTestingModule(); // a test may build several rigs
  localStorage.clear();
  sessionStorage.clear();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  const calls: Subject<OnbState>[] = [];
  const getState = vi.fn(() => {
    const s = new Subject<OnbState>();
    calls.push(s);
    return s;
  });
  TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { getState } }] });
  return { svc: TestBed.inject(OnbStateService), calls, getState };
}

const enrolled = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'business', ...over,
});

describe('OnbStateService: requests', () => {
  afterEach(() => vi.useRealTimers());

  it('makes exactly one request per token however often it is asked', () => {
    const { svc, getState, calls } = rig();
    svc.ensureLoaded();
    svc.ensureLoaded();
    svc.load();
    expect(getState).toHaveBeenCalledTimes(1);
    calls[0].next(enrolled());
    svc.ensureLoaded();
    svc.load();
    expect(getState).toHaveBeenCalledTimes(1);
    expect(svc.loaded()).toBe(true);
    expect(svc.enrolled()).toBe(true);
  });

  it('makes no request without a token', () => {
    const { svc, getState } = rig(null);
    svc.ensureLoaded();
    svc.load();
    svc.refresh();
    expect(getState).not.toHaveBeenCalled();
    expect(svc.loaded()).toBe(false);
    expect(svc.enrolled()).toBe(false);
  });

  it('a token change drops the previous merchant answer immediately and loads again', () => {
    const { svc, getState, calls } = rig('token-A');
    svc.ensureLoaded();
    calls[0].next(enrolled());
    expect(svc.enrolled()).toBe(true);
    localStorage.setItem(TOKEN_KEY, 'token-B');
    svc.ensureLoaded();
    expect(svc.state()).toBeNull();
    expect(svc.enrolled()).toBe(false);
    expect(getState).toHaveBeenCalledTimes(2);
    calls[1].next({ enrolled: false });
    expect(svc.enrolled()).toBe(false);
    expect(svc.loaded()).toBe(true);
  });

  it('logout (token removed) resets state and clears the hint; a late answer for the old merchant is ignored', () => {
    const { svc, calls } = rig();
    svc.ensureLoaded();
    localStorage.removeItem(TOKEN_KEY);
    svc.ensureLoaded();
    expect(svc.loaded()).toBe(false);
    calls[0].next(enrolled()); // late answer
    expect(svc.state()).toBeNull();
    expect(sessionStorage.getItem('waflow_onb_hint')).toBeNull();
  });

  it('a stale answer (older request) is ignored when a forced reload started a newer one', () => {
    const { svc, calls } = rig();
    svc.ensureLoaded();
    svc.load(true);
    calls[0].next(enrolled({ nextStep: 'number' }));
    expect(svc.state()).toBeNull();
    calls[1].next(enrolled({ nextStep: 'connect' }));
    expect(svc.state()?.nextStep).toBe('connect');
  });

  it('refresh is throttled to 5 s and a failed refresh keeps the last good answer', () => {
    vi.useFakeTimers();
    const { svc, getState, calls } = rig();
    svc.ensureLoaded();
    calls[0].next(enrolled());
    svc.refresh();
    svc.refresh();
    expect(getState).toHaveBeenCalledTimes(2);
    calls[1].error({ status: 500 });
    expect(svc.enrolled()).toBe(true);
    expect(svc.failed()).toBe(false);
    vi.advanceTimersByTime(5001);
    svc.refresh();
    expect(getState).toHaveBeenCalledTimes(3);
    calls[2].error({ status: 404 }); // the flag was switched off server-side: now definitively not enrolled
    expect(svc.enrolled()).toBe(false);
  });

  it('refreshIfStale only refreshes enrolled sessions with an old answer', () => {
    vi.useFakeTimers();
    const { svc, getState, calls } = rig();
    svc.refreshIfStale(1000);
    expect(getState).not.toHaveBeenCalled();
    svc.ensureLoaded();
    calls[0].next({ enrolled: false });
    vi.advanceTimersByTime(60000);
    svc.refreshIfStale(1000); // legacy session: never refreshes after its first answer
    expect(getState).toHaveBeenCalledTimes(1);

    const second = rig();
    second.svc.ensureLoaded();
    second.calls[0].next(enrolled());
    second.svc.refreshIfStale(15000);
    expect(second.getState).toHaveBeenCalledTimes(1); // fresh answer
    vi.advanceTimersByTime(16000);
    second.svc.refreshIfStale(15000);
    expect(second.getState).toHaveBeenCalledTimes(2);
  });
});

describe('OnbStateService: session end listeners (R6-13)', () => {
  it('runs every listener when the login token changes (the state of the previous merchant is dropped at the same moment)', () => {
    const { svc, calls } = rig('token-A');
    const first = vi.fn();
    const second = vi.fn();
    svc.onSessionEnd(first);
    svc.onSessionEnd(second);
    svc.ensureLoaded();
    calls[0].next(enrolled());
    expect(first).not.toHaveBeenCalled(); // an ordinary first load is not a session end
    localStorage.setItem(TOKEN_KEY, 'token-B');
    svc.ensureLoaded();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(svc.state()).toBeNull();
  });

  it('runs them on logout (the token is removed) too', () => {
    const { svc } = rig();
    const gone = vi.fn();
    svc.onSessionEnd(gone);
    svc.ensureLoaded();
    localStorage.removeItem(TOKEN_KEY);
    svc.ensureLoaded();
    expect(gone).toHaveBeenCalledTimes(1);
    svc.ensureLoaded(); // nothing left to forget: no second run
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('does not run them for reloads with the same token, forced refreshes or a failed refresh', () => {
    vi.useFakeTimers();
    try {
      const { svc, calls } = rig();
      const gone = vi.fn();
      svc.onSessionEnd(gone);
      svc.ensureLoaded();
      calls[0].next(enrolled());
      svc.ensureLoaded();
      svc.load(true);
      calls[1].error({ status: 500 });
      vi.advanceTimersByTime(6000);
      svc.refresh();
      expect(gone).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a listener that throws never stops the others or the reset', () => {
    const { svc, calls } = rig();
    const after = vi.fn();
    svc.onSessionEnd(() => {
      throw new Error('boom');
    });
    svc.onSessionEnd(after);
    svc.ensureLoaded();
    calls[0].next(enrolled());
    localStorage.removeItem(TOKEN_KEY);
    expect(() => svc.ensureLoaded()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(svc.loaded()).toBe(false);
    expect(svc.state()).toBeNull();
  });

  it('a listener registered twice runs once (it is a set)', () => {
    const { svc } = rig();
    const once = vi.fn();
    svc.onSessionEnd(once);
    svc.onSessionEnd(once);
    svc.ensureLoaded();
    localStorage.removeItem(TOKEN_KEY);
    svc.ensureLoaded();
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe('OnbStateService: answers', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['{enrolled:false}', (c: Subject<OnbState>) => c.next({ enrolled: false })],
    ['404', (c: Subject<OnbState>) => c.error({ status: 404 })],
    ['403 ONBOARDING_NOT_AVAILABLE', (c: Subject<OnbState>) => c.error({ status: 403, error: { code: 'ONBOARDING_NOT_AVAILABLE' } })],
  ])('%s is a definitive "not enrolled": failed stays false and nothing is retried', (_n, answer) => {
    const { svc, calls, getState } = rig();
    svc.ensureLoaded();
    answer(calls[0]);
    expect(svc.enrolled()).toBe(false);
    expect(svc.failed()).toBe(false);
    expect(svc.loaded()).toBe(true);
    svc.retryIfFailed();
    svc.retryIfFailed();
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it.each([[500], [0], [429], [408]])('status %s: failed, still not enrolled, retried at most twice (never within 2 s of the failure)', (status) => {
    vi.useFakeTimers();
    const { svc, calls, getState } = rig();
    svc.ensureLoaded();
    calls[0].error({ status });
    expect(svc.failed()).toBe(true);
    expect(svc.enrolled()).toBe(false);
    svc.retryIfFailed(); // same instant: the navigation that saw the failure does not hammer the backend
    expect(getState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2001);
    svc.retryIfFailed();
    calls[1].error({ status });
    vi.advanceTimersByTime(2001);
    svc.retryIfFailed();
    calls[2].error({ status });
    vi.advanceTimersByTime(2001);
    svc.retryIfFailed(); // budget of 2 used up
    expect(getState).toHaveBeenCalledTimes(3);
  });

  it.each([[401], [403], [422]])('status %s: failed, never retried', (status) => {
    const { svc, calls, getState } = rig();
    svc.ensureLoaded();
    calls[0].error({ status });
    expect(svc.failed()).toBe(true);
    svc.retryIfFailed();
    expect(getState).toHaveBeenCalledTimes(1);
    expect(svc.enrolled()).toBe(false);
  });

  it('a retry that succeeds ends the failure', () => {
    vi.useFakeTimers();
    const { svc, calls } = rig();
    svc.ensureLoaded();
    calls[0].error({ status: 503 });
    vi.advanceTimersByTime(2001);
    svc.retryIfFailed();
    calls[1].next(enrolled());
    expect(svc.failed()).toBe(false);
    expect(svc.enrolled()).toBe(true);
  });

  it('an answer that is not an object with enrolled:true counts as not enrolled', () => {
    const { svc, calls } = rig();
    svc.ensureLoaded();
    calls[0].next(null as unknown as OnbState);
    expect(svc.state()).toEqual({ enrolled: false });
  });
});

describe('OnbStateService: sessionStorage hint', () => {
  it('writes a hash of the token (never the token) and the enrolled bit', () => {
    const { svc, calls } = rig('token-A');
    svc.ensureLoaded();
    calls[0].next({ enrolled: false });
    const hint = sessionStorage.getItem('waflow_onb_hint')!;
    expect(hint).toBe(`${fnv1a32('token-A')}:0`);
    expect(hint).not.toContain('token-A');
    expect(hint).toMatch(/^[0-9a-f]{8}:[01]$/);
  });

  it('writes 1 for an enrolled merchant and nothing on a failed first load', () => {
    const a = rig();
    a.svc.ensureLoaded();
    a.calls[0].next(enrolled());
    expect(sessionStorage.getItem('waflow_onb_hint')).toBe(`${fnv1a32('token-A')}:1`);
    TestBed.resetTestingModule();
    const b = rig();
    b.svc.ensureLoaded();
    b.calls[0].error({ status: 500 });
    expect(sessionStorage.getItem('waflow_onb_hint')).toBeNull();
  });

  it('is honoured only for the same token and only when it says 0', async () => {
    const r = rig('token-A');
    sessionStorage.setItem('waflow_onb_hint', `${fnv1a32('token-A')}:0`);
    await expect(r.svc.resolveForGuard(5000)).resolves.toBeNull(); // immediately, without waiting for the request
    expect(r.getState).toHaveBeenCalledTimes(1); // the background load still runs

    TestBed.resetTestingModule();
    const other = rig('token-B');
    sessionStorage.setItem('waflow_onb_hint', `${fnv1a32('token-A')}:0`);
    const p = other.svc.resolveForGuard(5000); // a hint of ANOTHER token is ignored: it waits
    other.calls[0].next(enrolled());
    await expect(p).resolves.toEqual(enrolled());

    TestBed.resetTestingModule();
    const one = rig('token-A');
    sessionStorage.setItem('waflow_onb_hint', `${fnv1a32('token-A')}:1`);
    const q = one.svc.resolveForGuard(5000); // a stored 1 never skips the wait
    one.calls[0].next(enrolled());
    await expect(q).resolves.toEqual(enrolled());
  });
});

describe('OnbStateService.resolveForGuard', () => {
  afterEach(() => vi.useRealTimers());

  it('no token: null and no request', async () => {
    const { svc, getState } = rig(null);
    await expect(svc.resolveForGuard(1000)).resolves.toBeNull();
    expect(getState).not.toHaveBeenCalled();
  });

  it('already loaded for this token: resolves with it without a new request', async () => {
    const { svc, calls, getState } = rig();
    svc.ensureLoaded();
    calls[0].next(enrolled());
    await expect(svc.resolveForGuard(1000)).resolves.toEqual(enrolled());
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it('in flight: joins the request and resolves when it answers', async () => {
    const { svc, calls, getState } = rig();
    svc.ensureLoaded();
    const p = svc.resolveForGuard(5000);
    calls[0].next(enrolled());
    await expect(p).resolves.toEqual(enrolled());
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it('timeout: null after maxWaitMs, the late answer still lands in the state', async () => {
    vi.useFakeTimers();
    const { svc, calls } = rig();
    const p = svc.resolveForGuard(1200);
    await vi.advanceTimersByTimeAsync(1201);
    await expect(p).resolves.toBeNull();
    calls[0].next(enrolled());
    expect(svc.enrolled()).toBe(true);
  });

  it('a failed request resolves to null (fail open)', async () => {
    const { svc, calls } = rig();
    const p = svc.resolveForGuard(5000);
    calls[0].error({ status: 500 });
    await expect(p).resolves.toBeNull();
  });

  it('never rejects, even when the api throws synchronously', async () => {
    const { svc, getState } = rig();
    getState.mockImplementation(() => { throw new Error('boom'); });
    await expect(svc.resolveForGuard(100)).resolves.toBeNull();
  });

  it('logout while waiting releases the guard with null', async () => {
    const { svc } = rig();
    const p = svc.resolveForGuard(5000);
    localStorage.removeItem(TOKEN_KEY);
    svc.ensureLoaded();
    await expect(p).resolves.toBeNull();
  });

  it('reloadNow resolves with the NEW answer and is not throttled', async () => {
    const { svc, calls } = rig();
    svc.ensureLoaded();
    calls[0].next(enrolled({ subscription: { state: 'pending' } }));
    const p = svc.reloadNow(5000);
    calls[1].next(enrolled({ subscription: { state: 'active' } }));
    await expect(p).resolves.toMatchObject({ subscription: { state: 'active' } });
    expect(svc.subState()).toBe('active');
  });
});

describe('OnbStateService.firstLandingThisSession', () => {
  it('is true once per login token, then false; true again for another token; false without a token', () => {
    const { svc } = rig('token-A');
    expect(svc.firstLandingThisSession()).toBe(true);
    expect(svc.firstLandingThisSession()).toBe(false);
    localStorage.setItem(TOKEN_KEY, 'token-B');
    expect(svc.firstLandingThisSession()).toBe(true);
    expect(svc.firstLandingThisSession()).toBe(false);
    localStorage.removeItem(TOKEN_KEY);
    expect(svc.firstLandingThisSession()).toBe(false);
  });

  it('stores only a hash of the token', () => {
    const { svc } = rig('token-A');
    svc.firstLandingThisSession();
    expect(sessionStorage.getItem('waflow_onb_landed')).toBe(fnv1a32('token-A'));
  });
});

describe('landingUrlOf', () => {
  const s = (over: Partial<OnbState>): OnbState => ({ enrolled: true, view: 'setup', subscription: { state: 'active' }, ...over });
  it.each<[string, OnbState | null, string | null]>([
    ['null', null, null],
    ['not enrolled', { enrolled: false }, null],
    ['subscription none', s({ subscription: { state: 'none' } }), '/setup/billing'],
    ['subscription pending', s({ subscription: { state: 'pending' } }), '/setup/billing'],
    ['view billing', s({ view: 'billing' }), '/setup/billing'],
    ['view done', s({ view: 'done', nextStep: null }), null],
    ['business', s({ nextStep: 'business' }), '/setup/business/name'],
    ['number', s({ nextStep: 'number' }), '/setup/number'],
    ['number paused (flag)', s({ nextStep: 'number', number: { paused: true } }), '/setup/number/paused'],
    ['number paused (progress)', s({ nextStep: 'number', progress: { status: 'paused_number' } }), '/setup/number/paused'],
    ['connect', s({ nextStep: 'connect' }), '/setup/connect'],
    ['approvals', s({ nextStep: 'approvals' }), '/setup/approvals'],
    ['customers', s({ nextStep: 'customers' }), '/setup/customers'],
    ['products', s({ nextStep: 'products' }), '/setup/products'],
    ['promotion', s({ nextStep: 'promotion' }), '/setup/promotion'],
    ['null nextStep (not done)', s({ nextStep: null }), null],
    ['unknown nextStep', s({ nextStep: 'zzz' as never }), '/setup'],
    ['past_due keeps its step', s({ subscription: { state: 'past_due' }, nextStep: 'connect' }), '/setup/connect'],
  ])('%s', (_n, state, url) => {
    expect(landingUrlOf(state)).toBe(url);
  });
});

describe('derived flags: hostNeeded / takeover / finished / remindersPending', () => {
  function with_(state: OnbState | null) {
    const r = rig();
    r.svc.ensureLoaded();
    if (state) r.calls[0].next(state);
    return r.svc;
  }
  const subs = ['none', 'pending', 'active', 'past_due', 'cancelled'] as const;
  const views = ['billing', 'setup', 'done'] as const;

  it.each(subs.flatMap((sub) => views.map((view) => [sub, view] as const)))('subscription %s x view %s', (sub, view) => {
    const svc = with_({ enrolled: true, view, subscription: { state: sub }, locked: true, prompts: { customers: { state: 'done' }, products: { state: 'done' } } });
    const takeover = sub === 'none' || sub === 'pending';
    const finished = view === 'done';
    expect(svc.takeover()).toBe(takeover);
    expect(svc.finished()).toBe(finished);
    expect(svc.remindersPending()).toBe(false);
    expect(svc.hostNeeded()).toBe(takeover || !finished);
    expect(svc.locked()).toBe(true);
  });

  it('finished with a skipped or pending prompt needs the host (reminders); with both done it does not', () => {
    const base = { enrolled: true, view: 'done', subscription: { state: 'active' } } as const;
    expect(with_({ ...base, prompts: { customers: { state: 'skipped' }, products: { state: 'done' } } }).hostNeeded()).toBe(true);
    expect(with_({ ...base, prompts: { customers: { state: 'done' }, products: { state: 'pending' } } }).remindersPending()).toBe(true);
    expect(with_({ ...base, prompts: { customers: { state: 'done' }, products: { state: 'done' } } }).hostNeeded()).toBe(false);
    expect(with_({ ...base }).hostNeeded()).toBe(false);
  });

  it('everything is false/neutral for null, not enrolled and unknown values', () => {
    for (const st of [null, { enrolled: false } as OnbState]) {
      const svc = with_(st);
      expect(svc.enrolled()).toBe(false);
      expect(svc.takeover()).toBe(false);
      expect(svc.finished()).toBe(false);
      expect(svc.locked()).toBe(false);
      expect(svc.hostNeeded()).toBe(false);
      expect(svc.landingUrl()).toBeNull();
      expect(svc.level()).toBeNull();
      expect(svc.sendingPaused()).toBeNull();
      expect(svc.unread()).toBe(0);
    }
  });

  it('level, sendingPaused and unread come straight from the state', () => {
    const svc = with_({ enrolled: true, connection: { level: 'reconnect_needed' }, sendingPaused: { code: 'WHATSAPP_RECONNECT_REQUIRED' }, notifications: { unread: 3 } });
    expect(svc.level()).toBe('reconnect_needed');
    expect(svc.sendingPaused()).toEqual({ code: 'WHATSAPP_RECONNECT_REQUIRED' });
    expect(svc.unread()).toBe(3);
  });

  it('patch updates the local state and is a no-op without one', () => {
    const svc = with_({ enrolled: true, notifications: { unread: 2 } });
    svc.patch({ notifications: { unread: 0 } });
    expect(svc.unread()).toBe(0);
    const empty = with_(null);
    empty.patch({ locked: true });
    expect(empty.state()).toBeNull();
  });
});
