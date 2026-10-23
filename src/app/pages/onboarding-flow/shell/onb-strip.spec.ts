import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { I18nService } from '../../../i18n/i18n.service';
import type { CatalogMap } from '../../../i18n/i18n.types';
import { AuthService } from '../../../shared/auth.service';
import { OnbApiService } from '../onb-api.service';
import { OnbStateService } from '../onb-state.service';
import type { OnbState } from '../onb.types';
import { OnbShell, computeStripVariant, stripActionFor, type OnbStripContext } from './onb-shell';
import { OnbStatusPill } from './onb-status-pill';

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

const ctx = (over: Partial<OnbStripContext> = {}): OnbStripContext => ({
  enrolled: true, takeover: false, subState: 'active', level: null, sendingPaused: null, locked: false, finished: true, url: '/customers', ...over,
});

describe('computeStripVariant: the eight variants by priority', () => {
  it('not enrolled: nothing', () => {
    expect(computeStripVariant(ctx({ enrolled: false, takeover: true }))).toBe('none');
  });

  it.each<[string, Partial<OnbStripContext>, string]>([
    ['1 takeover, none', { takeover: true, subState: 'none' }, 'pay'],
    ['1 takeover, pending', { takeover: true, subState: 'pending' }, 'payPending'],
    ['2 past_due', { subState: 'past_due' }, 'pastDue'],
    ['3 cancelled', { subState: 'cancelled' }, 'cancelled'],
    ['4 reconnect needed', { level: 'reconnect_needed' }, 'reconnect'],
    ['5 sending paused on a send route', { sendingPaused: { code: 'SENDING_NOT_AVAILABLE_YET' }, url: '/promotions' }, 'paused'],
    ['6 locked page', { locked: true, finished: false, url: '/customers' }, 'locked'],
    ['7 unfinished', { finished: false, url: '/dashboard' }, 'finish'],
    ['8 connection level known', { level: 'connected', url: '/dashboard' }, 'pill'],
    ['nothing to say', { url: '/dashboard' }, 'none'],
  ])('%s', (_n, over, expected) => {
    expect(computeStripVariant(ctx(over))).toBe(expected);
  });

  it('first match wins', () => {
    const all = ctx({ takeover: true, subState: 'pending', level: 'reconnect_needed', sendingPaused: { code: 'X' }, locked: true, finished: false, url: '/promotions' });
    expect(computeStripVariant(all)).toBe('payPending');
    expect(computeStripVariant({ ...all, takeover: false, subState: 'past_due' })).toBe('pastDue');
    expect(computeStripVariant({ ...all, takeover: false, subState: 'cancelled' })).toBe('cancelled');
    expect(computeStripVariant({ ...all, takeover: false })).toBe('reconnect');
    // the page is veiled by the lock: the lock message comes first, the paused banner is for pages that are usable
    expect(computeStripVariant({ ...all, takeover: false, level: 'connected' })).toBe('locked');
    expect(computeStripVariant({ ...all, takeover: false, level: 'connected', locked: false })).toBe('paused');
    expect(computeStripVariant({ ...all, takeover: false, level: 'connected', sendingPaused: null })).toBe('locked');
    expect(computeStripVariant({ ...all, takeover: false, level: 'connected', sendingPaused: null, locked: false })).toBe('finish');
  });

  it('the Promotions banner (paused) only appears on SEND_ROUTES', () => {
    const paused = { sendingPaused: { code: 'WHATSAPP_RECONNECT_REQUIRED' }, level: 'connected' };
    for (const url of ['/promotions', '/flows', '/referrals', '/inbox', '/instagram-promotions', '/ai-mode', '/arabic', '/arabic/templates', '/customers']) {
      expect(computeStripVariant(ctx({ ...paused, url })), url).toBe('paused');
    }
    for (const url of ['/dashboard', '/settings', '/products', '/orders', '/setup/customers', '/setup/products', '/customersx']) {
      expect(computeStripVariant(ctx({ ...paused, url })), url).toBe('pill');
    }
  });

  it('a page that is both a send route and locked (Customers) says it is locked; unlocked, it says sending is paused', () => {
    const locked = ctx({ locked: true, finished: false, sendingPaused: { code: 'WHATSAPP_NOT_CONNECTED' }, url: '/customers' });
    expect(computeStripVariant(locked)).toBe('locked');
    expect(computeStripVariant({ ...locked, locked: false })).toBe('paused');
    // the allow-listed dashboard is neither a send route nor veiled: the unfinished setup is what the strip says there
    expect(computeStripVariant({ ...locked, url: '/dashboard' })).toBe('finish');
    // every send route follows the same rule
    for (const url of ['/promotions', '/ai-mode', '/arabic', '/customers']) {
      expect(computeStripVariant({ ...locked, url }), url).toBe('locked');
      expect(computeStripVariant({ ...locked, url, locked: false }), url).toBe('paused');
    }
  });

  it('a lock never applies to allow-listed pages', () => {
    for (const url of ['/dashboard', '/setup/connect', '/support', '/legal/tos']) {
      expect(computeStripVariant(ctx({ locked: true, finished: true, url }))).toBe('none');
    }
  });
});

describe('stripActionFor: buttons, owner vs member', () => {
  it('everyone gets the payment and continue buttons', () => {
    for (const owner of [true, false]) {
      expect(stripActionFor('pay', owner, null, null)).toEqual({ labelKey: 'onboarding.strip.payGo', path: '/setup/billing' });
      expect(stripActionFor('payPending', owner, null, null)?.path).toBe('/setup/billing');
      expect(stripActionFor('finish', owner, '/setup/connect', null)).toEqual({ labelKey: 'onboarding.strip.continue', path: '/setup/connect' });
      expect(stripActionFor('locked', owner, null, null)?.path).toBe('/setup');
    }
  });

  it('owner-only buttons are hidden from members', () => {
    expect(stripActionFor('pastDue', true, null, null)?.labelKey).toBe('onboarding.strip.updatePay');
    expect(stripActionFor('pastDue', false, null, null)).toBeNull();
    expect(stripActionFor('cancelled', true, null, null)?.labelKey).toBe('onboarding.strip.restart');
    expect(stripActionFor('cancelled', false, null, null)).toBeNull();
    expect(stripActionFor('reconnect', true, null, null)?.path).toBe('/setup/connect?reconnect=1');
    expect(stripActionFor('reconnect', false, null, null)).toBeNull();
  });

  it('the paused banner takes the fix button of the code', () => {
    expect(stripActionFor('paused', true, null, 'WHATSAPP_RECONNECT_REQUIRED')?.labelKey).toBe('onboarding.strip.reconnectBtn');
    expect(stripActionFor('paused', false, null, 'WHATSAPP_RECONNECT_REQUIRED')).toBeNull();
    expect(stripActionFor('paused', true, null, 'PAYMENT_PAST_DUE')?.path).toBe('/setup/billing');
    expect(stripActionFor('paused', true, null, 'WHATSAPP_NOT_CONNECTED')?.path).toBe('/setup/connect');
    expect(stripActionFor('paused', true, null, 'SENDING_NOT_AVAILABLE_YET')).toEqual({ labelKey: 'onboarding.help.cta', help: true });
    expect(stripActionFor('paused', true, null, 'OWNER_ONLY')).toBeNull();
    expect(stripActionFor('paused', true, null, null)).toBeNull();
  });

  it('pill and none have no button', () => {
    expect(stripActionFor('pill', true, null, null)).toBeNull();
    expect(stripActionFor('none', true, null, null)).toBeNull();
  });
});

describe('OnbStatusPill: icon and word, never colour alone', () => {
  @Component({ imports: [OnbStatusPill], template: `<app-onb-status-pill [level]="level" />` })
  class PillHost { level: string | null = null; }

  it.each([
    ['connected', 'onboarding.pill.connected', String.fromCodePoint(0x2713)],
    ['needs_attention', 'onboarding.pill.attention', String.fromCodePoint(0x26A0)],
    ['reconnect_needed', 'onboarding.pill.reconnect', String.fromCodePoint(0x2717)],
    [null, 'onboarding.pill.notConnected', String.fromCodePoint(0x25CB)],
  ])('level %s shows its text and a glyph', async (level, key, glyph) => {
    TestBed.configureTestingModule({ providers: [{ provide: I18nService, useClass: FakeI18n }] });
    await TestBed.inject(I18nService).init();
    const f = TestBed.createComponent(PillHost);
    f.componentInstance.level = level;
    f.detectChanges();
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(`[${key}]`);
    expect(text).toContain(glyph);
    expect(((f.nativeElement as HTMLElement).querySelector('[aria-hidden="true"]') as HTMLElement).textContent).toBe(glyph);
  });
});

describe('OnbShell strip component', () => {
  let session$: BehaviorSubject<{ role: 'owner' | 'member' } | null>;

  async function mount(state: OnbState, url: string, role: 'owner' | 'member' = 'owner'): Promise<{ f: ComponentFixture<OnbShell>; el: HTMLElement; router: Router }> {
    localStorage.clear();
    localStorage.setItem('waflow_auth_token', 'token-A');
    session$ = new BehaviorSubject<{ role: 'owner' | 'member' } | null>({ role });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(['dashboard', 'promotions', 'customers', 'setup', 'support', 'products', 'ai-mode', 'arabic'].map((path) => ({ path, component: Blank }))),
        { provide: I18nService, useClass: FakeI18n },
        { provide: OnbApiService, useValue: { getState: () => new Subject(), notifications: () => of([]), helpContext: () => of({}), event: () => of({}) } },
        { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      ],
    });
    await TestBed.inject(I18nService).init();
    TestBed.inject(OnbStateService).state.set(state);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const f = TestBed.createComponent(OnbShell);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, router };
  }
  const active = (over: Partial<OnbState> = {}): OnbState => ({ enrolled: true, view: 'setup', subscription: { state: 'active' }, locked: false, nextStep: 'connect', ...over });

  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('unfinished setup, app unlocked (Step 3 done): the neutral "Finish setting up. Step n" line, never "to unlock", with a Continue button', async () => {
    const { el, router } = await mount(active(), '/dashboard');
    expect(el.textContent).toContain('[onboarding.strip.finishUnlocked]');
    expect(el.textContent).not.toContain('[onboarding.strip.finish]');
    expect(el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('finish');
    const spy = vi.spyOn(router, 'navigateByUrl');
    (el.querySelector('.onb-shell-btn') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith('/setup/connect');
  });

  it('unfinished setup while the app is locked: "Finish setup to unlock everything. Step n of 5" on an allow-listed page', async () => {
    const { el } = await mount(active({ locked: true }), '/dashboard');
    expect(el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('finish');
    expect(el.textContent).toContain('[onboarding.strip.finish]');
    expect(el.textContent).not.toContain('[onboarding.strip.finishUnlocked]');
  });

  it('the neutral line passes the step and the total; the locked one only the step (its text carries the 5)', async () => {
    const { f } = await mount(active({ nextStep: 'approvals' }), '/dashboard');
    const msg = f.componentInstance.msg();
    expect(msg.key).toBe('onboarding.strip.finishUnlocked');
    expect(msg.params).toEqual({ n: 4, total: 5 });
    TestBed.resetTestingModule();
    const locked = await mount(active({ locked: true, nextStep: 'connect' }), '/dashboard');
    expect(locked.f.componentInstance.msg()).toEqual({ key: 'onboarding.strip.finish', params: { n: 3 } });
  });

  it('payment takeover: the pay message and a Go to payment button', async () => {
    const { el } = await mount({ enrolled: true, view: 'billing', subscription: { state: 'none' }, locked: true }, '/customers');
    expect(el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('pay');
    expect(el.textContent).toContain('[onboarding.strip.payNow]');
    expect(el.textContent).toContain('[onboarding.strip.payGo]');
  });

  it('past due: owner sees Update payment, a member sees "Ask the account owner" and no button', async () => {
    const owner = await mount(active({ subscription: { state: 'past_due' } }), '/dashboard');
    expect(owner.el.textContent).toContain('[onboarding.strip.updatePay]');
    expect(owner.el.textContent).not.toContain('[onboarding.strip.askOwner]');
    TestBed.resetTestingModule();
    const member = await mount(active({ subscription: { state: 'past_due' } }), '/dashboard', 'member');
    expect(member.el.querySelector('.onb-shell-btn')).toBeNull();
    expect(member.el.textContent).toContain('[onboarding.strip.askOwner]');
  });

  it('cancelled and reconnect variants show their copy', async () => {
    const c = await mount(active({ subscription: { state: 'cancelled' } }), '/dashboard');
    expect(c.el.textContent).toContain('[onboarding.strip.cancelled]');
    expect(c.el.textContent).toContain('[onboarding.strip.restart]');
    TestBed.resetTestingModule();
    const r = await mount(active({ connection: { level: 'reconnect_needed' } }), '/customers');
    expect(r.el.textContent).toContain('[onboarding.strip.reconnect]');
    expect(r.el.textContent).toContain('[onboarding.strip.reconnectBtn]');
    expect(r.el.textContent).toContain('[onboarding.pill.reconnect]');
  });

  it('the Promotions banner shows on /promotions only and carries the cause and the fix button', async () => {
    const st = active({ view: 'done', nextStep: null, connection: { level: 'connected' }, sendingPaused: { code: 'WHATSAPP_RECONNECT_REQUIRED' } });
    const on = await mount(st, '/promotions');
    expect(on.el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('paused');
    expect(on.el.textContent).toContain('[onboarding.strip.paused]');
    expect(on.el.textContent).toContain('[onboarding.strip.reconnectBtn]');
    TestBed.resetTestingModule();
    const off = await mount(st, '/products');
    expect(off.el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('pill');
    expect(off.el.textContent).not.toContain('[onboarding.strip.paused]');
  });

  it('the banner also shows on Customers, AI Mode and the Arabic hub (their send actions are refused by the server too)', async () => {
    const st = active({ view: 'done', nextStep: null, connection: { level: 'connected' }, sendingPaused: { code: 'SENDING_NOT_AVAILABLE_YET' } });
    for (const url of ['/customers', '/ai-mode', '/arabic']) {
      TestBed.resetTestingModule();
      const r = await mount(st, url);
      expect(r.el.querySelector('.onb-shell')!.getAttribute('data-variant'), url).toBe('paused');
      expect(r.el.textContent, url).toContain('[onboarding.strip.paused]');
      expect(r.el.textContent, url).toContain('[onboarding.help.cta]'); // the fix button of this code: Need help?
    }
  });

  it('locked page: lock title and body with a Continue setup button', async () => {
    const { el } = await mount(active({ locked: true }), '/customers');
    expect(el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('locked');
    expect(el.textContent).toContain('[onboarding.lock.title]');
    expect(el.textContent).toContain('[onboarding.lock.body]');
    expect(el.textContent).toContain('[onboarding.strip.continue]');
  });

  it('locked page: the long explanation stays in the DOM (visually hidden on phones by CSS, so screen readers keep it); the title and the button do not carry the hide class', async () => {
    const { el } = await mount(active({ locked: true, sendingPaused: { code: 'WHATSAPP_NOT_CONNECTED' } }), '/customers');
    const more = el.querySelector('.onb-shell-more')!;
    expect(more).not.toBeNull();
    expect(more.textContent).toContain('[onboarding.lock.body]');
    expect(more.hasAttribute('hidden')).toBe(false);
    expect(more.getAttribute('aria-hidden')).toBeNull();
    expect(el.querySelectorAll('.onb-shell-more')).toHaveLength(1);
    expect(el.querySelector('.onb-shell-msg strong')!.classList.contains('onb-shell-more')).toBe(false);
    expect(el.querySelector('.onb-shell-btn')!.classList.contains('onb-shell-more')).toBe(false);
  });

  it('a member who cannot act sees the "ask the owner" hint, which no phone rule hides', async () => {
    const { el } = await mount(active({ subscription: { state: 'past_due' } }), '/dashboard', 'member');
    const hint = Array.from(el.querySelectorAll('.onb-shell-sub')).find((e) => (e.textContent ?? '').includes('[onboarding.strip.askOwner]'))!;
    expect(hint).toBeDefined();
    expect(hint.classList.contains('onb-shell-more')).toBe(false);
  });

  it('finished and connected: only the compact pill, bell and help (no message, no button)', async () => {
    const { el } = await mount(active({ view: 'done', nextStep: null, connection: { level: 'connected' } }), '/dashboard');
    expect(el.querySelector('.onb-shell')!.getAttribute('data-variant')).toBe('pill');
    expect(el.querySelector('.onb-shell-msg')).toBeNull();
    expect(el.querySelector('.onb-shell-btn')).toBeNull();
    expect(el.textContent).toContain('[onboarding.pill.connected]');
  });

  it('the bell shows the unread count and opens the notifications sheet', async () => {
    const { f, el } = await mount(active({ notifications: { unread: 4 } }), '/dashboard');
    expect(el.querySelector('.onb-shell-count')!.textContent!.trim()).toBe('4');
    expect(el.querySelector('app-onb-notifications')).toBeNull();
    (el.querySelector('.onb-shell-bell') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('app-onb-notifications [role="dialog"]')).toBeTruthy();
  });

  it('no count badge when nothing is unread', async () => {
    const { el } = await mount(active({ notifications: { unread: 0 } }), '/dashboard');
    expect(el.querySelector('.onb-shell-count')).toBeNull();
  });

  it('under /setup the strip steps aside (the setup header carries the same controls)', async () => {
    const { el } = await mount(active(), '/setup');
    expect(el.querySelector('.onb-shell')).toBeNull();
  });

  it('has its own lang/dir and a labelled region', async () => {
    const { el } = await mount(active(), '/dashboard');
    const root = el.querySelector('.onb-shell')!;
    expect(root.getAttribute('lang')).toBe('en');
    expect(root.getAttribute('dir')).toBe('ltr');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('[onboarding.title]');
  });

  it('renders nothing until the catalogue is ready', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: I18nService, useClass: FakeI18n },
        { provide: OnbApiService, useValue: { getState: () => new Subject() } },
        { provide: AuthService, useValue: { session: of(null), sessionSnapshot: null } },
      ],
    });
    TestBed.inject(OnbStateService).state.set(active());
    const f = TestBed.createComponent(OnbShell);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.onb-shell')).toBeNull();
  });
});
