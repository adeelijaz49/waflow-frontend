import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSession, EXIT_TIMEOUT_MS } from './auth.service';

const SESSION: AuthSession = {
  user: { id: 'u1', name: 'Staff', phone: '', email: 'staff@example.com' },
  workspace: { id: 'w1', name: 'Home', onboarding: { completed: true, currentStep: 5 } },
  role: 'owner',
  superAdmin: true,
};
const UNSCOPED = ['waflow_ai_mode_session_id', 'waflow_ai_mode_ar_session_id', 'waflow_caption_draft'];
const ME = /\/api\/auth\/me$/;

function setup(token: string | null = 'home-token') {
  localStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', token);
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const auth = TestBed.inject(AuthService);
  const go = vi.spyOn(auth as unknown as { go: (u: string) => void }, 'go').mockImplementation(() => {});
  return { http, auth, go };
}

function loadSession(http: HttpTestingController, body: object = SESSION) {
  http.expectOne((r) => ME.test(r.url)).flush(body);
}

describe('AuthService: session, refresh and logout', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('loads the session from /me on start, including superAdmin and actingAs', () => {
    const { http, auth } = setup();
    loadSession(http, { ...SESSION, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    expect(auth.sessionSnapshot?.superAdmin).toBe(true);
    expect(auth.sessionSnapshot?.actingAs?.customerName).toBe('MegaSun');
    http.verify();
  });

  it('refresh logs out on 401 only', () => {
    const { http, auth } = setup();
    http.expectOne((r) => ME.test(r.url)).flush({ error: 'Session no longer valid' }, { status: 401, statusText: 'Unauthorized' });
    expect(localStorage.getItem('waflow_auth_token')).toBeNull();
    expect(auth.sessionSnapshot).toBeNull();
  });

  it.each([500, 503, 0])('refresh keeps the session on a transient failure (%s)', (status) => {
    const { http, auth } = setup();
    loadSession(http);
    auth.refresh();
    const req = http.expectOne((r) => ME.test(r.url));
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({ error: 'boom' }, { status, statusText: 'err' });
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(auth.sessionSnapshot?.user.id).toBe('u1');
  });

  it('a failed first load on a 500 does not log out either (token stays, session stays null)', () => {
    const { http, auth } = setup();
    http.expectOne((r) => ME.test(r.url)).flush({}, { status: 500, statusText: 'err' });
    expect(auth.isLoggedIn).toBe(true);
    expect(auth.sessionSnapshot).toBeNull();
  });

  it('logout removes the token, the parked home token, the three unscoped keys and the session', () => {
    const { http, auth } = setup();
    loadSession(http);
    localStorage.setItem('waflow_home_token', 'parked');
    for (const k of UNSCOPED) localStorage.setItem(k, 'x');
    localStorage.setItem('waflow_ui_language', 'en');
    auth.logout();
    expect(localStorage.getItem('waflow_auth_token')).toBeNull();
    expect(localStorage.getItem('waflow_home_token')).toBeNull();
    for (const k of UNSCOPED) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem('waflow_ui_language')).toBe('en'); // not a workspace key: untouched
    expect(auth.sessionSnapshot).toBeNull();
  });
});

describe('AuthService.whenSession', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('resolves null at once when there is no token (nothing will ever arrive)', async () => {
    const { auth } = setup(null);
    expect(await auth.whenSession(50)).toBeNull();
  });

  it('resolves with the current session when it is already loaded', async () => {
    const { http, auth } = setup();
    loadSession(http);
    expect((await auth.whenSession())?.user.id).toBe('u1');
  });

  it('waits for the first non-null session', async () => {
    const { http, auth } = setup();
    const p = auth.whenSession(5000);
    loadSession(http);
    expect((await p)?.workspace.id).toBe('w1');
  });

  it('resolves null when no session arrives in time', async () => {
    vi.useFakeTimers();
    const { http, auth } = setup();
    const p = auth.whenSession(1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBeNull();
    http.expectOne((r) => ME.test(r.url)); // still pending, never answered
  });
});

describe('AuthService: a new sign-in starts clean', () => {
  afterEach(() => localStorage.clear());

  it('completeLogin drops a parked super-admin token and the unscoped chat / caption keys of whoever used this browser before, then stores the new token and loads the session', () => {
    const { http, auth } = setup(null);
    localStorage.setItem('waflow_home_token', 'old-super-admin-token');
    for (const k of UNSCOPED) localStorage.setItem(k, 'previous-person-data');
    auth.completeLogin('new-token');
    expect(localStorage.getItem('waflow_auth_token')).toBe('new-token');
    expect(localStorage.getItem('waflow_home_token')).toBeNull();
    for (const k of UNSCOPED) expect(localStorage.getItem(k)).toBeNull();
    loadSession(http);
    expect(auth.sessionSnapshot?.user.id).toBe('u1');
  });
});

describe('AuthService: entering and leaving a customer', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('enterTenant parks the home token, stores the act-as token, drops the unscoped keys and reloads at /dashboard', async () => {
    const { http, auth, go } = setup('home-token');
    loadSession(http);
    for (const k of UNSCOPED) localStorage.setItem(k, 'old-customer');
    const p = auth.enterTenant('w2');
    const req = http.expectOne((r) => r.url.endsWith('/api/platform/tenants/w2/enter'));
    expect(req.request.method).toBe('POST');
    // the call itself is made with the staff token
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    req.flush({ token: 'act-as-token', workspace: { id: 'w2', name: 'MegaSun' }, expiresAt: '2026-10-27T00:00:00Z' });
    await p;
    expect(localStorage.getItem('waflow_home_token')).toBe('home-token');
    expect(localStorage.getItem('waflow_auth_token')).toBe('act-as-token');
    for (const k of UNSCOPED) expect(localStorage.getItem(k)).toBeNull();
    expect(go).toHaveBeenCalledWith('/dashboard');
    expect(auth.sessionSnapshot).toBeNull();
  });

  it('enterTenant leaves everything as it was when the API refuses', async () => {
    const { http, auth, go } = setup('home-token');
    loadSession(http);
    localStorage.setItem('waflow_caption_draft', 'keep me');
    const p = auth.enterTenant('w2');
    http.expectOne((r) => r.url.endsWith('/enter')).flush({ error: 'Super admin only' }, { status: 403, statusText: 'Forbidden' });
    await expect(p).rejects.toMatchObject({ status: 403 });
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(localStorage.getItem('waflow_home_token')).toBeNull();
    expect(localStorage.getItem('waflow_caption_draft')).toBe('keep me');
    expect(go).not.toHaveBeenCalled();
  });

  it('enterTenant rejects (and changes nothing) when the response has no token', async () => {
    const { http, auth, go } = setup('home-token');
    loadSession(http);
    const p = auth.enterTenant('w2');
    http.expectOne((r) => r.url.endsWith('/enter')).flush({});
    await expect(p).rejects.toThrow();
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(go).not.toHaveBeenCalled();
  });

  it('entering from inside a customer never overwrites the parked home token with an act-as token', async () => {
    const { http, auth } = setup('act-as-1');
    localStorage.setItem('waflow_home_token', 'real-home');
    loadSession(http, { ...SESSION, actingAs: { customerName: 'A', workspaceId: 'wA' } });
    const p = auth.enterTenant('wB');
    http.expectOne((r) => r.url.endsWith('/tenants/wB/enter')).flush({ token: 'act-as-2', workspace: { id: 'wB', name: 'B' }, expiresAt: 'x' });
    await p;
    expect(localStorage.getItem('waflow_home_token')).toBe('real-home');
    expect(localStorage.getItem('waflow_auth_token')).toBe('act-as-2');
  });

  it('exitTenant tells the server, restores the home token, clears the stash and the keys, and goes to /platform', async () => {
    const { http, auth, go } = setup('act-as-token');
    localStorage.setItem('waflow_home_token', 'home-token');
    loadSession(http, { ...SESSION, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    for (const k of UNSCOPED) localStorage.setItem(k, 'customer-data');
    const p = auth.exitTenant();
    const req = http.expectOne((r) => r.url.endsWith('/api/platform/exit'));
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true });
    await p;
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(localStorage.getItem('waflow_home_token')).toBeNull();
    for (const k of UNSCOPED) expect(localStorage.getItem(k)).toBeNull();
    expect(go).toHaveBeenCalledWith('/platform');
  });

  it('exitTenant still restores the home token when the exit call fails (expired act-as token)', async () => {
    const { http, auth, go } = setup('act-as-token');
    localStorage.setItem('waflow_home_token', 'home-token');
    loadSession(http, { ...SESSION, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    const p = auth.exitTenant();
    http.expectOne((r) => r.url.endsWith('/exit')).flush({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' });
    await p;
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(go).toHaveBeenCalledWith('/platform');
  });

  it('exitTenant does not wait longer than the timeout for the audit call: a hung connection still ends with the home token restored', async () => {
    vi.useFakeTimers();
    const { http, auth, go } = setup('act-as-token');
    localStorage.setItem('waflow_home_token', 'home-token');
    loadSession(http, { ...SESSION, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    const p = auth.exitTenant();
    http.expectOne((r) => r.url.endsWith('/exit')); // never answered
    await vi.advanceTimersByTimeAsync(EXIT_TIMEOUT_MS - 1);
    expect(go).not.toHaveBeenCalled(); // still waiting
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(localStorage.getItem('waflow_auth_token')).toBe('home-token');
    expect(localStorage.getItem('waflow_home_token')).toBeNull();
    expect(go).toHaveBeenCalledWith('/platform');
  });

  it('exitTenant with no parked home token signs the person out and goes to /login', async () => {
    const { http, auth, go } = setup('act-as-token');
    loadSession(http, { ...SESSION, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    const p = auth.exitTenant();
    http.expectOne((r) => r.url.endsWith('/exit')).flush({ ok: true });
    await p;
    expect(localStorage.getItem('waflow_auth_token')).toBeNull();
    expect(go).toHaveBeenCalledWith('/login');
  });
});
