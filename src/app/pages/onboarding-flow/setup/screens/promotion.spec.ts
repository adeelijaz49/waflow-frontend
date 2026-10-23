import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError, type Observable } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type { OnbFirstPromotion, OnbState } from '../../onb.types';
import { DoneScreen, approvedTemplateCount, catalogCount } from './done';
import { OnbTestChoice, PROMOTION_CAMPAIGN_TYPES, PromotionScreen, builderQueryParams, promotionPreconditionsMet, testOffered, waitLinkOf } from './promotion';
import { PromotionTestScreen, isPlausiblePhone } from './promotion-test';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
@Injectable()
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
  override t(key: string, params?: TranslateParams): string {
    return params ? `[${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}]` : `[${key}]`;
  }
}
@Component({ template: '' }) class Blank {}

const BODY = { en: 'Hi {name}, enjoy 10% off this weekend.', ar: 'مرحباً {name}، استمتع بخصم 10% نهاية الأسبوع.' };
const FP = (over: Partial<OnbFirstPromotion> = {}): OnbFirstPromotion => ({
  ready: true,
  missing: { audience: false, products: false, template: false },
  suggestion: { templateKey: 'promotion_weekend', titleKey: 'promotion_weekend', bodyPreview: BODY, audience: { optedIn: 12, total: 40 }, campaignType: 'store_wide_offer' },
  testRecipient: { masked: '+966 5** *** 1234', needsPhone: false },
  builderHint: { path: '/promotions' },
  sendPolicy: 'platform_number',
  ...over,
});

function makeApi() {
  return {
    getState: vi.fn(() => new Subject<OnbState>()),
    firstPromotion: vi.fn((): Observable<OnbFirstPromotion> => of(FP())),
    firstPromotionState: vi.fn((_s: string): Observable<unknown> => of({})),
    testMessage: vi.fn((_p?: string): Observable<{ sent: boolean; to?: string; templateKey?: string }> => of({ sent: true, to: '+966 5** *** 1234', templateKey: 'x' })),
    templates: vi.fn((): Observable<unknown> => of({ templates: [{ key: 'a', language: 'en', status: 'APPROVED' }, { key: 'b', language: 'en', status: 'PENDING' }, { key: 'c', language: 'en', status: 'approved' }] })),
    event: vi.fn((_b?: unknown): Observable<unknown> => of({})),
    helpContext: vi.fn((): Observable<unknown> => of({})),
    preferences: vi.fn((): Observable<unknown> => of({})),
    notifications: vi.fn((): Observable<unknown> => of([])),
  };
}
type Api = ReturnType<typeof makeApi>;
const httpErr = (status: number, code?: string): Observable<never> => throwError(() => new HttpErrorResponse({ status, error: code ? { code } : null }));

const STATE: OnbState = {
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'promotion',
  steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' }, approvals: { status: 'done' } },
  connection: { level: 'connected', numberMasked: '+966 5** *** 1234', numberFull: '+966500001234', verifiedName: "Sara's Cafe" },
  prompts: { customers: { state: 'done' }, products: { state: 'done' }, counts: { customers: 128, products: 3, services: 2 } },
  firstPromotion: { state: 'ready' },
};

interface Rig<T> {
  fixture: ComponentFixture<T>;
  cmp: T;
  api: Api;
  state: OnbStateService;
  router: Router;
  el: HTMLElement;
  navigate: ReturnType<typeof vi.spyOn>;
  navigateByUrl: ReturnType<typeof vi.spyOn>;
  flush(): Promise<void>;
}

async function mount<T>(cmp: Type<T>, opts: { role?: 'owner' | 'member'; state?: OnbState; api?: Partial<Api>; reload?: OnbState | null } = {}): Promise<Rig<T>> {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const api = { ...makeApi(), ...(opts.api ?? {}) } as Api;
  const session$ = new BehaviorSubject<unknown>({ role: opts.role ?? 'owner', user: { name: 'Sara' } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'promotions', component: Blank }, { path: 'setup/done', component: Blank }, { path: 'setup/promotion', component: Blank },
        { path: 'setup/promotion/test', component: Blank }, { path: 'ai-mode', component: Blank }, { path: 'dashboard', component: Blank },
        { path: 'setup/approvals', component: Blank }, { path: 'setup/connect', component: Blank }, { path: 'setup/customers', component: Blank },
        { path: 'setup/products', component: Blank },
      ]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  state.state.set(opts.state ?? STATE);
  state.loaded.set(true);
  vi.spyOn(state, 'refresh').mockImplementation(() => undefined);
  vi.spyOn(state, 'reloadNow').mockResolvedValue(opts.reload ?? null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  await TestBed.inject(I18nService).init();
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(cmp);
  document.body.appendChild(fixture.nativeElement);
  const rig: Rig<T> = {
    fixture, cmp: fixture.componentInstance, api, state, router, el: fixture.nativeElement as HTMLElement, navigate, navigateByUrl,
    async flush() {
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
  fixture.detectChanges();
  await rig.flush();
  return rig;
}

// 0500001234 in Arabic-Indic digits
const ARABIC_PHONE = String.fromCodePoint(0x660, 0x665, 0x660, 0x660, 0x660, 0x660, 0x661, 0x662, 0x663, 0x664);

const q = (r: { el: HTMLElement }, sel: string): HTMLElement | null => r.el.querySelector<HTMLElement>(sel);
const txt = (r: { el: HTMLElement }, sel?: string): string => ((sel ? q(r, sel) : r.el)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const btnText = (r: { el: HTMLElement }, sel: string): string => (r.el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const click = async (r: Rig<unknown>, sel: string): Promise<void> => {
  (q(r, sel) as HTMLElement).click();
  await r.flush();
};
const setClipboard = (writeText: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('pure helpers', () => {
  it('builder query params: only the three known Promotion types are passed on', () => {
    for (const t of PROMOTION_CAMPAIGN_TYPES) expect(builderQueryParams(t)).toEqual({ openCreate: 'true', campaignType: t });
    expect(builderQueryParams('weird')).toEqual({ openCreate: 'true' });
    expect(builderQueryParams(undefined)).toEqual({ openCreate: 'true' });
    expect(builderQueryParams(42)).toEqual({ openCreate: 'true' });
  });

  it('the wait link goes to Step 4, or to the connection when it must be reconnected', () => {
    expect(waitLinkOf('connected')).toBe('/setup/approvals');
    expect(waitLinkOf(null)).toBe('/setup/approvals');
    expect(waitLinkOf('reconnect_needed')).toBe('/setup/connect');
  });

  it('preconditions: connected (when known) and an approved template; missing audience or products never block', () => {
    expect(promotionPreconditionsMet('connected', FP())).toBe(true);
    expect(promotionPreconditionsMet(null, FP())).toBe(true);
    expect(promotionPreconditionsMet('connected', FP({ missing: { audience: true, products: true, template: false } }))).toBe(true);
    expect(promotionPreconditionsMet('connected', FP({ missing: { template: true } }))).toBe(false);
    expect(promotionPreconditionsMet('reconnect_needed', FP())).toBe(false);
    expect(promotionPreconditionsMet('needs_attention', FP())).toBe(true); // can still send (the server counts it as ready)
    expect(promotionPreconditionsMet('needs_attention', FP({ ready: false }))).toBe(false);
    expect(promotionPreconditionsMet('connected', FP({ ready: false }))).toBe(false); // the server says it cannot send
    expect(promotionPreconditionsMet('connected', null)).toBe(false);
  });

  it('plausible phone: the SAME reader as the customers screens (R6-05): Arabic digits are digits, letters never are, the workspace country rules', () => {
    expect(isPlausiblePhone('+966 50 000 1234')).toBe(true);
    expect(isPlausiblePhone('0500001234')).toBe(true);
    expect(isPlausiblePhone('0500001234', 'AE')).toBe(true);
    expect(isPlausiblePhone(ARABIC_PHONE)).toBe(true); // used to be refused ("no digits")
    expect(isPlausiblePhone(`+${String.fromCodePoint(0x669, 0x666, 0x666)} 50 000 1234`)).toBe(true);
    expect(isPlausiblePhone('abc12345678xyz')).toBe(false); // used to be accepted (the letters were thrown away)
    expect(isPlausiblePhone('050000abc4')).toBe(false);
    expect(isPlausiblePhone('1234567')).toBe(false);
    expect(isPlausiblePhone('1234567890123456')).toBe(false);
    expect(isPlausiblePhone('abc')).toBe(false);
    expect(isPlausiblePhone('')).toBe(false);
    expect(isPlausiblePhone('0500001234', 'OTHER')).toBe(false); // no country code to assume
    expect(isPlausiblePhone('+44 7700 900123', 'OTHER')).toBe(true);
  });

  it('approved templates are counted case-insensitively; catalogue counts add products and services', () => {
    expect(approvedTemplateCount([{ status: 'APPROVED' }, { status: 'approved' }, { status: 'PENDING' }, { status: 'REJECTED' }])).toBe(2);
    expect(approvedTemplateCount(null)).toBe(0);
    expect(approvedTemplateCount([{ key: 'setup_test', status: 'approved' }, { key: 'welcome_optin', status: 'approved' }])).toBe(1);
    expect(catalogCount({ products: 3, services: 2 })).toBe(5);
    expect(catalogCount({ products: 3, services: null })).toBe(3);
    expect(catalogCount({ products: null, services: 4 })).toBe(4);
    expect(catalogCount({ products: null, services: null })).toBeNull();
    expect(catalogCount(null)).toBeNull();
  });
});

describe('Step 5 order: the test message comes first (ruling 4)', () => {
  const OFFER: OnbState = { ...STATE, firstPromotion: { state: 'ready', testMessageCount: 0 } };

  it('testOffered: only a server count of 0, no local decision and no Promotion under way offer the test', () => {
    expect(testOffered({ state: 'ready', testMessageCount: 0 }, false)).toBe(true);
    expect(testOffered({ state: 'locked', testMessageCount: 0 }, false)).toBe(true);
    expect(testOffered({ state: 'ready', testMessageCount: 1 }, false)).toBe(false);
    expect(testOffered({ state: 'ready', testMessageCount: 0 }, true)).toBe(false);
    expect(testOffered({ state: 'started', testMessageCount: 0 }, false)).toBe(false);
    expect(testOffered({ state: 'done', testMessageCount: 0 }, false)).toBe(false);
    expect(testOffered({ state: 'skipped', testMessageCount: 0 }, false)).toBe(false);
    expect(testOffered({ state: 'ready' }, false)).toBe(false);
    expect(testOffered({ state: 'ready', testMessageCount: null }, false)).toBe(false);
    expect(testOffered(null, false)).toBe(false);
    expect(testOffered(undefined, false)).toBe(false);
  });

  it('/setup/promotion leads with the test: replace-navigates to /setup/promotion/test and shows no hand-off meanwhile', async () => {
    const r = await mount(PromotionScreen, { state: OFFER });
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/promotion/test', { replaceUrl: true });
    expect(r.el.querySelector('[data-act="create"]')).toBeNull();
    expect(r.api.firstPromotionState).not.toHaveBeenCalled();
  });

  it('a test that was already sent (count 1) goes straight to the hand-off', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'ready', testMessageCount: 1 } } });
    expect(r.navigateByUrl).not.toHaveBeenCalled();
    expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
  });

  it('a skipped test goes to the hand-off and does not bounce back to the test', async () => {
    const r = await mount(PromotionScreen, { state: OFFER, api: { firstPromotion: vi.fn(() => of(FP())) } });
    expect(r.navigateByUrl).toHaveBeenCalledTimes(1);
    TestBed.inject(OnbTestChoice).decided.set(true);
    await r.flush();
    expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
    expect(r.navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it('the test is not offered while the first template is still waiting for approval (the calm waiting block shows)', async () => {
    const r = await mount(PromotionScreen, { state: OFFER, api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))) } });
    expect(r.navigateByUrl).not.toHaveBeenCalled();
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
  });

  it('a Promotion that is already started or skipped is never preceded by the test', async () => {
    for (const st of ['started', 'skipped']) {
      TestBed.resetTestingModule();
      const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: st, testMessageCount: 0 } }, api: { firstPromotion: vi.fn(() => of(FP({ sendPolicy: 'block' }))) } });
      expect(r.navigateByUrl).not.toHaveBeenCalled();
      expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
    }
  });

  it('"Skip the test" continues to the first Promotion hand-off (no event, no request) and remembers the choice', async () => {
    const r = await mount(PromotionTestScreen, { state: OFFER });
    expect(txt(r, '[data-act="skip"]')).toContain('onboarding.promotion.test.skip');
    await click(r, '[data-act="skip"]');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/promotion');
    expect(TestBed.inject(OnbTestChoice).decided()).toBe(true);
    expect(r.api.testMessage).not.toHaveBeenCalled();
    expect(r.api.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'step_skip' }));
  });

  it('a sent test is remembered at once: the state count becomes 1 and the hand-off no longer redirects', async () => {
    const r = await mount(PromotionTestScreen, { state: OFFER });
    await click(r, '[data-act="send"]');
    expect(r.state.state()?.firstPromotion?.testMessageCount).toBe(1);
    expect(TestBed.inject(OnbTestChoice).decided()).toBe(true);
    expect(r.el.querySelector('[data-act="skip"]')).toBeNull();
  });
});

describe('PromotionScreen (first Promotion hand-off)', () => {
  it('waits calmly (no error) when the first template is not approved, linking to Step 4', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ ready: false, missing: { template: true } }))) } });
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelector('[role="alert"]')).toBeNull();
    const link = r.el.querySelector<HTMLAnchorElement>('a.onb-btn-primary');
    expect(link?.getAttribute('href')).toBe('/setup/approvals');
    expect(r.el.querySelector('[data-act="create"]')).toBeNull();
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
  });

  it('waits and links to the connection when WhatsApp needs to be reconnected', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, connection: { ...STATE.connection, level: 'reconnect_needed' } } });
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelector<HTMLAnchorElement>('a.onb-btn-primary')?.getAttribute('href')).toBe('/setup/connect');
  });

  it('platform-number policy: the primary button builds a starter Promotion through the router (no page reload)', async () => {
    const r = await mount(PromotionScreen);
    expect(txt(r, 'h1')).toContain('onboarding.promotion.first.title');
    expect(txt(r, '.onb-promo-preview')).toContain('enjoy 10% off');
    expect(txt(r)).toContain('onboarding.promotion.first.audience|n=12');
    expect(r.el.querySelector('[data-policy="block"]')).toBeNull();
    expect(r.el.querySelectorAll('.onb-btn-primary').length).toBe(1);
    expect(q(r, '.onb-btn-primary')?.getAttribute('data-act')).toBe('create');
    await click(r, '.onb-btn-primary');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('started');
    expect(r.navigate).toHaveBeenCalledWith(['/promotions'], { queryParams: { openCreate: 'true', campaignType: 'store_wide_offer' } });
    const tree = r.router.createUrlTree(['/promotions'], { queryParams: { openCreate: 'true', campaignType: 'store_wide_offer' } });
    expect(r.router.serializeUrl(tree)).toBe('/promotions?openCreate=true&campaignType=store_wide_offer');
  });

  it('passes the suggestion type of the server (product_promotion, loyalty_reminder) and drops an unknown one', async () => {
    for (const [type, expected] of [['product_promotion', { openCreate: 'true', campaignType: 'product_promotion' }], ['loyalty_reminder', { openCreate: 'true', campaignType: 'loyalty_reminder' }], ['bogus', { openCreate: 'true' }]] as const) {
      TestBed.resetTestingModule();
      const fp = FP();
      (fp.suggestion as { campaignType: string }).campaignType = type;
      const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
      await click(r, '[data-act="create"]');
      expect(r.navigate).toHaveBeenCalledWith(['/promotions'], { queryParams: expected });
    }
  });

  it('a failed "started" write shows the mapped error and does not navigate', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotionState: vi.fn(() => httpErr(402, 'PAYMENT_PAST_DUE')) } });
    await click(r, '[data-act="create"]');
    expect(r.navigate).not.toHaveBeenCalled();
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.PAYMENT_PAST_DUE');
    expect(TestBed.inject(OnbHelpService).lastError()).toBe('PAYMENT_PAST_DUE');
  });

  it('block policy: says sending from the own number is not switched on for the account yet, finishing without sending is the primary action, "done" is never sent', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ sendPolicy: 'block' }))) } });
    expect(txt(r, '[data-policy="block"]')).toContain('onboarding.promotion.first.blocked');
    expect(r.el.querySelectorAll('.onb-btn-primary').length).toBe(1);
    expect(q(r, '.onb-btn-primary')?.getAttribute('data-act')).toBe('finish');
    expect(txt(r, '.onb-btn-primary')).toContain('onboarding.promotion.first.finish');
    expect(r.el.querySelectorAll('[data-act="finish"]').length).toBe(1);
    await click(r, '.onb-btn-primary');
    expect(r.api.firstPromotionState).toHaveBeenCalledTimes(1);
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
    expect(r.state.state()?.firstPromotion?.state).toBe('skipped');
    expect(r.state.state()?.steps?.promotion?.status).toBe('skipped');
    expect(r.state.reloadNow).toHaveBeenCalled();
  });

  it('block policy still lets the merchant create and save a Promotion (secondary button)', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ sendPolicy: 'block' }))) } });
    await click(r, '.onb-btn-secondary[data-act="create"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('started');
    expect(r.navigate).toHaveBeenCalled();
  });

  it('an unknown send policy is treated as block (never implies sending from the merchant number)', async () => {
    const fp = FP();
    delete fp.sendPolicy;
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
    expect(r.el.querySelector('[data-policy="block"]')).not.toBeNull();
  });

  it('platform-number policy: "Finish setup without sending" is a secondary link that completes with "skipped"', async () => {
    const r = await mount(PromotionScreen);
    await click(r, '.onb-promo-links button[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('no opted-in customers: an amber, non-blocking note; create stays enabled', async () => {
    const fp = FP();
    (fp.suggestion as { audience: unknown }).audience = { optedIn: 0, total: 3 };
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
    expect(txt(r, '.onb-alert-warn')).toContain('onboarding.promotion.first.noAudience');
    expect((q(r, '[data-act="create"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('no products: "nothing to promote" with a link to the products step', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ missing: { audience: false, products: true, template: false } }))) } });
    expect(txt(r, '.onb-alert-info')).toContain('onboarding.promotion.first.noProducts');
    expect(r.el.querySelector('.onb-alert-info a')?.getAttribute('href')).toBe('/setup/products');
  });

  it('shows the preview in the UI language, falling back to the other one with its own lang/dir', async () => {
    const r = await mount(PromotionScreen);
    expect(q(r, '.onb-promo-preview')?.getAttribute('lang')).toBe('en');
    expect(q(r, '.onb-promo-preview')?.getAttribute('dir')).toBe('ltr');
    TestBed.resetTestingModule();
    const fp = FP();
    (fp.suggestion as { bodyPreview: unknown }).bodyPreview = { ar: BODY.ar };
    const r2 = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
    expect(q(r2, '.onb-promo-preview')?.getAttribute('lang')).toBe('ar');
    expect(q(r2, '.onb-promo-preview')?.getAttribute('dir')).toBe('rtl');
  });

  it('AI Mode hand-off copies the ready sentence and offers a link (no navigation, builder untouched)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const r = await mount(PromotionScreen);
    await click(r, '[data-act="ai"]');
    await r.flush();
    expect(writeText).toHaveBeenCalledWith('[onboarding.promotion.first.aiPrompt]');
    expect(txt(r, '[role="status"]')).toContain('onboarding.promotion.first.aiCopied');
    expect(r.el.querySelector('a[href="/ai-mode"]')).not.toBeNull();
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('onboarding.promotion.first.aiCopied');
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it('AI Mode hand-off shows the sentence on screen when the browser refuses the clipboard', async () => {
    setClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    const r = await mount(PromotionScreen);
    await click(r, '[data-act="ai"]');
    await r.flush();
    expect(txt(r, '[data-ai-prompt]')).toContain('onboarding.promotion.first.aiPrompt');
    setClipboard(undefined);
    TestBed.resetTestingModule();
    const r2 = await mount(PromotionScreen);
    await click(r2, '[data-act="ai"]');
    expect(txt(r2, '[data-ai-prompt]')).toContain('onboarding.promotion.first.aiPrompt');
  });

  it('a failed load shows the mapped error with a retry that reloads', async () => {
    const first = vi.fn().mockReturnValueOnce(httpErr(0)).mockReturnValue(of(FP()));
    const r = await mount(PromotionScreen, { api: { firstPromotion: first } });
    expect(r.el.querySelector('[role="alert"]')).not.toBeNull();
    await click(r, '.onb-btn-secondary');
    expect(first).toHaveBeenCalledTimes(2);
    expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
  });

  it('an already finished first Promotion goes straight to the celebration', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'done' } } });
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('platform-number policy and a started Promotion: asks the server to verify once, then celebrates when it says done', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'started' } } });
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('done');
    expect(r.api.firstPromotionState).toHaveBeenCalledTimes(1);
    expect(r.navigateByUrl).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const r2 = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'started' } }, reload: { ...STATE, firstPromotion: { state: 'done' } } });
    await vi.waitFor(() => expect(r2.navigateByUrl).toHaveBeenCalledWith('/setup/done'));
    expect(r2.api.firstPromotionState).toHaveBeenCalledTimes(1);
  });

  it('platform-number policy: an unverified "done" answer leaves the merchant here without an error', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'started' } }, api: { firstPromotionState: vi.fn(() => httpErr(409, 'STEP_PREREQUISITE')) } });
    expect(r.el.querySelector('[role="alert"]')).toBeNull();
    expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
  });

  it('block policy never asks the server to verify a send', async () => {
    const r = await mount(PromotionScreen, { state: { ...STATE, firstPromotion: { state: 'started' } }, api: { firstPromotion: vi.fn(() => of(FP({ sendPolicy: 'block' }))) } });
    expect(r.api.firstPromotionState).not.toHaveBeenCalled();
  });

  it('members see the same actions (nothing on this screen is owner-only)', async () => {
    const r = await mount(PromotionScreen, { role: 'member' });
    expect(r.el.querySelector('[data-act="create"]')).not.toBeNull();
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
  });

  it('moves focus to the heading and offers the test message', async () => {
    const r = await mount(PromotionScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(q(r, 'h1')));
    expect(r.el.querySelector('a[href="/setup/promotion/test"]')).not.toBeNull();
  });
});

describe('PromotionTestScreen (test message)', () => {
  it('shows the masked recipient and no phone field when the server picked the login phone', async () => {
    const r = await mount(PromotionTestScreen);
    expect(txt(r, 'h1')).toContain('onboarding.promotion.test.title');
    expect(txt(r, '[data-recipient="masked"]')).toContain('onboarding.promotion.test.body|phone=+966 5** *** 1234');
    expect(r.el.querySelector('input')).toBeNull();
    expect(r.el.querySelectorAll('.onb-btn-primary').length).toBe(1);
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(q(r, 'h1')));
  });

  it('sends without a phone, announces the masked recipient and asks "Did it arrive?"', async () => {
    const r = await mount(PromotionTestScreen);
    await click(r, '[data-act="send"]');
    expect(r.api.testMessage).toHaveBeenCalledWith(undefined);
    expect(txt(r, '[data-sent]')).toContain('onboarding.promotion.test.sent|phone=+966 5** *** 1234');
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('onboarding.promotion.test.sent');
    expect(txt(r, '[data-question]')).toContain('onboarding.promotion.test.arrived');
    await click(r, '[data-act="yes"]');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/promotion');
  });

  it('"No" shows the tips with the verified name and "Send again" sends again', async () => {
    const r = await mount(PromotionTestScreen);
    await click(r, '[data-act="send"]');
    await click(r, '[data-act="no"]');
    expect(txt(r, '[data-tips]')).toContain("onboarding.promotion.test.tips|name=Sara's Cafe");
    await click(r, '[data-act="again"]');
    expect(r.api.testMessage).toHaveBeenCalledTimes(2);
    expect(r.el.querySelector('[data-sent]')).not.toBeNull();
  });

  it('an e-mail-login owner types a number once: a bad number never reaches the server', async () => {
    const fp = FP({ testRecipient: { masked: null, needsPhone: true } });
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
    const input = q(r, 'input') as HTMLInputElement;
    expect(input.type).toBe('tel');
    expect(input.getAttribute('autocomplete')).toBe('tel');
    expect(input.getAttribute('inputmode')).toBe('tel');
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(txt(r)).toContain('onboarding.promotion.test.different');
    await click(r, '[data-act="send"]');
    expect(r.api.testMessage).not.toHaveBeenCalled();
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.TEST_PHONE_INVALID');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = '123';
    input.dispatchEvent(new Event('input'));
    await click(r, '[data-act="send"]');
    expect(r.api.testMessage).not.toHaveBeenCalled();
  });

  it('sends the typed number, keeps it out of storage and shows only the masked echo', async () => {
    const fp = FP({ testRecipient: { masked: null, needsPhone: true } });
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(fp)) } });
    const input = q(r, 'input') as HTMLInputElement;
    input.value = '+966 50 000 9999';
    input.dispatchEvent(new Event('input'));
    await r.flush();
    await click(r, '[data-act="send"]');
    expect(r.api.testMessage).toHaveBeenCalledWith('+966500009999'); // read with the country rules, sent with a plus
    expect(txt(r)).not.toContain('9999');
    expect(JSON.stringify({ ...localStorage })).not.toContain('9999');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('9999');
  });

  describe('the typed number is read like every other number of the flow (R6-01, R6-05)', () => {
    const NEEDS_PHONE = (): OnbFirstPromotion => FP({ testRecipient: { masked: null, needsPhone: true } });
    const typeAndSend = async (r: Rig<PromotionTestScreen>, value: string): Promise<void> => {
      const input = q(r, 'input') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await r.flush();
      await click(r, '[data-act="send"]');
    };

    it('a number in Arabic digits is accepted and sent as "+<digits>"', async () => {
      const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
      await typeAndSend(r, ARABIC_PHONE);
      expect(r.api.testMessage).toHaveBeenCalledWith('+966500001234');
      expect(r.el.querySelector('[data-sent]')).not.toBeNull();
    });

    it.each(['abc12345678xyz', '050000abc4', '0500001234ext5', '12345', ''])('"%s" never reaches the server: the "enter a phone number with the country code" message', async (value) => {
      const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
      await typeAndSend(r, value);
      expect(r.api.testMessage).not.toHaveBeenCalled();
      expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.TEST_PHONE_INVALID');
      expect((q(r, 'input') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
    });

    it.each([['AE', '0500001234', '+971500001234'], ['KW', '50000123', '+96550000123'], ['SA', '500001234', '+966500001234'], ['OTHER', '+44 7700 900123', '+447700900123'], ['OTHER', '0044 7700 900123', '+447700900123']])(
      'the workspace country %s: %s is sent as %s', async (country, typed, sent) => {
        const r = await mount(PromotionTestScreen, { state: { ...STATE, business: { country } }, api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
        await typeAndSend(r, typed);
        expect(r.api.testMessage).toHaveBeenCalledWith(sent);
      });

    it('"Another country": a number without + or 00 is refused locally', async () => {
      const r = await mount(PromotionTestScreen, { state: { ...STATE, business: { country: 'OTHER' } }, api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
      await typeAndSend(r, '07700900123');
      expect(r.api.testMessage).not.toHaveBeenCalled();
      expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.TEST_PHONE_INVALID');
    });

    it('says how a number without a country code is read, next to the phone field only', async () => {
      const r = await mount(PromotionTestScreen, { state: { ...STATE, business: { country: 'AE' } }, api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
      expect(txt(r, '[data-phone-note]')).toBe('[onboarding.customers.phone.note|country=[onboarding.country.AE],code=971]');
      expect(q(r, 'input')!.getAttribute('aria-describedby')).toContain('onb-test-phone-note');
      TestBed.resetTestingModule();
      const masked = await mount(PromotionTestScreen); // the server picked the login phone: no field, no note
      expect(masked.el.querySelector('input')).toBeNull();
      expect(masked.el.querySelector('[data-phone-note]')).toBeNull();
    });

    it('the number a merchant typed for another country is never turned into a Saudi one', async () => {
      const r = await mount(PromotionTestScreen, { state: { ...STATE, business: { country: 'KW' } }, api: { firstPromotion: vi.fn(() => of(NEEDS_PHONE())) } });
      await typeAndSend(r, '0501234567'); // a Saudi-length number in a Kuwaiti workspace is a typo, not a Saudi number
      expect(r.api.testMessage).not.toHaveBeenCalled();
    });
  });

  it('an opted-out recipient: the mapped message and a field for a different phone', async () => {
    const r = await mount(PromotionTestScreen, { api: { testMessage: vi.fn(() => httpErr(422, 'TEST_RECIPIENT_OPTED_OUT')) } });
    await click(r, '[data-act="send"]');
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.TEST_RECIPIENT_OPTED_OUT');
    expect(r.el.querySelector('input[type="tel"]')).not.toBeNull();
    expect(r.el.querySelector('[data-sent]')).toBeNull();
    expect(TestBed.inject(OnbHelpService).lastError()).toBe('TEST_RECIPIENT_OPTED_OUT');
  });

  it('rate limit and number limit show their own copy and keep the merchant on the form', async () => {
    for (const code of ['TEST_RATE_LIMITED', 'TEST_NUMBER_LIMIT']) {
      TestBed.resetTestingModule();
      const r = await mount(PromotionTestScreen, { api: { testMessage: vi.fn(() => httpErr(429, code)) } });
      await click(r, '[data-act="send"]');
      expect(txt(r, '[role="alert"]')).toContain(`onboarding.errors.${code}`);
      expect(r.el.querySelector('[data-act="send"]')).not.toBeNull();
    }
  });

  it('no approved template at send time links to Step 4', async () => {
    const r = await mount(PromotionTestScreen, { api: { testMessage: vi.fn(() => httpErr(409, 'TEST_NO_APPROVED_TEMPLATE')) } });
    await click(r, '[data-act="send"]');
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.TEST_NO_APPROVED_TEMPLATE');
    expect(r.el.querySelector('[role="alert"] a')?.getAttribute('href')).toBe('/setup/approvals');
  });

  it('waits calmly without a send button while the template is not approved', async () => {
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))) } });
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelector('[data-act="send"]')).toBeNull();
    expect(r.el.querySelector('a.onb-btn-primary')?.getAttribute('href')).toBe('/setup/approvals');
  });

  it('a "not sent" answer is shown as an error, not as success', async () => {
    const r = await mount(PromotionTestScreen, { api: { testMessage: vi.fn(() => of({ sent: false })) } });
    await click(r, '[data-act="send"]');
    expect(r.el.querySelector('[data-sent]')).toBeNull();
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.META_ERROR');
  });

  it('can be skipped (the test is optional) and logs nothing with the typed number', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const fp = FP({ testRecipient: { masked: null, needsPhone: true } });
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(fp)), testMessage: vi.fn(() => httpErr(500)) } });
    expect(r.el.querySelector('[data-act="skip"]')).not.toBeNull();
    const input = q(r, 'input') as HTMLInputElement;
    input.value = '+966 50 000 7777';
    input.dispatchEvent(new Event('input'));
    await click(r, '[data-act="send"]');
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('7777');
  });
});

describe('Step 5 never leaves the merchant stuck (G3): every state offers a way to finish the setup', () => {
  const LEVELS = ['connected', 'needs_attention', 'reconnect_needed', null] as const;
  const POLICIES = ['block', 'platform_number', undefined] as const;
  const READY = [true, false, undefined] as const;
  const combos = LEVELS.flatMap((level) => POLICIES.flatMap((policy) => READY.flatMap((ready) => [true, false].map((template) => [level, policy, ready, template] as const))));

  it('covers 72 combinations of connection level, send policy, "ready" answer and approved template', () => {
    expect(combos).toHaveLength(72);
  });

  it.each(combos)('first Promotion screen: connection %s, send policy %s, ready %s, template missing %s: "Finish setup without sending" is there and completes the setup', async (level, policy, ready, template) => {
    const state: OnbState = { ...STATE, connection: { ...STATE.connection, level }, firstPromotion: { state: 'ready', testMessageCount: 1 } };
    const fp = FP({ ready, missing: { audience: false, products: false, template }, sendPolicy: policy });
    const r = await mount(PromotionScreen, { state, api: { firstPromotion: vi.fn(() => of(fp)) } });
    const finish = q(r, '[data-act="finish"]') as HTMLButtonElement | null;
    expect(finish, 'a way to finish').not.toBeNull();
    expect(finish!.disabled).toBe(false);
    expect(r.el.querySelector('app-onb-help'), 'Need help?').not.toBeNull();
    await click(r, '[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledTimes(1);
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped'); // never "done": nothing was sent
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
    expect(r.state.state()?.firstPromotion?.state).toBe('skipped');
    expect(r.state.state()?.steps?.promotion?.status).toBe('skipped');
  });

  it('while no template is approved (waiting): the calm block keeps ONE primary button to Step 4 and offers the finish as a secondary action', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ ready: false, missing: { template: true } }))) } });
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
    expect(q(r, '.onb-btn-primary')?.getAttribute('href')).toBe('/setup/approvals');
    const finish = q(r, '[data-act="finish"]')!;
    expect(finish.classList.contains('onb-btn-primary')).toBe(false);
    expect(txt(r, '[data-act="finish"]')).toContain('onboarding.promotion.first.finish');
    expect(r.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('a template that was rejected (so none is approved) is the same waiting state: the way out is there', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ ready: false, missing: { template: true, audience: true, products: true } }))) } });
    await click(r, '[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('a refused finish shows the mapped error inside the waiting block and the merchant can press it again', async () => {
    const state = vi.fn().mockReturnValueOnce(httpErr(402, 'PAYMENT_PAST_DUE')).mockReturnValue(of({}));
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))), firstPromotionState: state } });
    await click(r, '[data-act="finish"]');
    expect(txt(r, '[role="alert"]')).toContain('onboarding.errors.PAYMENT_PAST_DUE');
    expect(r.navigateByUrl).not.toHaveBeenCalled();
    expect(TestBed.inject(OnbHelpService).lastError()).toBe('PAYMENT_PAST_DUE');
    expect((q(r, '[data-act="finish"]') as HTMLButtonElement).disabled).toBe(false);
    await click(r, '[data-act="finish"]');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('a double press sends ONE request', async () => {
    const pending = new Subject<unknown>();
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))), firstPromotionState: vi.fn(() => pending) } });
    const btnEl = q(r, '[data-act="finish"]') as HTMLButtonElement;
    btnEl.click();
    btnEl.click();
    await r.flush();
    expect(r.api.firstPromotionState).toHaveBeenCalledTimes(1);
    expect(btnEl.disabled).toBe(true);
  });

  it('when the first load FAILS the merchant can retry, finish without sending, or ask for help', async () => {
    const r = await mount(PromotionScreen, { api: { firstPromotion: vi.fn(() => httpErr(0)) } });
    expect(q(r, '[role="alert"]')).not.toBeNull();
    expect(btnText(r, '.onb-btn-secondary')).toContain('onboarding.common.tryAgain');
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
    await click(r, '[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('members get the same way out (nothing on Step 5 is owner-only)', async () => {
    const r = await mount(PromotionScreen, { role: 'member', api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))) } });
    await click(r, '[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
  });

  it('the test screen, waiting for a template: the same finish link, and Need help', async () => {
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => of(FP({ missing: { template: true } }))) } });
    expect(txt(r, 'h1')).toContain('onboarding.promotion.wait.title');
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
    await click(r, '[data-act="finish"]');
    expect(r.api.firstPromotionState).toHaveBeenCalledWith('skipped');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/done');
  });

  it('the test screen, when its load FAILS: Try again, "Skip the test" (on to the hand-off) and Need help', async () => {
    const r = await mount(PromotionTestScreen, { api: { firstPromotion: vi.fn(() => httpErr(0)) } });
    expect(q(r, '[role="alert"]')).not.toBeNull();
    expect(btnText(r, '.onb-btn-secondary')).toContain('onboarding.common.tryAgain');
    expect(r.el.querySelector('app-onb-help')).not.toBeNull();
    await click(r, '[data-act="skip"]');
    expect(r.navigateByUrl).toHaveBeenCalledWith('/setup/promotion');
    expect(TestBed.inject(OnbTestChoice).decided()).toBe(true);
  });
});

describe('DoneScreen (celebration)', () => {
  it('"first Promotion sent" variant with the summary lines (masked number only, counts from the state)', async () => {
    const r = await mount(DoneScreen, { state: { ...STATE, firstPromotion: { state: 'done' } } });
    expect(q(r, 'section')?.getAttribute('data-variant')).toBe('sent');
    expect(txt(r, 'h1')).toContain('onboarding.done.title');
    expect(txt(r)).toContain('onboarding.done.sent');
    expect(txt(r, '[data-line="connected"]')).toContain('onboarding.done.connected|phone=+966 5** *** 1234');
    expect(txt(r, '[data-line="connected"]')).toContain("Sara's Cafe");
    expect(txt(r, '[data-line="templates"]')).toContain('onboarding.done.templates|n=2');
    expect(txt(r, '[data-line="customers"]')).toContain('onboarding.done.customers|n=128');
    expect(txt(r, '[data-line="products"]')).toContain('onboarding.home.count.products|n=5');
    expect(txt(r)).not.toContain('500001234');
    expect(r.el.querySelector('[data-policy="block"]')).toBeNull();
    expect(r.el.querySelectorAll('.onb-btn-primary').length).toBe(1);
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('onboarding.done.title');
    await vi.waitFor(() => expect(document.activeElement).toBe(q(r, 'h1')));
  });

  it('"setup finished" variant under the block policy says nothing was sent from the merchant number', async () => {
    const r = await mount(DoneScreen, { state: { ...STATE, firstPromotion: { state: 'skipped' } }, api: { firstPromotion: vi.fn(() => of(FP({ sendPolicy: 'block' }))) } });
    expect(q(r, 'section')?.getAttribute('data-variant')).toBe('finished');
    expect(txt(r)).toContain('onboarding.done.finished');
    expect(txt(r)).not.toContain('onboarding.done.sent');
    expect(txt(r, '[data-policy="block"]')).toContain('onboarding.promotion.first.blocked');
  });

  it('"setup finished" under the platform-number policy has no block note', async () => {
    const r = await mount(DoneScreen, { state: { ...STATE, firstPromotion: { state: 'skipped' } } });
    expect(r.el.querySelector('[data-policy="block"]')).toBeNull();
  });

  it('leaves out lines it cannot know (failed template call, missing counts)', async () => {
    const r = await mount(DoneScreen, {
      state: { ...STATE, firstPromotion: { state: 'skipped' }, prompts: { counts: {} }, connection: { level: 'connected' } },
      api: { templates: vi.fn(() => httpErr(500)), firstPromotion: vi.fn(() => httpErr(500)) },
    });
    expect(r.el.querySelector('[data-line]')).toBeNull();
    expect(r.el.querySelector('[data-policy="block"]')).toBeNull();
    expect(r.el.querySelector('[data-act="dashboard"]')).not.toBeNull();
  });

  it('"Go to my dashboard" re-reads the state and then lands on /dashboard through the router', async () => {
    const r = await mount(DoneScreen);
    await click(r, '[data-act="dashboard"]');
    await vi.waitFor(() => expect(r.navigateByUrl).toHaveBeenCalledWith('/dashboard'));
    expect(r.state.reloadNow).toHaveBeenCalled();
  });

  it('still lands on the dashboard when the re-read fails', async () => {
    const r = await mount(DoneScreen);
    (r.state.reloadNow as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    await click(r, '[data-act="dashboard"]');
    await vi.waitFor(() => expect(r.navigateByUrl).toHaveBeenCalledWith('/dashboard'));
  });

  it('the check mark animation is switched off for visitors who ask for less motion', async () => {
    const css = await readCss();
    if (css === null) return;
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*onb-promo-check[^}]*animation: none/);
  });
});

async function readCss(): Promise<string | null> {
  try {
    const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
    if (!proc) return null;
    // @ts-ignore node built-in, there is no @types/node in this project
    const fs = (await import(/* @vite-ignore */ 'node:fs')) as unknown as { readFileSync(p: string, e: 'utf8'): string };
    const root = proc.cwd().split(String.fromCharCode(92)).join('/');
    return fs.readFileSync(`${root}/src/app/pages/onboarding-flow/setup/screens/onb-promotion.css`, 'utf8');
  } catch {
    return null;
  }
}
