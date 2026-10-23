import { ApplicationInitStatus, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { I18nService } from '../../../i18n/i18n.service';
import type { CatalogMap } from '../../../i18n/i18n.types';
import { AuthService } from '../../../shared/auth.service';
import { OnbApiService } from '../onb-api.service';
import { OnbStateService } from '../onb-state.service';
import { provideOnboardingFlow } from '../onb.provider';
import type { OnbState } from '../onb.types';
import { OnbShellMount } from './onb-shell-mount';

vi.setConfig({ testTimeout: 30000 });

// Catalogue stub (no dependence on the real JSON): every key translates to "[key]".
const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
let failCatalog = false;
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return failCatalog ? Promise.reject(new Error('chunk load failed')) : Promise.resolve(catalog());
  }
}

@Component({ template: '' }) class Blank {}

const TOKEN = 'token-A';
const finish = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'setup', locked: false, nextStep: 'business', subscription: { state: 'active' }, steps: { business: { status: 'todo' } }, ...over,
});

interface Rig { answers: Subject<OnbState>[]; getState: ReturnType<typeof vi.fn>; mount: OnbShellMount; state: OnbStateService; router: Router }

function rig(opts: { token?: string | null; withMain?: boolean; provider?: boolean } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = '';
  document.body.innerHTML = '';
  if (opts.token !== null) localStorage.setItem('waflow_auth_token', opts.token ?? TOKEN);
  if (opts.withMain !== false) {
    const main = document.createElement('main');
    main.className = 'main-content';
    main.innerHTML = '<div class="legacy-page">legacy</div>';
    document.body.appendChild(main);
  }
  const answers: Subject<OnbState>[] = [];
  const getState = vi.fn(() => {
    const s = new Subject<OnbState>();
    answers.push(s);
    return s;
  });
  const api = { getState, notifications: () => of([]), helpContext: () => of({}), event: () => of({}) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'dashboard', component: Blank }, { path: 'onboarding', component: Blank }, { path: 'customers', component: Blank },
        { path: 'promotions', component: Blank }, { path: 'setup/business/name', component: Blank }, { path: 'setup/billing', component: Blank },
      ]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: of(null), sessionSnapshot: null, isLoggedIn: true } },
      ...(opts.provider ? [provideOnboardingFlow()] : []),
    ],
  });
  return { answers, getState, mount: TestBed.inject(OnbShellMount), state: TestBed.inject(OnbStateService), router: TestBed.inject(Router) };
}

const main = (): HTMLElement | null => document.querySelector<HTMLElement>('main.main-content');
const host = (): HTMLElement | null => document.querySelector<HTMLElement>('.onb-shell-host');

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('OnbShellMount: inert for everyone who is not enrolled', () => {
  beforeEach(() => {
    failCatalog = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    TestBed.inject(OnbShellMount).stop();
    vi.restoreAllMocks();
  });

  it.each([
    ['{enrolled:false}', (r: Rig) => r.answers[0].next({ enrolled: false })],
    ['404', (r: Rig) => r.answers[0].error({ status: 404 })],
    ['500', (r: Rig) => r.answers[0].error({ status: 500 })],
    ['network error', (r: Rig) => r.answers[0].error({ status: 0 })],
  ])('state answer %s: main children, body class and attributes are byte-identical, no host, no observer', async (_n, answer) => {
    const r = rig();
    document.body.className = 'keep  me';
    const before = { main: main()!.innerHTML, body: document.body.className, bodyHtml: document.body.innerHTML };
    r.mount.start();
    answer(r);
    await r.mount.evaluate();
    await settle();
    expect(host()).toBeNull();
    expect(main()!.innerHTML).toBe(before.main);
    expect(document.body.className).toBe(before.body);
    expect(document.body.innerHTML).toBe(before.bodyHtml);
    expect(document.querySelector('[inert], [aria-hidden]')).toBeNull();
    expect(r.getState).toHaveBeenCalledTimes(1);
    expect(r.mount.mounted).toBe(false);
  });

  it('no token: no request, nothing mounted, nothing touched', async () => {
    const r = rig({ token: null });
    const before = document.body.innerHTML;
    r.mount.start();
    await r.mount.evaluate();
    await r.router.navigateByUrl('/dashboard');
    await settle();
    expect(r.getState).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
    expect(document.body.className).toBe('');
  });

  it('a state answer that never arrives mounts nothing', async () => {
    const r = rig();
    r.mount.start();
    await r.mount.evaluate();
    await settle();
    expect(host()).toBeNull();
    expect(r.state.enrolled()).toBe(false);
  });

  it('start() is idempotent: one state request however often it is called', async () => {
    const r = rig();
    r.mount.start();
    r.mount.start();
    r.mount.start();
    await r.router.navigateByUrl('/dashboard');
    await r.router.navigateByUrl('/customers');
    expect(r.getState).toHaveBeenCalledTimes(1);
  });

  it('a navigation after a login-session answer of "not enrolled" never asks again', async () => {
    const r = rig();
    r.mount.start();
    r.answers[0].next({ enrolled: false });
    for (const u of ['/dashboard', '/customers', '/promotions', '/dashboard']) await r.router.navigateByUrl(u);
    expect(r.getState).toHaveBeenCalledTimes(1);
  });
});

describe('OnbShellMount: provideOnboardingFlow() initializer', () => {
  beforeEach(() => {
    failCatalog = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    TestBed.inject(OnbShellMount).stop();
    vi.restoreAllMocks();
  });

  it('returns void: bootstrap is not blocked (ApplicationInitStatus.done is true at once) and the state request has started', () => {
    const r = rig({ provider: true });
    const init = TestBed.inject(ApplicationInitStatus);
    expect(init.done).toBe(true);
    expect(r.getState).toHaveBeenCalledTimes(1);
  });

  it('a failing initializer body can never break the app (start() swallows errors)', () => {
    const r = rig({ provider: false });
    vi.spyOn(r.state, 'ensureLoaded').mockImplementation(() => { throw new Error('boom'); });
    expect(() => r.mount.start()).not.toThrow();
  });
});

describe('OnbShellMount: enrolled merchants', () => {
  beforeEach(() => {
    failCatalog = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    TestBed.inject(OnbShellMount).stop();
    vi.restoreAllMocks();
  });

  it('mounts the strip host as the FIRST child of <main>, once, and renders after i18n is ready', async () => {
    const r = rig();
    r.mount.start();
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(host()).not.toBeNull());
    expect(main()!.firstElementChild).toBe(host());
    expect(main()!.children.length).toBe(2);
    await r.mount.evaluate();
    await r.mount.evaluate();
    r.mount.start();
    expect(document.querySelectorAll('.onb-shell-host').length).toBe(1);
    await vi.waitFor(() => expect(host()!.textContent).toContain('[onboarding.strip.finishUnlocked]')); // not locked: the neutral line
    expect(main()!.querySelector('.legacy-page')!.textContent).toBe('legacy'); // the existing page is untouched
    expect(document.body.className).toBe(''); // not locked: no body class
  });

  it('logout (token removed) removes the host and the body classes', async () => {
    const r = rig();
    r.mount.start();
    r.answers[0].next(finish({ locked: true }));
    await vi.waitFor(() => expect(document.body.classList.contains('onb-locked')).toBe(true));
    localStorage.removeItem('waflow_auth_token');
    await r.router.navigateByUrl('/dashboard');
    await vi.waitFor(() => expect(host()).toBeNull());
    expect(document.body.className).toBe('');
    expect(r.state.enrolled()).toBe(false);
    expect(r.mount.mounted).toBe(false);
  });

  it('another merchant (token change) drops the host until the new answer says enrolled again', async () => {
    const r = rig();
    r.mount.start();
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(host()).not.toBeNull());
    localStorage.setItem('waflow_auth_token', 'token-B');
    await r.router.navigateByUrl('/dashboard');
    expect(r.getState).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(host()).toBeNull());
    r.answers[1].next({ enrolled: false });
    await settle();
    expect(host()).toBeNull();
  });

  it('un-enrolling (a later 404 on refresh) removes the strip', async () => {
    const r = rig();
    r.mount.start();
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(host()).not.toBeNull());
    r.state.state.set({ enrolled: false });
    await r.mount.evaluate();
    expect(host()).toBeNull();
  });

  it('<main> missing at first: retried (at most 5 times) on the next evaluation', async () => {
    const r = rig({ withMain: false });
    r.mount.start();
    r.answers[0].next(finish());
    await r.mount.evaluate();
    await settle();
    expect(host()).toBeNull();
    const m = document.createElement('main');
    m.className = 'main-content';
    document.body.appendChild(m);
    await r.router.navigateByUrl('/dashboard');
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it('<main> that never appears: stops retrying after 5 attempts and never throws', async () => {
    const r = rig({ withMain: false });
    r.mount.start();
    r.answers[0].next(finish());
    for (let i = 0; i < 9; i++) await r.mount.evaluate();
    const m = document.createElement('main');
    m.className = 'main-content';
    document.body.appendChild(m);
    await r.mount.evaluate();
    expect(host()).toBeNull();
  });

  it('catalogue download failure: neither the strip nor the veil is shown', async () => {
    failCatalog = true;
    const r = rig();
    r.mount.start();
    r.answers[0].next(finish({ locked: true }));
    await r.mount.evaluate();
    await settle();
    expect(r.mount.textsFailed).toBe(true);
    expect(host()).toBeNull();
    expect(document.body.className).toBe('');
    expect(document.querySelector('[inert]')).toBeNull();
  });
});

describe('OnbShellMount: late redirect', () => {
  beforeEach(() => {
    failCatalog = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    TestBed.inject(OnbShellMount).stop();
    vi.restoreAllMocks();
  });

  it('legacy /dashboard rendered first, then enrolled: redirected ONCE into the landing step', async () => {
    const r = rig();
    r.mount.start();
    await r.router.navigateByUrl('/dashboard');
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(r.router.url).toBe('/setup/business/name'));
    await r.router.navigateByUrl('/dashboard');
    r.state.state.set({ ...finish() }); // a fresh object: the effect/evaluate path runs again
    await r.mount.evaluate();
    await settle();
    expect(r.router.url).toBe('/dashboard'); // no second redirect in the same login session
  });

  it('only from /dashboard or /onboarding: a merchant on /customers is not moved', async () => {
    const r = rig();
    r.mount.start();
    await r.router.navigateByUrl('/customers');
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await settle();
    expect(r.router.url).toBe('/customers');
  });

  it('not while the shadow route component is on screen', async () => {
    const r = rig();
    r.state.shadowActive = true;
    r.mount.start();
    await r.router.navigateByUrl('/dashboard');
    r.answers[0].next(finish());
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await settle();
    expect(r.router.url).toBe('/dashboard');
  });

  it('a finished merchant (no landing URL) is never redirected', async () => {
    const r = rig();
    r.mount.start();
    await r.router.navigateByUrl('/dashboard');
    r.answers[0].next(finish({ view: 'done', nextStep: null }));
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await settle();
    expect(r.router.url).toBe('/dashboard');
  });
});
