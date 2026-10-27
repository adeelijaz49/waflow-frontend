import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CanActivateFn, CanMatchFn, Route, Router, Routes, UrlTree, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../shared/auth.service';
import { LegalService } from '../../shared/legal.service';
import { Dashboard } from '../dashboard/dashboard';
import { Onboarding } from '../onboarding/onboarding';
import { ONBOARDING_FLOW_ROUTES } from './onb.routes';
import { OnbStateService } from './onb-state.service';

// PROVES the router facts the whole onboarding build rests on, with the REAL routes array:
//  * a canMatch that answers false makes the router continue with the EXISTING route of the same path;
//  * canMatch may answer a UrlTree (redirect); canMatch runs before canActivate; two routes may share a path;
//  * a failing canMatch (our guards swallow errors) falls through to the existing route.
vi.setConfig({ testTimeout: 30000 });

const STATE_URL = 'http://localhost:3000/api/onboarding/state';

const HEAD_PATHS = [
  '', 'login', 'auth/verify', 'dashboard', 'ai-mode', 'demo', 'products', 'customers', 'inbox', 'orders', 'promotions',
  'referrals', 'instagram-promotions', 'flows', 'services', 'settings', 'usage-limits', 'support', 'onboarding', 'imports',
  'arabic', 'platform', 'legal/:slug', 'legal-acceptance', // 'platform' = the super-admin console (guarded by platformAdminGuard)
];

const authStub = {
  get isLoggedIn(): boolean {
    return !!localStorage.getItem('waflow_auth_token');
  },
  get token(): string | null {
    return localStorage.getItem('waflow_auth_token');
  },
  session: of(null),
  sessionSnapshot: null,
};
const legalStub = { status: () => of({ requiresCombinedAcceptance: false, requiresDpaAcceptance: false }), refresh: () => undefined };

function setup(token: string | null = 'token-A') {
  localStorage.clear();
  sessionStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', token);
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: authStub }, { provide: LegalService, useValue: legalStub },
    ],
  });
  return { router: TestBed.inject(Router), http: TestBed.inject(HttpTestingController) };
}

type Reply = { status: number; body?: object };
async function reply(http: HttpTestingController, r: Reply): Promise<void> {
  const req = await vi.waitFor(() => http.expectOne(STATE_URL));
  if (r.status === 200) req.flush(r.body ?? null);
  else if (r.status === 0) req.error(new ProgressEvent('error'), { status: 0 });
  else req.flush(r.body ?? {}, { status: r.status, statusText: 'x' });
}

// The router keeps its own (standardised) copies of the route objects: identity is checked against router.config.
const existing = (router: Router, path: string): Route => router.config.find((r) => r.path === path && !r.canMatch) as Route;
const shadow = (router: Router, path: string): Route => router.config.find((r) => r.path === path && !!r.canMatch) as Route;
const active = (router: Router): Route | null | undefined => router.routerState.snapshot.root.firstChild?.routeConfig;

const enrolled = (over: Record<string, unknown> = {}) => ({
  enrolled: true, view: 'setup', locked: true, nextStep: 'business',
  subscription: { state: 'active' }, steps: { business: { status: 'todo' } }, ...over,
});

describe('app.routes: the three onboarding routes are inserted, nothing else moved', () => {
  it('keeps every existing entry in its order and adds exactly the 3 shadow routes right after the root redirect', () => {
    expect(ONBOARDING_FLOW_ROUTES.map((r) => r.path)).toEqual(['dashboard', 'onboarding', 'setup']);
    const without = routes.filter((r) => !ONBOARDING_FLOW_ROUTES.includes(r));
    expect(without.map((r) => r.path)).toEqual(HEAD_PATHS);
    expect(routes.slice(0, 5).map((r) => r.path)).toEqual(['', 'dashboard', 'onboarding', 'setup', 'login']);
    expect(routes[1]).toBe(ONBOARDING_FLOW_ROUTES[0]);
  });

  it('every shadow entry sits BEFORE the existing entry of the same path and the existing entry has no canMatch', () => {
    for (const p of ['dashboard', 'onboarding']) {
      const idxShadow = routes.findIndex((r) => r.path === p && !!r.canMatch);
      const idxExisting = routes.findIndex((r) => r.path === p && !r.canMatch);
      expect(idxShadow).toBeGreaterThan(-1);
      expect(idxExisting).toBeGreaterThan(idxShadow);
      expect(routes[idxExisting].canMatch).toBeUndefined();
    }
  });
});

describe('router facts, with synthetic routes (so the facts do not depend on the app)', () => {
  @Component({ selector: 'onb-t-a', template: '' }) class A {}
  @Component({ selector: 'onb-t-b', template: '' }) class B {}

  function boot(table: Routes) {
    TestBed.configureTestingModule({ providers: [provideRouter(table)] });
    return TestBed.inject(Router);
  }

  it('canMatch false: the router continues with the next route of the same path; its canActivate never runs', async () => {
    const calls: string[] = [];
    const matchNo: CanMatchFn = () => { calls.push('match'); return false; };
    const actA: CanActivateFn = () => { calls.push('activateA'); return true; };
    const actB: CanActivateFn = () => { calls.push('activateB'); return true; };
    const table: Routes = [
      { path: 'x', canMatch: [matchNo], canActivate: [actA], component: A },
      { path: 'x', canActivate: [actB], component: B },
    ];
    const router = boot(table);
    await router.navigateByUrl('/x');
    expect(active(router)).toBe(router.config[1]);
    expect(calls).toEqual(['match', 'activateB']);
  });

  it('canMatch runs before canActivate when it matches', async () => {
    const calls: string[] = [];
    const table: Routes = [
      { path: 'x', canMatch: [() => { calls.push('match'); return true; }], canActivate: [() => { calls.push('activate'); return true; }], component: A },
    ];
    const router = boot(table);
    await router.navigateByUrl('/x');
    expect(calls).toEqual(['match', 'activate']);
  });

  it('canMatch may return a UrlTree: the navigation is redirected', async () => {
    const table: Routes = [
      { path: 'x', canMatch: [() => TestBed.inject(Router).parseUrl('/y')], component: A },
      { path: 'x', component: B },
      { path: 'y', component: B },
    ];
    const router = boot(table);
    await router.navigateByUrl('/x');
    expect(router.url).toBe('/y');
    expect(active(router)).toBe(router.config[2]);
  });

  it('an async canMatch is awaited', async () => {
    const table: Routes = [
      { path: 'x', canMatch: [async () => { await new Promise((r) => setTimeout(r, 20)); return false; }], component: A },
      { path: 'x', component: B },
    ];
    const router = boot(table);
    await router.navigateByUrl('/x');
    expect(active(router)).toBe(router.config[1]);
  });

  it('a canMatch that returns a UrlTree is evaluated for the redirect and the result type is a UrlTree', async () => {
    let tree: unknown;
    const table: Routes = [
      { path: 'x', canMatch: [() => { tree = TestBed.inject(Router).parseUrl('/y'); return tree as UrlTree; }], component: A },
      { path: 'y', component: B },
    ];
    const router = boot(table);
    await router.navigateByUrl('/x');
    expect(tree).toBeInstanceOf(UrlTree);
  });
});

describe('onb routes with the REAL app routes: inert for everyone who is not enrolled', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('no token: /dashboard stays the existing route (authGuard sends to /login), ZERO http requests', async () => {
    const { router, http } = setup(null);
    await router.navigateByUrl('/dashboard');
    http.expectNone(() => true);
    expect(router.url).toBe('/login');
    expect(active(router)).toBe(existing(router,'login'));
  });

  it('no token: /onboarding stays the existing route chain, ZERO http requests', async () => {
    const { router, http } = setup(null);
    await router.navigateByUrl('/onboarding');
    http.expectNone(() => true);
    expect(router.url).toBe('/login');
  });

  const notEnrolledAnswers: [string, Reply][] = [
    ['404 (flag off)', { status: 404 }],
    ['200 {enrolled:false}', { status: 200, body: { enrolled: false } }],
    ['403 ONBOARDING_NOT_AVAILABLE', { status: 403, body: { code: 'ONBOARDING_NOT_AVAILABLE' } }],
    ['500', { status: 500 }],
    ['network error (status 0)', { status: 0 }],
    ['401', { status: 401 }],
  ];

  it.each(notEnrolledAnswers)('state answer %s: /dashboard resolves to the EXISTING Dashboard, one state request', async (_n, r) => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/dashboard');
    await reply(http, r);
    await nav;
    expect(router.url).toBe('/dashboard');
    expect(active(router)).toBe(existing(router,'dashboard'));
    expect(await (existing(router,'dashboard').loadComponent as () => Promise<unknown>)()).toBe(Dashboard);
    http.expectNone(STATE_URL);
  });

  it.each(notEnrolledAnswers)('state answer %s: /onboarding resolves to the EXISTING Onboarding wizard', async (_n, r) => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/onboarding');
    await reply(http, r);
    await nav;
    expect(router.url).toBe('/onboarding');
    expect(active(router)).toBe(existing(router,'onboarding'));
    expect(await (existing(router,'onboarding').loadComponent as () => Promise<unknown>)()).toBe(Onboarding);
  });

  it('a state answer that never arrives: after the 1.2 s cap the existing Dashboard is used', async () => {
    const { router, http } = setup();
    const started = Date.now();
    const nav = router.navigateByUrl('/dashboard');
    await vi.waitFor(() => expect(http.match(STATE_URL).length).toBe(1)); // request seen, never answered
    await nav;
    expect(Date.now() - started).toBeGreaterThanOrEqual(1100);
    expect(active(router)).toBe(existing(router,'dashboard'));
  });

  it('a hint of "0" for this token answers immediately without waiting for the request', async () => {
    const { router, http } = setup();
    const first = router.navigateByUrl('/dashboard');
    await reply(http, { status: 200, body: { enrolled: false } });
    await first;
    // a NEW SPA session with the same tab (hint kept in sessionStorage): the guard must not wait
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub }, { provide: LegalService, useValue: legalStub }],
    });
    const router2 = TestBed.inject(Router);
    const http2 = TestBed.inject(HttpTestingController);
    const started = Date.now();
    await router2.navigateByUrl('/dashboard');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(active(router2)).toBe(existing(router2,'dashboard'));
    // the background load still ran and will correct the hint
    const req = http2.expectOne(STATE_URL);
    req.flush({ enrolled: false });
  });

  it('/setup for a non-enrolled merchant redirects to /dashboard (the existing one)', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/setup/connect');
    await reply(http, { status: 200, body: { enrolled: false } });
    await nav;
    expect(router.url).toBe('/dashboard');
    expect(active(router)).toBe(existing(router,'dashboard'));
  });

  it('a state service that throws inside the guard falls through to the existing route', async () => {
    const { router, http } = setup();
    const svc = TestBed.inject(OnbStateService);
    vi.spyOn(svc, 'resolveForGuard').mockImplementation(() => { throw new Error('boom'); });
    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/dashboard');
    expect(active(router)).toBe(existing(router,'dashboard'));
    http.expectNone(STATE_URL);
  });

  it('other legacy routes are untouched and make no onboarding request (/customers, /settings)', async () => {
    const { router, http } = setup();
    await router.navigateByUrl('/customers');
    await router.navigateByUrl('/settings');
    expect(router.url).toBe('/settings');
    expect(active(router)).toBe(existing(router,'settings'));
    http.expectNone(STATE_URL);
  });
});

describe('onb routes with the REAL app routes: enrolled merchants', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('first /dashboard of the login session: canMatch returns a UrlTree into the landing step; then /dashboard is the host', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/dashboard');
    await reply(http, { status: 200, body: enrolled() });
    await nav;
    expect(router.url).toBe('/setup/business/name');

    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/dashboard');
    expect(active(router)).toBe(shadow(router,'dashboard'));
    const mod = await (shadow(router,'dashboard').loadComponent as () => Promise<{ name?: string }>)();
    expect((mod as { name?: string }).name).toMatch(/OnbDashboardHost$/); // the bundler may prefix the class name
    http.expectNone(STATE_URL); // one state request for the whole session
  });

  it('subscription none: the first landing is the billing screen', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/dashboard');
    await reply(http, { status: 200, body: { enrolled: true, view: 'billing', subscription: { state: 'none' }, locked: true } });
    await nav;
    expect(router.url).toBe('/setup/billing');
  });

  it('a step that is not open yet sends the merchant back to the landing step (stepGuard)', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/setup/connect');
    await reply(http, { status: 200, body: enrolled() });
    await nav;
    expect(router.url).toBe('/setup/business/name');
  });

  it('/onboarding for an enrolled merchant is the OnbEntry shadow', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/onboarding');
    await reply(http, { status: 200, body: enrolled() });
    await nav;
    expect(router.url).toBe('/onboarding');
    expect(active(router)).toBe(shadow(router,'onboarding'));
  });

  it('a finished merchant without reminders keeps the plain existing dashboard (host not needed)', async () => {
    const { router, http } = setup();
    const nav = router.navigateByUrl('/dashboard');
    await reply(http, {
      status: 200,
      body: { enrolled: true, view: 'done', locked: false, nextStep: null, subscription: { state: 'active' }, prompts: { customers: { state: 'done' }, products: { state: 'done' } } },
    });
    await nav;
    expect(router.url).toBe('/dashboard');
    expect(active(router)).toBe(existing(router,'dashboard'));
  });
});
