import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { I18nService } from '../../../i18n/i18n.service';
import type { CatalogMap } from '../../../i18n/i18n.types';
import { AuthService } from '../../../shared/auth.service';
import { OnbApiService } from '../onb-api.service';
import { SEND_ROUTES, isLockAllowed, isSendRoute, isSetupUrl } from '../onb-links';
import type { OnbState } from '../onb.types';
import { OnbShellMount } from './onb-shell-mount';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
}
@Component({ template: '' }) class Blank {}

const state = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'setup', locked: true, nextStep: 'connect', subscription: { state: 'active' }, ...over,
});

async function boot(first: OnbState) {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  document.body.className = '';
  document.body.innerHTML = '<main class="main-content"><router-outlet-stub></router-outlet-stub><div class="page">page</div></main>';
  const answers: Subject<OnbState>[] = [];
  const api = { getState: () => { const s = new Subject<OnbState>(); answers.push(s); return s; }, notifications: () => of([]), helpContext: () => of({}), event: () => of({}) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(['dashboard', 'customers', 'promotions', 'settings', 'support', 'setup', 'legal-acceptance'].map((path) => ({ path, component: Blank }))),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: of(null), sessionSnapshot: null, isLoggedIn: true } },
    ],
  });
  const mount = TestBed.inject(OnbShellMount);
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/customers');
  mount.start();
  answers[0].next(first);
  await vi.waitFor(() => expect(document.querySelector('.onb-shell-host')).not.toBeNull());
  await settle();
  return { mount, router, answers };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const page = (): HTMLElement => document.querySelector('main.main-content > .page') as HTMLElement;
const cls = (n: string): boolean => document.body.classList.contains(n);

describe('lock allow-list (first path segment match)', () => {
  it.each(['/dashboard', '/dashboard?x=1', '/setup', '/setup/connect', '/onboarding', '/support', '/legal/tos', '/legal-acceptance', '/login', '/auth/verify'])(
    '%s stays usable', (url) => expect(isLockAllowed(url)).toBe(true));
  it.each(['/promotions', '/customers', '/products', '/inbox', '/settings', '/dashboardx', '/setupx', '/flows', '/imports', '/arabic', '/ai-mode', '/', ''])(
    '%s is locked', (url) => expect(isLockAllowed(url)).toBe(false));

  it('send routes and setup urls are recognised by whole segments', () => {
    for (const u of [
      '/promotions', '/promotions?openCreate=true', '/flows', '/referrals', '/inbox', '/instagram-promotions',
      '/ai-mode', '/ai-mode?x=1', '/arabic', '/arabic/templates', '/customers', '/customers?q=sara',
    ]) expect(isSendRoute(u), u).toBe(true);
    for (const u of [
      '/promotionsx', '/customersx', '/ai-modes', '/arabics', '/instagram', '/dashboard', '/products', '/orders',
      '/setup/customers', '/setup/products', '/setup/promotion', '/imports', '',
    ]) expect(isSendRoute(u), u).toBe(false);
    expect(isSetupUrl('/setup')).toBe(true);
    expect(isSetupUrl('/setup/billing?x=1')).toBe(true);
    expect(isSetupUrl('/setupx')).toBe(false);
  });
});

describe('SEND_ROUTES and LOCK_ALLOW are two separate questions', () => {
  it('Customers, AI Mode and the Arabic hub are send routes AND stay locked (veiled) until Step 3 is done', () => {
    for (const u of ['/customers', '/ai-mode', '/arabic']) {
      expect(isSendRoute(u), u).toBe(true);
      expect(isLockAllowed(u), u).toBe(false);
    }
  });

  it('no allow-listed page is a send route, and the setup prompts (/setup/customers, /setup/products) are neither a send route nor locked', () => {
    for (const u of ['/dashboard', '/setup', '/setup/customers', '/setup/products', '/onboarding', '/support', '/legal/tos', '/legal-acceptance', '/login', '/auth/verify']) {
      expect(isLockAllowed(u), u).toBe(true);
      expect(isSendRoute(u), u).toBe(false);
    }
  });

  it('every send route is a first path segment of the app (a typo here would silently disable a banner)', () => {
    expect(SEND_ROUTES.every((p) => /^\/[a-z-]+$/.test(p))).toBe(true);
    expect(new Set(SEND_ROUTES).size).toBe(SEND_ROUTES.length);
    expect([...SEND_ROUTES].sort()).toEqual(['/ai-mode', '/arabic', '/customers', '/flows', '/inbox', '/instagram-promotions', '/promotions', '/referrals']);
  });
});

describe('OnbShellMount lock treatment', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    TestBed.inject(OnbShellMount).stop();
    vi.restoreAllMocks();
  });

  it('locked + a locked page: onb-locked AND onb-veil on the body, the routed child is inert and aria-hidden', async () => {
    await boot(state());
    expect(cls('onb-locked')).toBe(true);
    expect(cls('onb-veil')).toBe(true);
    expect(page().hasAttribute('inert')).toBe(true);
    expect(page().getAttribute('aria-hidden')).toBe('true');
  });

  it('the strip host is never inert or aria-hidden', async () => {
    await boot(state());
    const host = document.querySelector('.onb-shell-host') as HTMLElement;
    expect(host.hasAttribute('inert')).toBe(false);
    expect(host.hasAttribute('aria-hidden')).toBe(false);
  });

  it('a lazily added routed child is covered the moment it appears', async () => {
    await boot(state());
    const late = document.createElement('div');
    late.className = 'late-page';
    document.querySelector('main.main-content')!.appendChild(late);
    await vi.waitFor(() => expect(late.hasAttribute('inert')).toBe(true));
    expect(late.getAttribute('aria-hidden')).toBe('true');
  });

  it('an allow-listed page keeps the nav lock class but no veil and nothing inert', async () => {
    const { router } = await boot(state());
    await router.navigateByUrl('/dashboard');
    await vi.waitFor(() => expect(cls('onb-veil')).toBe(false));
    expect(cls('onb-locked')).toBe(true);
    expect(page().hasAttribute('inert')).toBe(false);
    expect(page().hasAttribute('aria-hidden')).toBe(false);
  });

  it('going back to a locked page restores the veil', async () => {
    const { router } = await boot(state());
    await router.navigateByUrl('/support');
    await vi.waitFor(() => expect(cls('onb-veil')).toBe(false));
    await router.navigateByUrl('/promotions');
    await vi.waitFor(() => expect(cls('onb-veil')).toBe(true));
    expect(page().hasAttribute('inert')).toBe(true);
  });

  it('unlocking (state.locked false) clears the classes and the attributes, and stops observing', async () => {
    const { mount } = await boot(state());
    const svc = (await import('../onb-state.service')).OnbStateService;
    TestBed.inject(svc).state.set(state({ locked: false }));
    await mount.evaluate();
    expect(cls('onb-locked')).toBe(false);
    expect(cls('onb-veil')).toBe(false);
    expect(page().hasAttribute('inert')).toBe(false);
    expect(page().hasAttribute('aria-hidden')).toBe(false);
    const after = document.createElement('div');
    document.querySelector('main.main-content')!.appendChild(after);
    await settle();
    expect(after.hasAttribute('inert')).toBe(false); // the observer is gone
  });

  it('only removes the attributes it added: an element that was aria-hidden before keeps it', async () => {
    localStorage.clear();
    const { mount } = await boot(state());
    const pre = document.createElement('div');
    pre.setAttribute('aria-hidden', 'true');
    document.querySelector('main.main-content')!.appendChild(pre);
    await vi.waitFor(() => expect(pre.hasAttribute('inert')).toBe(true));
    const svc = (await import('../onb-state.service')).OnbStateService;
    TestBed.inject(svc).state.set(state({ locked: false }));
    await mount.evaluate();
    expect(pre.hasAttribute('inert')).toBe(false);
    expect(pre.getAttribute('aria-hidden')).toBe('true');
  });

  it('not locked from the start: no body class, no attributes', async () => {
    await boot(state({ locked: false }));
    expect(document.body.className).toBe('');
    expect(document.querySelector('main.main-content > [inert], main.main-content > [aria-hidden]')).toBeNull();
  });

  it('un-enrolling removes everything', async () => {
    const { mount } = await boot(state());
    const svc = (await import('../onb-state.service')).OnbStateService;
    TestBed.inject(svc).state.set({ enrolled: false });
    await mount.evaluate();
    expect(document.body.className).toBe('');
    expect(document.querySelector('.onb-shell-host')).toBeNull();
    expect(document.querySelector('[inert], [aria-hidden]')).toBeNull(); // the strip (with its own decorative glyphs) is gone too
  });
});
