import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService, AuthSession } from '../shared/auth.service';
import { PLATFORM_GUARD_TIMEOUT_MS, platformAdminGuard } from './platform-admin.guard';

const base: AuthSession = {
  user: { id: 'u1', name: 'A', phone: '', email: 'a@example.com' },
  workspace: { id: 'w1', name: 'Home', onboarding: { completed: true, currentStep: 5 } },
  role: 'owner',
};

async function runGuard(): Promise<boolean | UrlTree> {
  const injector = TestBed.inject(EnvironmentInjector);
  const result = await runInInjectionContext(injector, () =>
    platformAdminGuard({} as ActivatedRouteSnapshot, { url: '/platform' } as RouterStateSnapshot),
  );
  return result as boolean | UrlTree;
}

describe('platformAdminGuard with a stubbed session', () => {
  function setup(session: AuthSession | null) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { whenSession: vi.fn().mockResolvedValue(session) } }],
    });
    return TestBed.inject(Router);
  }

  it('lets a super admin through', async () => {
    setup({ ...base, superAdmin: true });
    expect(await runGuard()).toBe(true);
  });

  it.each([
    ['not a super admin', { ...base }],
    ['superAdmin explicitly false', { ...base, superAdmin: false }],
    ['a super admin inside a customer', { ...base, superAdmin: true, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } }],
    ['no session (timed out)', null],
  ])('sends %s to /dashboard', async (_n, session) => {
    const router = setup(session as AuthSession | null);
    const res = await runGuard();
    expect(res).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(res as UrlTree)).toBe('/dashboard');
  });

  it('waits no longer than the guard timeout', async () => {
    setup({ ...base, superAdmin: true });
    const auth = TestBed.inject(AuthService) as unknown as { whenSession: ReturnType<typeof vi.fn> };
    await runGuard();
    expect(auth.whenSession).toHaveBeenCalledWith(PLATFORM_GUARD_TIMEOUT_MS);
  });
});

describe('platformAdminGuard with the real AuthService (hard refresh of /platform)', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  function setup() {
    localStorage.clear();
    localStorage.setItem('waflow_auth_token', 'token-A');
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    return { http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
  }

  it('waits for /me instead of reading an empty snapshot, then allows a super admin', async () => {
    const { http } = setup();
    const pending = runGuard();
    http.expectOne((r) => /\/api\/auth\/me$/.test(r.url)).flush({ ...base, superAdmin: true });
    expect(await pending).toBe(true);
  });

  it('denies once /me says the person is not a super admin', async () => {
    const { http, router } = setup();
    const pending = runGuard();
    http.expectOne((r) => /\/api\/auth\/me$/.test(r.url)).flush({ ...base });
    expect(router.serializeUrl((await pending) as UrlTree)).toBe('/dashboard');
  });

  it('denies after the timeout when the session never arrives', async () => {
    vi.useFakeTimers();
    const { http, router } = setup();
    const pending = runGuard();
    await vi.advanceTimersByTimeAsync(PLATFORM_GUARD_TIMEOUT_MS + 10);
    const res = await pending;
    expect(res).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(res as UrlTree)).toBe('/dashboard');
    http.expectOne((r) => /\/api\/auth\/me$/.test(r.url)); // never answered
  });

  it('denies a transient /me failure (500) after the timeout, without logging the person out', async () => {
    vi.useFakeTimers();
    const { http } = setup();
    const pending = runGuard();
    http.expectOne((r) => /\/api\/auth\/me$/.test(r.url)).flush({}, { status: 500, statusText: 'err' });
    await vi.advanceTimersByTimeAsync(PLATFORM_GUARD_TIMEOUT_MS + 10);
    expect(await pending).toBeInstanceOf(UrlTree);
    expect(localStorage.getItem('waflow_auth_token')).toBe('token-A');
  });
});
