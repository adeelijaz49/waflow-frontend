import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { ONB_BILLING_REDIRECT_ORIGINS } from '../../onb-links';
import { OnbStateService } from '../../onb-state.service';
import type { OnbState } from '../../onb.types';
import {
  BILLING_FAST_WINDOW_MS, BILLING_POLL_FAST_MS, BILLING_POLL_SLOW_MS, BILLING_REFRESH_AFTER_MS, BillingScreen,
} from './billing';
import { ONB_EXTERNAL_NAVIGATE, safeExternalUrl } from './onb-a-kit';

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

const base = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'billing', subscription: { state: 'none', retry: { checkout: true } }, checkout: { available: true, plans: [] }, ...over,
});
const withSub = (state: 'none' | 'pending' | 'past_due' | 'cancelled' | 'active', over: Partial<OnbState> = {}): OnbState =>
  base({ subscription: { state, retry: { checkout: state === 'none' || state === 'cancelled' } }, view: state === 'past_due' || state === 'active' ? 'setup' : 'billing', ...over });

type Fn = ReturnType<typeof vi.fn>;
interface Rig {
  state: OnbStateService;
  router: Router;
  api: Record<string, Fn>;
  go: Fn;
  help: OnbHelpService;
  announcer: OnbAnnouncer;
}

function rig(initial: OnbState | null, opts: { role?: 'owner' | 'member' | null; query?: Record<string, string> } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const session$ = new BehaviorSubject<unknown>(opts.role === null ? null : { role: opts.role ?? 'owner', user: { name: 'Sara', phone: '', email: '' }, workspace: { name: 'W' } });
  const api: Record<string, Fn> = {
    getState: vi.fn(() => new Subject<OnbState>()),
    checkout: vi.fn(() => of({ url: 'https://checkout.stripe.com/c/pay/abc' })),
    billingPortal: vi.fn(() => of({ url: 'https://billing.stripe.com/p/session/abc' })),
    billingRefresh: vi.fn(() => of({ changed: false })),
    event: vi.fn(() => of({})),
    helpContext: vi.fn(() => of({})),
  };
  const go = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}) } } },
      { provide: ONB_EXTERNAL_NAVIGATE, useValue: go },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  state.state.set(initial);
  return { state, router: TestBed.inject(Router), api, go, help: TestBed.inject(OnbHelpService), announcer: TestBed.inject(OnbAnnouncer) };
}

async function mount(r: Rig): Promise<{ f: ComponentFixture<BillingScreen>; el: HTMLElement }> {
  await TestBed.inject(I18nService).init();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const f = TestBed.createComponent(BillingScreen);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  void r;
  return { f, el: f.nativeElement as HTMLElement };
}

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ');
const buttons = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll('button'));
const primary = (el: HTMLElement): HTMLButtonElement | null => el.querySelector<HTMLButtonElement>('button.onb-btn-primary');

describe('safeExternalUrl (the redirect allow-list)', () => {
  const own = 'https://app.waflowtech.com';
  it.each<[string, unknown, string | null]>([
    ['a Stripe checkout URL', 'https://checkout.stripe.com/c/pay/cs_test_1', 'https://checkout.stripe.com/c/pay/cs_test_1'],
    ['the billing portal', 'https://billing.stripe.com/p/session/abc', 'https://billing.stripe.com/p/session/abc'],
    ['http', 'http://checkout.stripe.com/x', null],
    ['javascript:', 'javascript:alert(1)', null],
    ['data:', 'data:text/html,hi', null],
    ['a relative URL', '/setup/billing', null],
    ['a protocol-relative URL', '//checkout.stripe.com/x', null],
    ['our own origin', 'https://app.waflowtech.com/dashboard', null],
    ['our own host in another case', 'https://APP.WAFLOWTECH.COM/x', null],
    ['credentials in the URL', 'https://user:pw@checkout.stripe.com/x', null],
    ['garbage', 'not a url', null],
    ['an empty string', '', null],
    ['a number', 42, null],
    ['null', null, null],
    ['an object', { url: 'https://x.test' }, null],
    ['an over-long URL', `https://checkout.stripe.com/${'a'.repeat(2100)}`, null],
    // R2-11: only the two Stripe-hosted origins pass, whatever else looks fine (https, no credentials, not our own origin)
    ['another https host', 'https://x.test/a', null],
    ['another https host with a Stripe-looking path', 'https://pay.example.test/c/pay/cs_test_1', null],
    ['Stripe\'s own site (not a hosted payment page)', 'https://stripe.com/checkout', null],
    ['another Stripe host (js.stripe.com)', 'https://js.stripe.com/v3/', null],
    ['a Stripe look-alike host (suffix)', 'https://checkout.stripe.com.evil.test/c/pay/x', null],
    ['a Stripe look-alike host (prefix)', 'https://evilcheckout.stripe.com/c/pay/x', null],
    ['a Stripe host used as a user name', 'https://checkout.stripe.com@evil.test/c/pay/x', null],
    ['a backslash host trick', 'https://evil.test\\@checkout.stripe.com/c/pay/x', null],
    ['a Stripe host on another port', 'https://checkout.stripe.com:8443/c/pay/x', null],
    ['a Stripe host with a trailing dot', 'https://checkout.stripe.com./c/pay/x', null],
    ['the billing portal on the checkout host path trick', 'https://billing.stripe.com.evil.test/p/session/x', null],
    ['a Stripe host in upper case (the host is case-insensitive)', 'https://CHECKOUT.STRIPE.COM/c/pay/cs_test_1', 'https://checkout.stripe.com/c/pay/cs_test_1'],
    ['a Stripe host on the default port', 'https://checkout.stripe.com:443/c/pay/cs_test_1', 'https://checkout.stripe.com/c/pay/cs_test_1'],
    ['surrounding spaces', '  https://billing.stripe.com/p/session/abc  ', 'https://billing.stripe.com/p/session/abc'],
  ])('%s', (_n, input, expected) => {
    expect(safeExternalUrl(input, own)).toBe(expected);
  });

  it('an unusable own origin still refuses non-https URLs and any host that is not Stripe-hosted', () => {
    expect(safeExternalUrl('http://x.test', '')).toBeNull();
    expect(safeExternalUrl('https://x.test/a', '')).toBeNull();
    expect(safeExternalUrl('http://checkout.stripe.com/a', '')).toBeNull();
    expect(safeExternalUrl('https://checkout.stripe.com/a', '')).toBe('https://checkout.stripe.com/a');
    expect(safeExternalUrl('https://billing.stripe.com/a', 'not a url')).toBe('https://billing.stripe.com/a');
  });

  it('the allow-list is ONE constant in onb-links.ts: exactly the two Stripe origins, https only, no path, lower case', () => {
    expect([...ONB_BILLING_REDIRECT_ORIGINS]).toEqual(['https://checkout.stripe.com', 'https://billing.stripe.com']);
    for (const o of ONB_BILLING_REDIRECT_ORIGINS) {
      const u = new URL(o);
      expect(u.origin, o).toBe(o);
      expect(u.protocol, o).toBe('https:');
    }
  });

  it('extending the list is the only way another host passes (the origin list is a parameter of the same check)', () => {
    expect(safeExternalUrl('https://pay.example.test/x', own)).toBeNull();
    expect(safeExternalUrl('https://pay.example.test/x', own, [...ONB_BILLING_REDIRECT_ORIGINS, 'https://pay.example.test'])).toBe('https://pay.example.test/x');
    // our own origin and credentials are refused even if somebody listed the host
    expect(safeExternalUrl('https://app.waflowtech.com/x', own, ['https://app.waflowtech.com'])).toBeNull();
    expect(safeExternalUrl('https://u:p@pay.example.test/x', own, ['https://pay.example.test'])).toBeNull();
  });
});

describe('BillingScreen: the access states', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('none (owner): the neutral Meta-fees line and ONE primary button to payment; no plan name, price or credit in the screen', async () => {
    const { el } = await mount(rig(withSub('none')));
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.none.title]');
    expect(textOf(el)).toContain('[onboarding.billing.none.body]');
    expect(textOf(el)).toContain('[onboarding.billing.metaFees]');
    const prim = el.querySelectorAll('button.onb-btn-primary');
    expect(prim).toHaveLength(1);
    expect(textOf(prim[0])).toContain('[onboarding.billing.cta]');
    expect(el.querySelector('app-onb-help')).not.toBeNull(); // Need help? is on the screen
    expect(el.querySelector('input[type="radio"]')).toBeNull(); // no plans from the server: a single button
    expect(el.textContent).not.toMatch(/[$]|SAR|AUD|USD|credit|\/month/i);
  });

  it('none (member): "Ask the account owner", no payment button', async () => {
    const { el } = await mount(rig(withSub('none'), { role: 'member' }));
    expect(primary(el)).toBeNull();
    expect(textOf(el)).toContain('[onboarding.strip.askOwner]');
    expect(textOf(el)).not.toContain('[onboarding.billing.cta]');
  });

  it('an unknown session (not loaded yet) is treated as a member: owner-only buttons stay hidden', async () => {
    const { el } = await mount(rig(withSub('none'), { role: null }));
    expect(primary(el)).toBeNull();
    expect(textOf(el)).toContain('[onboarding.strip.askOwner]');
  });

  it('pending (owner): confirming title, Check again as the primary, Try again link, nothing step-like', async () => {
    const { el } = await mount(rig(withSub('pending')));
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.pending.title]');
    expect(textOf(el)).toContain('[onboarding.billing.pending.body]');
    expect(textOf(primary(el)!)).toContain('[onboarding.common.checkAgain]');
    expect(buttons(el).some((b) => textOf(b).includes('[onboarding.billing.pending.retry]'))).toBe(true);
    expect(el.querySelector('app-onb-help')).not.toBeNull();
  });

  it('pending (member): Check again stays (read only), Try again is replaced by "Ask the account owner"', async () => {
    const { el } = await mount(rig(withSub('pending'), { role: 'member' }));
    expect(textOf(primary(el)!)).toContain('[onboarding.common.checkAgain]');
    expect(buttons(el).some((b) => textOf(b).includes('[onboarding.billing.pending.retry]'))).toBe(false);
    expect(textOf(el)).toContain('[onboarding.strip.askOwner]');
  });

  it('past_due (owner): update-payment button opens the portal', async () => {
    const r = rig(withSub('past_due', { nextStep: 'connect' }));
    const { el } = await mount(r);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.pastDue.title]');
    expect(textOf(el)).toContain('[onboarding.billing.pastDue.body]');
    primary(el)!.click();
    expect(r.api['billingPortal']).toHaveBeenCalledTimes(1);
    expect(r.go).toHaveBeenCalledWith('https://billing.stripe.com/p/session/abc');
    expect(r.api['checkout']).not.toHaveBeenCalled();
  });

  it('past_due (member): no portal button', async () => {
    const { el } = await mount(rig(withSub('past_due', { nextStep: 'connect' }), { role: 'member' }));
    expect(primary(el)).toBeNull();
    expect(textOf(el)).toContain('[onboarding.strip.askOwner]');
  });

  it('cancelled (owner): Restart subscription starts a new checkout', async () => {
    const r = rig(withSub('cancelled', { nextStep: 'connect', view: 'setup' }));
    const { el } = await mount(r);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.cancelled.title]');
    expect(textOf(el)).toContain('[onboarding.billing.cancelled.body]');
    expect(textOf(primary(el)!)).toContain('[onboarding.billing.cancelled.cta]');
    primary(el)!.click();
    expect(r.api['checkout']).toHaveBeenCalledTimes(1);
    expect(r.go).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/abc');
  });

  it('cancelled (member): ask the owner', async () => {
    const { el } = await mount(rig(withSub('cancelled', { view: 'setup' }), { role: 'member' }));
    expect(primary(el)).toBeNull();
    expect(textOf(el)).toContain('[onboarding.strip.askOwner]');
  });

  it('?checkout=cancel (back from Stripe without paying): "Payment wasn\'t completed" and Try again; never polls', async () => {
    vi.useFakeTimers();
    try {
      const r = rig(withSub('none'), { query: { checkout: 'cancel' } });
      const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
      const { el } = await mount(r);
      expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.cancelReturn.title]');
      expect(textOf(primary(el)!)).toContain('[onboarding.common.tryAgain]');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown ?checkout= value is ignored', async () => {
    const { el } = await mount(rig(withSub('none'), { query: { checkout: 'evil' } }));
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.none.title]');
  });

  it('state not loaded yet: a spinner, no payment screen (never a flash of the wrong card); a failed load offers Try again', async () => {
    const r = rig(null);
    const { f, el } = await mount(r);
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelector('.onb-spinner')).not.toBeNull();
    r.state.failed.set(true);
    f.detectChanges();
    expect(textOf(el)).toContain('[onboarding.errors.ONB_STATE_UNAVAILABLE]');
    expect(buttons(el).some((b) => textOf(b).includes('[onboarding.common.tryAgain]'))).toBe(true);
  });
});

describe('BillingScreen: plans and checkout', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('several named plans: a radio group (first selected), the chosen code is sent, names come from the server', async () => {
    const plans = [{ code: 'p1', name: 'Plan One' }, { code: 'p2', name: 'Plan Two' }];
    const r = rig(withSub('none', { checkout: { available: true, plans } }));
    const { f, el } = await mount(r);
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    expect(textOf(el)).toContain('Plan One');
    expect(textOf(el)).toContain('Plan Two');
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change'));
    f.detectChanges();
    primary(el)!.click();
    expect(r.api['checkout']).toHaveBeenCalledWith('p2');
  });

  it('the plan captured at checkout (prefill) is preselected', async () => {
    const plans = [{ code: 'p1', name: 'One' }, { code: 'p2', name: 'Two' }];
    const r = rig(withSub('none', { checkout: { available: true, plans }, prefill: { planCode: 'p2' } }));
    const { el } = await mount(r);
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((x) => x.checked)).toEqual([false, true]);
    primary(el)!.click();
    expect(r.api['checkout']).toHaveBeenCalledWith('p2');
  });

  it('one plan, or plans without names: a single button, no radios', async () => {
    const one = rig(withSub('none', { checkout: { available: true, plans: [{ code: 'only', name: 'Only plan' }] } }));
    const a = await mount(one);
    expect(a.el.querySelector('input[type="radio"]')).toBeNull();
    primary(a.el)!.click();
    expect(one.api['checkout']).toHaveBeenCalledWith('only');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const unnamed = rig(withSub('none', { checkout: { available: true, plans: [{ code: 'a', name: null }, { code: 'b', name: null }] } }));
    const b = await mount(unnamed);
    expect(b.el.querySelector('input[type="radio"]')).toBeNull();
    primary(b.el)!.click();
    expect(unnamed.api['checkout']).toHaveBeenCalledWith('a');
  });

  it('no plans at all: the checkout body carries no plan', async () => {
    const r = rig(withSub('none'));
    const { el } = await mount(r);
    primary(el)!.click();
    expect(r.api['checkout']).toHaveBeenCalledWith(undefined);
  });

  it('a double click sends ONE request and the button is busy and disabled', async () => {
    const r = rig(withSub('none'));
    const { f, el } = await mount(r);
    const btn = primary(el)!;
    btn.click();
    btn.click();
    f.detectChanges();
    expect(r.api['checkout']).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it.each<[string, unknown]>([
    ['http', 'http://checkout.stripe.com/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['our own origin', `${location.origin}/dashboard`],
    ['a relative path', '/dashboard'],
    ['no url', undefined],
    ['an https URL on another host (R2-11: only Stripe-hosted pages are followed)', 'https://pay.example.test/c/pay/cs_test_1'],
    ['a Stripe look-alike host', 'https://checkout.stripe.com.evil.test/c/pay/cs_test_1'],
  ])('a checkout answer with %s is NOT followed: the payment-page error is shown', async (_n, url) => {
    const r = rig(withSub('none'));
    r.api['checkout'].mockReturnValue(of({ url }));
    const { f, el } = await mount(r);
    primary(el)!.click();
    f.detectChanges();
    expect(r.go).not.toHaveBeenCalled();
    expect(textOf(el)).toContain('[onboarding.errors.STRIPE_ERROR]');
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(r.help.lastError()).toBe('STRIPE_ERROR');
    expect(primary(el)!.disabled).toBe(false); // the merchant can try again
  });

  it.each([['http://evil.test/'], ['https://evil.test/p/session/abc'], ['https://billing.stripe.com.evil.test/p/session/abc']])(
    'a portal answer is checked the same way (%s is not followed)', async (url) => {
      const r = rig(withSub('past_due', { view: 'setup', nextStep: 'connect' }));
      r.api['billingPortal'].mockReturnValue(of({ url }));
      const { f, el } = await mount(r);
      primary(el)!.click();
      f.detectChanges();
      expect(r.go).not.toHaveBeenCalled();
      expect(textOf(el)).toContain('[onboarding.errors.STRIPE_ERROR]');
    });

  it('both Stripe-hosted answers ARE followed (checkout and the billing portal)', async () => {
    const a = rig(withSub('none'));
    a.api['checkout'].mockReturnValue(of({ url: 'https://checkout.stripe.com/c/pay/cs_test_ok' }));
    const ma = await mount(a);
    primary(ma.el)!.click();
    expect(a.go).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_ok');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const b = rig(withSub('past_due', { view: 'setup', nextStep: 'connect' }));
    b.api['billingPortal'].mockReturnValue(of({ url: 'https://billing.stripe.com/p/session/ok' }));
    const mb = await mount(b);
    primary(mb.el)!.click();
    expect(b.go).toHaveBeenCalledWith('https://billing.stripe.com/p/session/ok');
  });

  it('409 (a subscription already exists) is not an error: no message, the state is read again', async () => {
    const r = rig(withSub('none'));
    r.api['checkout'].mockReturnValue(throwError(() => ({ status: 409, error: { error: 'exists' } })));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    const { f, el } = await mount(r);
    primary(el)!.click();
    f.detectChanges();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(r.go).not.toHaveBeenCalled();
    expect(primary(el)!.disabled).toBe(false);
  });

  it('409 and the server now says pending: the screen turns into the confirming view', async () => {
    const r = rig(withSub('none'));
    r.api['checkout'].mockReturnValue(throwError(() => ({ status: 409 })));
    vi.spyOn(r.state, 'reloadNow').mockImplementation(async () => {
      r.state.state.set(withSub('pending'));
      return r.state.state();
    });
    const { f, el } = await mount(r);
    primary(el)!.click();
    await Promise.resolve();
    f.detectChanges();
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.pending.title]');
  });

  it('CHECKOUT_NOT_CONFIGURED: "we\'ll activate your account", the help button becomes the primary, no payment button', async () => {
    const r = rig(withSub('none'));
    r.api['checkout'].mockReturnValue(throwError(() => ({ status: 503, error: { code: 'CHECKOUT_NOT_CONFIGURED' } })));
    const { f, el } = await mount(r);
    primary(el)!.click();
    f.detectChanges();
    expect(textOf(el)).toContain('[onboarding.billing.manual]');
    expect(textOf(primary(el)!)).toContain('[onboarding.help.cta]');
    expect(textOf(el)).not.toContain('[onboarding.billing.cta]');
    expect(r.help.lastError()).toBe('CHECKOUT_NOT_CONFIGURED');
  });

  it('checkout.available === false (or retry.checkout false while unpaid) shows the manual-activation copy from the start', async () => {
    const a = await mount(rig(withSub('none', { checkout: { available: false, plans: [] } })));
    expect(textOf(a.el)).toContain('[onboarding.billing.manual]');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const b = await mount(rig(base({ subscription: { state: 'none', retry: { checkout: false } } })));
    expect(textOf(b.el)).toContain('[onboarding.billing.manual]');
    // pending always has retry.checkout=false (wait): that is NOT "unavailable"
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const c = await mount(rig(base({ subscription: { state: 'pending', retry: { checkout: false } } })));
    expect(textOf(c.el)).not.toContain('[onboarding.billing.manual]');
  });

  it('server errors map to catalogue text and prime Need help (STRIPE_ERROR, PLAN_UNKNOWN, OWNER_ONLY, network, unknown code)', async () => {
    const cases: [unknown, string][] = [
      [{ status: 502, error: { code: 'STRIPE_ERROR', error: 'Stripe said: card_declined sk_live_secret' } }, 'STRIPE_ERROR'],
      [{ status: 422, error: { code: 'PLAN_UNKNOWN' } }, 'PLAN_UNKNOWN'],
      [{ status: 403, error: { code: 'OWNER_ONLY' } }, 'OWNER_ONLY'],
      [{ status: 0 }, 'ONB_NETWORK'],
      [{ status: 500, error: { code: 'SOMETHING_NEW', error: 'raw server text' } }, 'ONB_GENERIC'],
    ];
    for (const [err, code] of cases) {
      TestBed.resetTestingModule();
      document.body.innerHTML = '';
      const r = rig(withSub('none'));
      r.api['checkout'].mockReturnValue(throwError(() => err));
      const { f, el } = await mount(r);
      primary(el)!.click();
      f.detectChanges();
      expect(textOf(el), code).toContain(`[onboarding.errors.${code}]`);
      expect(el.textContent).not.toMatch(/raw server text|card_declined|sk_live/);
      expect(r.help.lastError(), code).toBe(code);
    }
  });

  it('a member that somehow triggers checkout sends nothing (the server stays the truth, the UI never asks)', async () => {
    const r = rig(withSub('none'), { role: 'member' });
    const { f } = await mount(r);
    f.componentInstance.startCheckout();
    f.componentInstance.openPortal();
    expect(r.api['checkout']).not.toHaveBeenCalled();
    expect(r.api['billingPortal']).not.toHaveBeenCalled();
  });

  it('after leaving through the browser back button (page cache) the button is usable again', async () => {
    const r = rig(withSub('none'));
    const { f, el } = await mount(r);
    primary(el)!.click();
    f.detectChanges();
    expect(primary(el)!.disabled).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    f.detectChanges();
    expect(primary(el)!.disabled).toBe(false);
  });
});

describe('BillingScreen: waiting for the payment', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('polls the state every 5 s for 2 minutes, then every 30 s, and calls billing/refresh ONCE after 10 s', async () => {
    const r = rig(withSub('pending'));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    r.api['billingRefresh'].mockReturnValue(throwError(() => ({ status: 429, error: { code: 'RATE_LIMITED' } })));
    const { f, el } = await mount(r);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BILLING_POLL_FAST_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BILLING_REFRESH_AFTER_MS - BILLING_POLL_FAST_MS);
    expect(r.api['billingRefresh']).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BILLING_FAST_WINDOW_MS - BILLING_REFRESH_AFTER_MS);
    expect(reload).toHaveBeenCalledTimes(BILLING_FAST_WINDOW_MS / BILLING_POLL_FAST_MS); // 24 polls in the first 2 minutes
    f.detectChanges();
    expect(textOf(el)).toContain('[onboarding.billing.stillWaiting]');
    await vi.advanceTimersByTimeAsync(BILLING_POLL_SLOW_MS - 1);
    expect(reload).toHaveBeenCalledTimes(24);
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(25);
    await vi.advanceTimersByTimeAsync(BILLING_POLL_SLOW_MS * 2);
    expect(reload).toHaveBeenCalledTimes(27);
    expect(r.api['billingRefresh']).toHaveBeenCalledTimes(1); // still only the one
    expect(el.querySelector('[role="alert"]')).toBeNull(); // a 429 / failed poll never shows an error
  });

  it('a billing/refresh that changed something reads the state at once', async () => {
    const r = rig(withSub('pending'));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    r.api['billingRefresh'].mockReturnValue(of({ changed: true, subscription: { state: 'active' } }));
    await mount(r);
    await vi.advanceTimersByTimeAsync(BILLING_REFRESH_AFTER_MS);
    expect(r.api['billingRefresh']).toHaveBeenCalledTimes(1);
    // 2 polls (5 s, 10 s) + the immediate read after the refresh
    expect(reload.mock.calls.length).toBe(3);
  });

  it('polling stops when the screen is destroyed', async () => {
    const r = rig(withSub('pending'));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    const { f } = await mount(r);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    f.destroy();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r.api['billingRefresh']).not.toHaveBeenCalled(); // destroyed before the 10 s call
  });

  it('?checkout=return never navigates away while the server still says unpaid; it moves on only when the server says active', async () => {
    const r = rig(withSub('none'), { query: { checkout: 'return' } });
    vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    const { f, el } = await mount(r);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.billing.pending.title]'); // a redirect is not proof
    await vi.advanceTimersByTimeAsync(130_000);
    expect(nav).not.toHaveBeenCalled();
    r.state.state.set(withSub('pending'));
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(nav).not.toHaveBeenCalled();
    r.state.state.set(withSub('active', { nextStep: 'business', view: 'setup' }));
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith('/setup/business/name', { replaceUrl: true });
    expect(r.announcer.message()).toContain('[onboarding.billing.confirmed]');
  });

  it('a merchant who is already active (stale link) goes to the landing step without a "payment confirmed" announcement', async () => {
    const r = rig(withSub('active', { nextStep: 'connect', view: 'setup' }));
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    await mount(r);
    expect(nav).toHaveBeenCalledWith('/setup/connect', { replaceUrl: true });
    expect(r.announcer.message()).not.toContain('[onboarding.billing.confirmed]');
  });

  it('active with nothing to resume goes to the dashboard (never back to billing)', async () => {
    const r = rig(withSub('active', { view: 'done', nextStep: null }));
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    await mount(r);
    expect(nav).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });

  it('announces the waiting state for screen readers', async () => {
    const r = rig(withSub('pending'));
    vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    await mount(r);
    expect(r.announcer.message()).toContain('[onboarding.billing.pending.title]');
    await vi.advanceTimersByTimeAsync(BILLING_FAST_WINDOW_MS);
    expect(r.announcer.message()).toContain('[onboarding.billing.stillWaiting]');
  });

  it('Check again asks the server to re-read Stripe (a 429 is fine), then reads the state, and says "checked just now"', async () => {
    const r = rig(withSub('pending'));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    r.api['billingRefresh'].mockReturnValue(throwError(() => ({ status: 429 })));
    const { f, el } = await mount(r);
    primary(el)!.click();
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
    expect(r.api['billingRefresh']).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(textOf(el)).toContain('[onboarding.common.checkedNow]');
    expect(r.announcer.message()).toContain('[onboarding.common.checkedNow]');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(primary(el)!.disabled).toBe(false);
  });

  it('Try again (owner) starts a new checkout from the pending view; a 409 there just re-reads the state', async () => {
    const r = rig(withSub('pending'));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(null);
    r.api['checkout'].mockReturnValue(throwError(() => ({ status: 409 })));
    const { f, el } = await mount(r);
    const retry = buttons(el).find((b) => textOf(b).includes('[onboarding.billing.pending.retry]'))!;
    retry.click();
    f.detectChanges();
    expect(r.api['checkout']).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('BillingScreen: focus and structure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('puts focus on the heading and sets the step_enter event (gate A skips it until active)', async () => {
    const r = rig(withSub('none'));
    const { el } = await mount(r);
    const h1 = el.querySelector('h1')!;
    expect(h1.getAttribute('tabindex')).toBe('-1');
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
    expect(r.api['event']).not.toHaveBeenCalled(); // not active: the server would refuse it
  });

  it('is the selector the dashboard host embeds', () => {
    const meta = (BillingScreen as unknown as { ɵcmp: { selectors: string[][] } }).ɵcmp;
    expect(meta.selectors).toEqual([['app-onb-billing']]);
  });
});
