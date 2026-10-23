import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError, type Observable } from 'rxjs';
import type { MockInstance } from 'vitest';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { ONB_EXTERNAL_LINKS } from '../../onb-links';
import { OnbStateService } from '../../onb-state.service';
import type { OnbApprovalRow, OnbApprovalsResponse, OnbState, OnbTemplateRow } from '../../onb.types';
import {
  APPROVALS_DEFAULT_COOLDOWN_S, APPROVALS_POLL_MS, ApprovalsScreen, displayNameView, isRepeatedRejection, messagingTier, metaStatusOf, recommendationOf,
  relativeTime, rowState, safeHttps, templateCounts, visibleTemplates, type TemplateRowView,
} from './approvals';

vi.setConfig({ testTimeout: 30000 });

// The fake catalogue "has" every key except the ones a real catalogue would not have: a display-name reason called UNKNOWN and a template
// rejection reason that is not one of the Meta codes written in the catalogue (so the generic sentence is what the screen falls back to).
const KNOWN_TEMPLATE_REASONS = /\.templates\.reason\.(INVALID_FORMAT|ABUSIVE_CONTENT|INCORRECT_CATEGORY|SCAM|TAG_CONTENT_MISMATCH|generic)$/;
const absent = (k: string): boolean => k.endsWith('.reason.UNKNOWN') || (k.includes('.templates.reason.') && !KNOWN_TEMPLATE_REASONS.test(k));
const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' && !absent(k) ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) =>
      typeof k === 'string' && !absent(k) ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined,
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

const SECURITY = 'https://business.facebook.com/settings/security';
const PAY_SETTINGS = 'https://business.facebook.com/billing_hub/payment_settings';
const PAY_HELP = 'https://www.facebook.com/business/help/payment-method';
// A link the SERVER sends on the row. Deliberately different from the ONB_EXTERNAL_LINKS fallback, so the specs prove that the row link wins.
const MANAGER = 'https://business.facebook.com/latest/whatsapp_manager';

const row = (key: string, status: string, extra: Partial<OnbApprovalRow> = {}): OnbApprovalRow => ({ key, status, blocking: false, ...extra });
const ROWS = (over: Record<string, Partial<OnbApprovalRow>> = {}): OnbApprovalRow[] =>
  [
    row('verification', 'waiting', { links: { securityCenter: SECURITY } }),
    row('displayName', 'waiting', { value: { value: "Sara's Cafe", canEdit: true, editsRemaining: null, rejectionKey: null } }),
    row('payment', 'needs_you', { links: { paymentSettings: PAY_SETTINGS, paymentHelp: PAY_HELP } }),
    row('messagingLimit', 'waiting', { value: { tierNumber: 250, raw: 'TIER_250' }, links: { whatsappManager: MANAGER } }),
    row('templates', 'waiting'),
  ].map((r) => ({ ...r, ...(over[r.key] ?? {}) }));
const ALL_DONE = (): OnbApprovalRow[] => ROWS({
  verification: { status: 'done' }, displayName: { status: 'done' }, payment: { status: 'done' }, messagingLimit: { status: 'done' }, templates: { status: 'done' },
});

const tpl = (key: string, language: string, status: string, extra: Partial<TemplateRowView> = {}): TemplateRowView => ({
  key, language, status, category: 'MARKETING', title: { en: `Title ${key}`, ar: `Ar ${key}` }, ...extra,
});
const SEVEN: TemplateRowView[] = [
  tpl('welcome_optin', 'en', 'APPROVED'), tpl('promotion_weekend', 'en', 'APPROVED'), tpl('promotion_new_arrival', 'en', 'APPROVED'),
  tpl('comeback', 'en', 'APPROVED'), tpl('points_balance', 'en', 'APPROVED'), tpl('order_confirmation', 'en', 'PENDING'), tpl('booking_confirmation', 'en', 'PENDING'),
];

function makeApi() {
  return {
    getState: vi.fn(() => new Subject<OnbState>()),
    approvals: vi.fn((): Observable<OnbApprovalsResponse> => of({ rows: ROWS(), overall: 'waiting', checkedAt: new Date().toISOString() })),
    templates: vi.fn((): Observable<{ templates: TemplateRowView[] }> => of({ templates: SEVEN })),
    connectionRefresh: vi.fn((): Observable<unknown> => of({})),
    paymentConfirmed: vi.fn((): Observable<unknown> => of({})),
    displayName: vi.fn((_n: string): Observable<unknown> => of({})),
    templatesSubmit: vi.fn((): Observable<unknown> => of({})),
    templateResubmit: vi.fn((_k: string, _l: string): Observable<unknown> => of({})),
    event: vi.fn((_b?: unknown): Observable<unknown> => of({})),
    helpContext: vi.fn((): Observable<unknown> => of({})),
    preferences: vi.fn((): Observable<unknown> => of({})),
    promptDone: vi.fn((): Observable<unknown> => of({})),
    notifications: vi.fn((): Observable<unknown> => of([])),
  };
}
type Api = ReturnType<typeof makeApi>;
const httpErr = (status: number, code?: string, headers?: HttpHeaders): Observable<never> =>
  throwError(() => new HttpErrorResponse({ status, error: code ? { code } : null, headers }));

const STATE: OnbState = {
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'approvals',
  steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } },
  prompts: { customers: { state: 'pending' }, products: { state: 'pending' } },
};

interface Rig {
  fixture: ComponentFixture<ApprovalsScreen>;
  cmp: ApprovalsScreen;
  api: Api;
  state: OnbStateService;
  el: HTMLElement;
  flush(ms?: number): Promise<void>;
}

async function mount(opts: { role?: 'owner' | 'member'; state?: OnbState; api?: Partial<Api> } = {}): Promise<Rig> {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const api = { ...makeApi(), ...(opts.api ?? {}) } as Api;
  const session$ = new BehaviorSubject<unknown>({ role: opts.role ?? 'owner', user: { name: 'Sara' } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'setup/customers', component: Blank }, { path: 'setup/products', component: Blank }, { path: 'setup/promotion', component: Blank },
        { path: 'setup/business/cr', component: Blank },
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
  await TestBed.inject(I18nService).init();
  const fixture = TestBed.createComponent(ApprovalsScreen);
  const rig: Rig = {
    fixture, cmp: fixture.componentInstance, api, state, el: fixture.nativeElement as HTMLElement,
    async flush(ms = 0) {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    },
  };
  fixture.detectChanges();
  await rig.flush();
  return rig;
}

const q = (r: Rig, sel: string): HTMLElement | null => r.el.querySelector<HTMLElement>(sel);
const qa = (r: Rig, sel: string): HTMLElement[] => Array.from(r.el.querySelectorAll<HTMLElement>(sel));
const txt = (r: Rig, sel: string): string => (q(r, sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rowEl = (r: Rig, key: string): HTMLElement => q(r, `li[data-key="${key}"]`) as HTMLElement;
const rowTxt = (r: Rig, key: string): string => (rowEl(r, key).textContent ?? '').replace(/\s+/g, ' ').trim();
const btn = (parent: HTMLElement, label: string): HTMLButtonElement | undefined =>
  Array.from(parent.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

let hidden = false;
const setVisibility = (v: 'visible' | 'hidden'): void => {
  hidden = v === 'hidden';
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};
let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (hidden) setVisibility('visible');
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  localStorage.clear();
});

describe('ApprovalsScreen: the page', () => {
  it('shows the heading, the calm lead, five rows in order, and a "Need help?" button', async () => {
    const r = await mount();
    expect(txt(r, 'h1')).toBe('[onboarding.approvals.title]');
    expect(txt(r, '.onb-lead')).toBe('[onboarding.approvals.body]');
    expect(qa(r, 'li.onb-appr-row').map((e) => e.getAttribute('data-key'))).toEqual(['verification', 'displayName', 'payment', 'messagingLimit', 'templates']);
    expect(rowEl(r, 'verification').querySelector('h2')?.textContent).toBe('[onboarding.approvals.row.verification]');
    expect(rowEl(r, 'messagingLimit').querySelector('h2')?.textContent).toBe('[onboarding.approvals.row.limit]');
    expect(q(r, 'app-onb-help')).not.toBeNull();
    expect(q(r, 'h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('loads approvals and templates once on open', async () => {
    const r = await mount();
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
    expect(r.api.templates).toHaveBeenCalledTimes(1);
  });

  it('while loading it shows a status spinner, not empty rows', async () => {
    const pending = new Subject<OnbApprovalsResponse>();
    const r = await mount({ api: { approvals: vi.fn(() => pending) } });
    expect(q(r, '.onb-appr-loading[role="status"]')).not.toBeNull();
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(0);
    pending.next({ rows: ROWS() });
    await r.flush();
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
  });

  it('a failed first load shows the mapped error and "try again" reloads', async () => {
    let fail = true;
    const r = await mount({ api: { approvals: vi.fn(() => (fail ? httpErr(0) : of({ rows: ROWS() }))) } });
    expect(txt(r, '[role="alert"]')).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(0);
    fail = false;
    btn(r.el, '[onboarding.common.tryAgain]')!.click();
    await r.flush();
    expect(q(r, '[role="alert"]')).toBeNull();
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
  });

  it('the templates request failing does not break the page: the row says "checking" and offers no submit button', async () => {
    const r = await mount({ api: { templates: vi.fn(() => httpErr(500)) } });
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
    expect(rowTxt(r, 'templates')).toContain('[onboarding.approvals.verification.unknown]');
    expect(btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.submit]')).toBeUndefined();
  });
});

describe('ApprovalsScreen: five rows x done / waiting / needs you / unknown', () => {
  const KEYS = ['verification', 'displayName', 'payment', 'messagingLimit', 'templates'];
  const EXPECT: [string | undefined, string, string][] = [
    ['done', 'done', '[onboarding.stepstatus.done]'],
    ['waiting', 'waiting', '[onboarding.stepstatus.waiting]'],
    ['needs_you', 'needs', '[onboarding.stepstatus.needsYou]'],
    ['something_new', 'unknown', '[onboarding.stepstatus.checking]'],
    [undefined, 'unknown', '[onboarding.stepstatus.checking]'],
  ];
  for (const key of KEYS) {
    it.each(EXPECT)(`${key}: server status %s shows the %s state (icon + word)`, async (status, state, word) => {
      const rows = ROWS().filter((x) => x.key !== key);
      if (status !== undefined) rows.push(row(key, status));
      const r = await mount({ api: { approvals: vi.fn(() => of({ rows })) } });
      const el = rowEl(r, key);
      expect(el.getAttribute('data-state')).toBe(state);
      const badge = el.querySelector('.onb-badge') as HTMLElement;
      expect(badge.textContent).toContain(word);
      expect(badge.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBeTruthy(); // never colour alone
    });
  }

  it('an unexpected row key is ignored and nothing is blocked', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: [...ROWS(), row('mystery', 'needs_you')] })) } });
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
  });
});

describe('ApprovalsScreen: business verification', () => {
  it.each([
    ['done', 'done'], ['waiting', 'waiting'], ['needs_you', 'needs'], ['odd', 'unknown'],
  ])('%s shows the matching sentence', async (status, key) => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status } }) })) } });
    expect(rowTxt(r, 'verification')).toContain(`[onboarding.approvals.verification.${key}]`);
  });

  it('needs you: the Security Center link opens in a new tab with noopener; waiting and done show none', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status: 'needs_you' } }) })) } });
    const a = rowEl(r, 'verification').querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toBe(SECURITY);
    expect(a.rel).toContain('noopener');
    expect(a.textContent).toContain('[onboarding.approvals.verification.open]');
    TestBed.resetTestingModule();
    const w = await mount();
    expect(rowEl(w, 'verification').querySelector('a')).toBeNull();
  });

  it('a link that is not https is never used (the constant is used instead)', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status: 'needs_you', links: { securityCenter: 'javascript:alert(1)' } } }) })) } });
    const a = rowEl(r, 'verification').querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toBe(safeHttps(ONB_EXTERNAL_LINKS.metaSecurityCenter));
    expect(a.getAttribute('href')).not.toContain('javascript');
  });

  it('a skipped commercial registration number adds the link to Step 1 until verification is done', async () => {
    const withCr: OnbState = { ...STATE, business: { crSkipped: true } };
    const r = await mount({ state: withCr });
    const a = rowEl(r, 'verification').querySelector('a[href="/setup/business/cr"]');
    expect(a?.textContent).toContain('[onboarding.approvals.verification.addCr]');
    TestBed.resetTestingModule();
    const done = await mount({ state: withCr, api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status: 'done' } }) })) } });
    expect(rowEl(done, 'verification').querySelector('a[href="/setup/business/cr"]')).toBeNull();
    TestBed.resetTestingModule();
    const none = await mount();
    expect(rowEl(none, 'verification').querySelector('a[href="/setup/business/cr"]')).toBeNull();
  });
});

describe('ApprovalsScreen: display name', () => {
  const declined = (value: Record<string, unknown>) => ({ rows: ROWS({ displayName: { status: 'needs_you', value: { value: 'Bad Name', canEdit: true, editsRemaining: null, rejectionKey: null, ...value } } }) });

  it('shows the requested name and the status sentence', async () => {
    const r = await mount();
    expect(rowEl(r, 'displayName').querySelector('.onb-appr-name')?.textContent).toBe("Sara's Cafe");
    expect(rowTxt(r, 'displayName')).toContain('[onboarding.approvals.name.waiting]');
  });

  it.each([
    'NAME_EMPLOYEE_ISSUE', 'NAME_INDIVIDUAL_ISSUE', 'NAME_ENDCLIENT_NOTRELATED', 'NAME_FORMAT_UNACCEPTABLE', 'NAME_NOT_CONSISTENT',
  ])('declined with %s shows its reason, the 10-changes rule and the edit form', async (key) => {
    const r = await mount({ api: { approvals: vi.fn(() => of(declined({ rejectionKey: key }))) } });
    const el = rowEl(r, 'displayName');
    expect(el.textContent).toContain('[onboarding.approvals.name.needs]');
    expect(el.querySelector('.onb-alert-warn')?.textContent).toContain(`[onboarding.approvals.name.reason.${key}]`);
    expect(el.textContent).toContain('[onboarding.approvals.name.limit]');
    expect(el.querySelector('form')).not.toBeNull();
  });

  it('an UNKNOWN rejection has no reason line, only the generic sentence; editsRemaining is shown when known', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of(declined({ rejectionKey: 'UNKNOWN', editsRemaining: 7 }))) } });
    const el = rowEl(r, 'displayName');
    expect(el.querySelector('.onb-alert-warn')).toBeNull();
    expect(el.textContent).toContain('[onboarding.approvals.name.needs]');
    expect(el.textContent).toContain('[onboarding.approvals.name.remaining|n=7]');
  });

  it('a member sees the status but no form; so does an owner when the server says canEdit is false', async () => {
    const m = await mount({ role: 'member', api: { approvals: vi.fn(() => of(declined({ rejectionKey: 'NAME_NOT_CONSISTENT' }))) } });
    expect(rowEl(m, 'displayName').textContent).toContain('[onboarding.approvals.name.needs]');
    expect(rowEl(m, 'displayName').querySelector('form')).toBeNull();
    TestBed.resetTestingModule();
    const o = await mount({ api: { approvals: vi.fn(() => of(declined({ canEdit: false }))) } });
    expect(rowEl(o, 'displayName').querySelector('form')).toBeNull();
  });

  it('the form: an empty name is refused locally, a new name is sent trimmed, success is announced', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => of(n++ === 0 ? declined({ rejectionKey: 'NAME_FORMAT_UNACCEPTABLE' }) : { rows: ROWS() })) } });
    const form = rowEl(r, 'displayName').querySelector('form') as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    expect(form.querySelector('label')?.getAttribute('for')).toBe(input.id);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await r.flush();
    expect(r.api.displayName).not.toHaveBeenCalled();
    expect(txt(r, '#onb-appr-name-err')).toBe('[onboarding.errors.VALIDATION_FAILED]');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('onb-appr-name-err');

    input.value = '  Sara Cafe  ';
    input.dispatchEvent(new Event('input'));
    await r.flush();
    expect(q(r, '#onb-appr-name-err')).toBeNull();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await r.flush();
    expect(r.api.displayName).toHaveBeenCalledWith('Sara Cafe');
    expect(rowEl(r, 'displayName').textContent).toContain('[onboarding.approvals.name.sent]');
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.approvals.name.sent]');
    expect(r.api.approvals).toHaveBeenCalledTimes(2); // re-read after the change
  });

  it('a refused resubmit shows the mapped error under the field and keeps the form', async () => {
    const r = await mount({
      api: { approvals: vi.fn(() => of(declined({ rejectionKey: 'NAME_NOT_CONSISTENT' }))), displayName: vi.fn(() => httpErr(403, 'OWNER_ONLY')) },
    });
    const form = rowEl(r, 'displayName').querySelector('form') as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    input.value = 'New Name';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await r.flush();
    expect(txt(r, '#onb-appr-name-err')).toBe('[onboarding.errors.OWNER_ONLY]');
    expect(rowEl(r, 'displayName').querySelector('form')).not.toBeNull();
  });

  it('a name typed in Arabic keeps its own direction (user text)', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of(declined({ rejectionKey: 'NAME_NOT_CONSISTENT' }))) } });
    const input = rowEl(r, 'displayName').querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('dir')).toBe('auto');
  });
});

describe('ApprovalsScreen: payment method (self-attestation)', () => {
  it('needs you: the two links, the honest "we cannot see this" line and the confirm button; never says "verified"', async () => {
    const r = await mount();
    const el = rowEl(r, 'payment');
    expect(el.textContent).toContain('[onboarding.approvals.payment.body]');
    expect(el.textContent).toContain('[onboarding.approvals.payment.cantSee]');
    const links = Array.from(el.querySelectorAll('a[target="_blank"]')) as HTMLAnchorElement[];
    expect(links.map((a) => a.href)).toEqual([PAY_SETTINGS, PAY_HELP]);
    expect(links.every((a) => a.rel.includes('noopener'))).toBe(true);
    expect(btn(el, '[onboarding.approvals.payment.confirm]')).toBeDefined();
    expect(el.textContent).not.toMatch(/verified/i);
  });

  it('links that are missing or not https are not rendered', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ payment: { links: { paymentSettings: 'http://x.test', paymentHelp: 'data:text/html,hi' } } }) })) } });
    expect(rowEl(r, 'payment').querySelectorAll('a')).toHaveLength(0);
    expect(btn(rowEl(r, 'payment'), '[onboarding.approvals.payment.confirm]')).toBeDefined();
  });

  it('"I\'ve added my card" calls the endpoint, shows Done with "You told us you added a card" and announces it', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS(n++ === 0 ? {} : { payment: { status: 'done' } }) })) } });
    btn(rowEl(r, 'payment'), '[onboarding.approvals.payment.confirm]')!.click();
    await r.flush();
    expect(r.api.paymentConfirmed).toHaveBeenCalledTimes(1);
    const el = rowEl(r, 'payment');
    expect(el.getAttribute('data-state')).toBe('done');
    expect(el.textContent).toContain('[onboarding.approvals.payment.confirmed]');
    expect(el.querySelector('a')).toBeNull();
    expect(btn(el, '[onboarding.approvals.payment.confirm]')).toBeUndefined();
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.approvals.payment.confirmed]');
  });

  it('a failing confirmation shows the error and leaves the row as it was', async () => {
    const r = await mount({ api: { paymentConfirmed: vi.fn(() => httpErr(0)) } });
    btn(rowEl(r, 'payment'), '[onboarding.approvals.payment.confirm]')!.click();
    await r.flush();
    expect(rowEl(r, 'payment').getAttribute('data-state')).toBe('needs');
    expect(rowEl(r, 'payment').querySelector('[role="alert"]')?.textContent).toBe('[onboarding.errors.ONB_NETWORK]');
  });

  it('a member may confirm too (the endpoint is open to any member; the server decides)', async () => {
    const r = await mount({ role: 'member' });
    expect(btn(rowEl(r, 'payment'), '[onboarding.approvals.payment.confirm]')).toBeDefined();
  });
});

describe('ApprovalsScreen: messaging limit', () => {
  const limit = (value: unknown, links?: OnbApprovalRow['links']) => ({ rows: ROWS({ messagingLimit: { value, links } }) });

  it('with a tier number it says what Meta allows (formatted count) and promises nothing else', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of(limit({ tierNumber: 250, raw: 'TIER_250' }))) } });
    expect(rowTxt(r, 'messagingLimit')).toContain('[onboarding.approvals.limit.value|count=250]');
    expect(rowTxt(r, 'messagingLimit')).not.toContain('unknown');
    TestBed.resetTestingModule();
    const big = await mount({ api: { approvals: vi.fn(() => of(limit({ tierNumber: 2000, raw: 'TIER_2K' }))) } });
    expect(rowTxt(big, 'messagingLimit')).toContain('[onboarding.approvals.limit.value|count=2,000]');
  });

  it.each([
    ['no tier number', { tierNumber: null, raw: 'UNTIERED' }],
    ['no value at all', undefined],
    ['a string value', 'TIER_250'],
    ['zero', { tierNumber: 0 }],
    ['negative', { tierNumber: -5 }],
    ['not a number', { tierNumber: 'lots' }],
  ])('%s -> "Meta has set your limit" with the WhatsApp Manager link', async (_n, value) => {
    const r = await mount({ api: { approvals: vi.fn(() => of(limit(value))) } });
    const el = rowEl(r, 'messagingLimit');
    expect(el.textContent).toContain('[onboarding.approvals.limit.unknown]');
    expect(el.textContent).not.toContain('limit.value');
    const a = el.querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toBe('https://business.facebook.com/wa/manage/home/'); // no link on the row: the fallback, which is the backend default
    expect(a.href).toBe(safeHttps(ONB_EXTERNAL_LINKS.whatsappManager));
    expect(a.textContent).toContain('[onboarding.approvals.limit.open]');
  });

  it('a link the SERVER sends on the row is preferred over the fallback constant', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of(limit({ tierNumber: null, raw: 'UNTIERED' }, { whatsappManager: MANAGER }))) } });
    const a = rowEl(r, 'messagingLimit').querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toBe(MANAGER);
    expect(a.href).not.toBe(safeHttps(ONB_EXTERNAL_LINKS.whatsappManager));
    expect(a.rel).toContain('noopener');
  });

  it('a server link that is not https is ignored and the fallback is used', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of(limit(null, { whatsappManager: 'javascript:alert(1)' }))) } });
    const a = rowEl(r, 'messagingLimit').querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(a.href).toBe(safeHttps(ONB_EXTERNAL_LINKS.whatsappManager));
  });

  it('without a server link the documented constant is used', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ messagingLimit: { value: null, links: undefined } }) })) } });
    expect((rowEl(r, 'messagingLimit').querySelector('a') as HTMLAnchorElement).href).toBe(safeHttps(ONB_EXTERNAL_LINKS.whatsappManager));
  });
});

describe('ApprovalsScreen: message templates', () => {
  it('summarises "5 of 7 approved, 2 waiting" and expands to the list with badges and language pills', async () => {
    const r = await mount();
    const el = rowEl(r, 'templates');
    expect(el.textContent).toContain('[onboarding.approvals.templates.summary|approved=5,total=7,waiting=2]');
    expect(el.querySelector('#onb-appr-tpls')).toBeNull();
    const toggle = btn(el, '[onboarding.approvals.templates.show]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await r.flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('[onboarding.approvals.templates.hide]');
    const items = qa(r, '.onb-appr-tpl');
    expect(items).toHaveLength(7);
    expect(items[0].textContent).toContain('Title welcome_optin');
    expect(items[0].querySelector('app-lang-pill')).not.toBeNull();
    expect(items[0].querySelector('app-approval-badge')?.textContent).toContain('[status.meta.APPROVED]');
    expect(items[5].querySelector('app-approval-badge')?.textContent).toContain('[status.meta.PENDING]');
  });

  it('a rejected template shows the reason in plain words and "try again", which resubmits that template only', async () => {
    const list = [...SEVEN.slice(0, 5), tpl('order_confirmation', 'en', 'REJECTED', { rejectedReason: 'INVALID_FORMAT' }), tpl('booking_confirmation', 'en', 'PENDING')];
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: list })) } });
    btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.show]')!.click();
    await r.flush();
    const item = qa(r, '.onb-appr-tpl')[5];
    expect(item.textContent).toContain('[onboarding.approvals.templates.rejected]');
    expect(item.querySelector('[data-reason]')?.textContent?.trim()).toBe('[onboarding.approvals.templates.reason.INVALID_FORMAT]');
    expect(rowTxt(r, 'templates')).toContain('approved=5,total=7,waiting=1');
    expect(item.querySelector('[data-repeated]')).toBeNull(); // a first rejection: trying again is fine
    btn(item, '[onboarding.common.tryAgain]')!.click();
    await r.flush();
    expect(r.api.templateResubmit).toHaveBeenCalledTimes(1);
    expect(r.api.templateResubmit).toHaveBeenCalledWith('order_confirmation', 'en');
    expect(r.api.templates).toHaveBeenCalledTimes(2);
  });

  describe('why Meta rejected a template (R6-09): plain words in both languages, never the raw code', () => {
    const open = async (extra: Partial<TemplateRowView>): Promise<{ r: Rig; item: HTMLElement }> => {
      const list = [...SEVEN.slice(0, 5), tpl('order_confirmation', 'en', 'REJECTED', extra), tpl('booking_confirmation', 'en', 'PENDING')];
      const r = await mount({ api: { templates: vi.fn(() => of({ templates: list })) } });
      btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.show]')!.click();
      await r.flush();
      return { r, item: qa(r, '.onb-appr-tpl')[5] };
    };

    it.each(['INVALID_FORMAT', 'ABUSIVE_CONTENT', 'INCORRECT_CATEGORY', 'SCAM', 'TAG_CONTENT_MISMATCH', ' invalid_format ', 'Invalid-Format'])(
      'the Meta code %j has its own sentence', async (code) => {
        const { item } = await open({ rejectedReason: code });
        const key = code.trim().toUpperCase().replace(/[\s-]+/g, '_');
        expect(item.querySelector('[data-reason]')?.textContent?.trim()).toBe(`[onboarding.approvals.templates.reason.${key}]`);
      });

    it.each([['UNKNOWN'], ['Variable at the start'], ['<b>bold</b>'], [''], [null], ['x'.repeat(200)]])(
      'a reason the catalogue does not know (%j) shows the generic sentence and never the raw text', async (reason) => {
        const { item } = await open({ rejectedReason: reason as string | null });
        expect(item.querySelector('[data-reason]')?.textContent?.trim()).toBe('[onboarding.approvals.templates.reason.generic]');
        if (typeof reason === 'string' && reason.length > 3) expect(item.textContent).not.toContain(reason);
      });

    it('shows what Meta suggests when the backend sends a recommendation (as text, never as markup)', async () => {
      const { item } = await open({ rejectedReason: 'INVALID_FORMAT', recommendation: 'Remove the emoji at the start. <img src=x onerror=alert(1)>' });
      const rec = item.querySelector('[data-recommendation]')!;
      expect(rec.textContent).toContain('[onboarding.approvals.templates.suggests]');
      expect(rec.textContent).toContain('Remove the emoji at the start. <img src=x onerror=alert(1)>');
      expect(rec.querySelector('img')).toBeNull();
      expect(rec.querySelector('[dir="auto"]')).not.toBeNull();
    });

    it('no recommendation, no line; an over-long or control-character recommendation is cleaned', async () => {
      expect((await open({ rejectedReason: 'SCAM' })).item.querySelector('[data-recommendation]')).toBeNull();
      expect(recommendationOf({ recommendation: null })).toBeNull();
      expect(recommendationOf({ recommendation: '   ' })).toBeNull();
      expect(recommendationOf({ recommendation: 'a\u{0}b\n  c' })).toBe('a b c');
      expect(recommendationOf({ recommendation: 'y'.repeat(400) })?.length).toBe(302);
    });

    it('a template rejected AGAIN after a resubmission (revision 2 or more) routes the merchant to Need help instead of resending the same text', async () => {
      const { r, item } = await open({ rejectedReason: 'INVALID_FORMAT', revision: 2 });
      expect(item.querySelector('[data-repeated]')?.textContent).toContain('[onboarding.approvals.templates.again]');
      expect(btn(item, '[onboarding.common.tryAgain]')).toBeUndefined();
      const help = item.querySelector<HTMLButtonElement>('[data-act="help"]')!;
      expect(help.textContent).toContain('[onboarding.help.cta]');
      help.click();
      await r.flush();
      expect(TestBed.inject(OnbHelpService).open()).toBe(true);
      expect(TestBed.inject(OnbHelpService).lastError()).toBe('TEMPLATE_REJECTED');
      expect(r.api.templateResubmit).not.toHaveBeenCalled();
    });

    it('revision 1 (or none) is a first rejection; 3 is a repeat too', () => {
      expect([isRepeatedRejection({ revision: 1 }), isRepeatedRejection({}), isRepeatedRejection(null), isRepeatedRejection({ revision: 2 }), isRepeatedRejection({ revision: 3 })]).toEqual([false, false, false, true, true]);
    });
  });

  it('an Arabic variant that is not submitted shows "waiting for review" and is not counted; unusable variants are hidden', async () => {
    const list = [
      ...SEVEN,
      tpl('welcome_optin', 'ar', 'queued', { blockedReason: 'legal' }),
      tpl('comeback', 'ar', 'queued', { blockedReason: 'arabic_not_reviewed' }),
      tpl('points_balance', 'ar', 'queued', { blockedReason: 'invalid' }),
    ];
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: list })) } });
    expect(rowTxt(r, 'templates')).toContain('approved=5,total=7,waiting=2');
    btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.show]')!.click();
    await r.flush();
    const items = qa(r, '.onb-appr-tpl');
    expect(items).toHaveLength(9);
    const blocked = items.slice(7);
    for (const b of blocked) {
      expect(b.textContent).toContain('[onboarding.approvals.templates.arBlocked]');
      expect(b.querySelector('app-approval-badge')).toBeNull();
      expect(b.querySelector('app-lang-pill')).not.toBeNull();
    }
  });

  it('titles follow the UI language and fall back to English, then to the key', async () => {
    const list = [tpl('a_key', 'en', 'APPROVED', { title: { en: 'English only' } }), tpl('b_key', 'ar', 'APPROVED', { title: undefined })];
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: list })) } });
    btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.show]')!.click();
    await r.flush();
    const items = qa(r, '.onb-appr-tpl');
    expect(items[0].textContent).toContain('English only');
    expect(items[1].textContent).toContain('b_key');
    await TestBed.inject(I18nService).use('ar');
    await r.flush();
    expect(qa(r, '.onb-appr-tpl')[0].textContent).toContain('English only');
  });

  it('no templates after Step 3: the "queued" sentence and "submit again", which calls the endpoint and reloads', async () => {
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: [] })) } });
    const el = rowEl(r, 'templates');
    expect(el.textContent).toContain('[onboarding.approvals.templates.queued]');
    btn(el, '[onboarding.approvals.templates.submit]')!.click();
    await r.flush();
    expect(r.api.templatesSubmit).toHaveBeenCalledTimes(1);
    expect(r.api.templates).toHaveBeenCalledTimes(2);
  });

  it('the template limit and other refusals are shown as their copy', async () => {
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: [] })), templatesSubmit: vi.fn(() => httpErr(409, 'TEMPLATE_LIMIT_REACHED')) } });
    btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.submit]')!.click();
    await r.flush();
    expect(rowEl(r, 'templates').querySelector('[role="alert"]')?.textContent).toBe('[onboarding.errors.TEMPLATE_LIMIT_REACHED]');
  });
});

describe('ApprovalsScreen: while you wait, and the next step', () => {
  it('shows the customers and products cards and makes the first pending one the primary button', async () => {
    const r = await mount();
    expect(qa(r, 'section .onb-card')).toHaveLength(2);
    expect(r.el.textContent).toContain('[onboarding.approvals.waitFor]');
    expect(r.el.querySelector('.onb-bar .onb-btn-primary')?.getAttribute('href')).toBe('/setup/customers');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.home.card.customers.cta]');
  });

  it('customers done -> products next; both done (or skipped) -> the first Promotion', async () => {
    const a = await mount({ state: { ...STATE, prompts: { customers: { state: 'done' }, products: { state: 'pending' }, counts: { customers: 12 } } } });
    expect(a.el.querySelector('.onb-bar .onb-btn-primary')?.getAttribute('href')).toBe('/setup/products');
    expect(a.el.textContent).toContain('[onboarding.home.count.customers|n=12]');
    TestBed.resetTestingModule();
    const b = await mount({ state: { ...STATE, prompts: { customers: { state: 'done' }, products: { state: 'skipped' } } } });
    expect(b.el.querySelector('.onb-bar .onb-btn-primary')?.getAttribute('href')).toBe('/setup/promotion');
    expect(txt(b, '.onb-bar .onb-btn-primary')).toBe('[onboarding.step.promotion]');
  });

  it('nothing on the page says the merchant must wait: no row is blocking and the primary button is never disabled', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status: 'needs_you' } }) })) } });
    expect(r.el.querySelector('.onb-bar .onb-btn-primary')?.hasAttribute('disabled')).toBe(false);
  });
});

describe('ApprovalsScreen: checked line, Check now and the 429 countdown', () => {
  it('shows "Checked <time>" from checkedAt in the UI language', async () => {
    const at = new Date(Date.now() - 2 * 60_000).toISOString();
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS(), checkedAt: at })) } });
    expect(r.el.textContent).toContain('[onboarding.approvals.checked|time=2 minutes ago]');
    await r.flush(3 * 60_000);
    expect(r.el.textContent).toContain('[onboarding.approvals.checked|time=5 minutes ago]'); // the line ages by itself
  });

  it('no checkedAt means no "checked" line', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS() })) } });
    expect(r.el.textContent).not.toContain('[onboarding.approvals.checked');
  });

  it('Check now refreshes the connection, re-reads the rows, refreshes the shared state and cannot be double-clicked', async () => {
    const refresh$ = new Subject<unknown>();
    const r = await mount({ api: { connectionRefresh: vi.fn(() => refresh$) } });
    const b = btn(r.el, '[onboarding.approvals.checkNow]')!;
    b.click();
    b.click();
    await r.flush();
    expect(r.api.connectionRefresh).toHaveBeenCalledTimes(1);
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    refresh$.next({});
    refresh$.complete();
    await r.flush();
    expect(r.api.approvals).toHaveBeenCalledTimes(2);
    expect(r.state.refresh).toHaveBeenCalled();
    expect(b.disabled).toBe(false);
  });

  it('429 starts a countdown (the documented 60 s): the button is disabled, the text counts down, then it is enabled again', async () => {
    let limited = true;
    const r = await mount({ api: { connectionRefresh: vi.fn(() => (limited ? httpErr(429, 'RATE_LIMITED') : of({}))) } });
    const b = btn(r.el, '[onboarding.approvals.checkNow]')!;
    b.click();
    await r.flush();
    expect(r.api.approvals).toHaveBeenCalledTimes(1); // no reload on a refused refresh
    expect(APPROVALS_DEFAULT_COOLDOWN_S).toBe(60);
    expect(r.el.textContent).toContain('[onboarding.common.waitSeconds|n=60]');
    expect(b.disabled).toBe(true);
    b.click();
    expect(r.api.connectionRefresh).toHaveBeenCalledTimes(1);
    await r.flush(10_000);
    expect(r.el.textContent).toContain('[onboarding.common.waitSeconds|n=50]');
    await r.flush(49_000);
    expect(r.el.textContent).toContain('[onboarding.common.waitSeconds|n=1]');
    expect(b.disabled).toBe(true);
    await r.flush(1000);
    expect(r.el.textContent).not.toContain('waitSeconds');
    expect(b.disabled).toBe(false);
    limited = false;
    b.click();
    await r.flush();
    expect(r.api.connectionRefresh).toHaveBeenCalledTimes(2);
  });

  it('the countdown is NOT a live region (no role="status", aria-live="off"); its start and its end are announced once each (R6-10)', async () => {
    const r = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(429, 'RATE_LIMITED')) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    const count = q(r, '[data-countdown]')!;
    expect(count.getAttribute('role')).toBeNull();
    expect(count.getAttribute('aria-live')).toBe('off');
    expect(count.closest('[role="status"], [aria-live="polite"], [aria-live="assertive"]')).toBeNull();
    const said = TestBed.inject(OnbAnnouncer);
    expect(said.message()).toContain('[onboarding.common.waitSeconds|n=60]'); // the start
    const start = said.message();
    await r.flush(10_000);
    expect(said.message()).toBe(start); // nothing is said while the number goes down
    await r.flush(49_000);
    expect(said.message()).toBe(start);
    expect(count.textContent).toContain('n=1');
    await r.flush(1000);
    expect(said.message()).toContain('[onboarding.common.waitOver]'); // the end
    expect(q(r, '[data-countdown]')).toBeNull();
  });

  it('Submit with a blocked answer (no usable connection) says why', async () => {
    const r = await mount({ api: { templates: vi.fn(() => of({ templates: [] })), templatesSubmit: vi.fn(() => of({ templates: [], blocked: { code: 'WHATSAPP_RECONNECT_REQUIRED', nextStep: 'connect' } })) } });
    btn(rowEl(r, 'templates'), '[onboarding.approvals.templates.submit]')!.click();
    await r.flush();
    expect(rowEl(r, 'templates').querySelector('[role="alert"]')?.textContent).toBe('[onboarding.errors.WHATSAPP_RECONNECT_REQUIRED]');
  });

  it('META_RATE_LIMITED (Meta asked us to slow down, 429 with Retry-After) is a countdown too, not an error block', async () => {
    const r = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(429, 'META_RATE_LIMITED', new HttpHeaders({ 'Retry-After': '60' }))) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    expect(r.el.textContent).toContain('[onboarding.common.waitSeconds|n=60]');
    expect(r.el.querySelector('.onb-appr-checked ~ .onb-alert-error')).toBeNull();
  });

  it('a Retry-After header shortens or lengthens the countdown (capped at 5 minutes)', async () => {
    const r = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(429, undefined, new HttpHeaders({ 'Retry-After': '20' }))) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    expect(r.el.textContent).toContain('[onboarding.common.waitSeconds|n=20]');
    TestBed.resetTestingModule();
    const big = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(429, undefined, new HttpHeaders({ 'Retry-After': '99999' }))) } });
    btn(big.el, '[onboarding.approvals.checkNow]')!.click();
    await big.flush();
    expect(big.el.textContent).toContain('[onboarding.common.waitSeconds|n=300]');
  });

  it('any other failure of Check now is shown as its copy; the page keeps its rows', async () => {
    const r = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(503, 'META_UNREACHABLE')) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    expect(txt(r, '.onb-alert-error')).toContain('[onboarding.errors.META_UNREACHABLE]');
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
    expect(r.el.textContent).not.toContain('waitSeconds');
  });
});

describe('ApprovalsScreen: polling', () => {
  it('re-reads every 30 s while the tab is visible and something is waiting', async () => {
    const r = await mount();
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
    await r.flush(APPROVALS_POLL_MS - 1);
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
    await r.flush(1);
    expect(r.api.approvals).toHaveBeenCalledTimes(2);
    await r.flush(APPROVALS_POLL_MS);
    expect(r.api.approvals).toHaveBeenCalledTimes(3);
    expect(r.api.templates).toHaveBeenCalledTimes(3);
  });

  it('does not poll while the tab is hidden, and catches up when it becomes visible again', async () => {
    const r = await mount();
    setVisibility('hidden');
    await r.flush(APPROVALS_POLL_MS * 4);
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await r.flush();
    expect(r.api.approvals).toHaveBeenCalledTimes(2);
  });

  it('becoming visible right after a read does not read again', async () => {
    const r = await mount();
    await r.flush(5000);
    document.dispatchEvent(new Event('visibilitychange'));
    await r.flush();
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
  });

  it('a hidden event does not read', async () => {
    const r = await mount();
    await r.flush(APPROVALS_POLL_MS + 1000);
    const calls = r.api.approvals.mock.calls.length;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await r.flush();
    expect(r.api.approvals.mock.calls.length).toBe(calls);
  });

  it('stops polling when nothing is waiting any more (everything done)', async () => {
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ALL_DONE() })) } });
    await r.flush(APPROVALS_POLL_MS * 5);
    expect(r.api.approvals).toHaveBeenCalledTimes(1);
  });

  it('a row that needs the merchant but is not waiting does not poll; an unknown row does', async () => {
    const needs = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS({ verification: { status: 'needs_you' }, displayName: { status: 'done' }, messagingLimit: { status: 'done' }, templates: { status: 'done' } }) })) } });
    await needs.flush(APPROVALS_POLL_MS * 2);
    expect(needs.api.approvals).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    const unknown = await mount({ api: { approvals: vi.fn(() => of({ rows: ALL_DONE().map((x) => (x.key === 'payment' ? { ...x, status: 'strange' } : x)) })) } });
    await unknown.flush(APPROVALS_POLL_MS);
    expect(unknown.api.approvals).toHaveBeenCalledTimes(2);
  });

  it('a failed poll keeps the last good answer on screen and shows no error', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => (++n === 1 ? of({ rows: ROWS() }) : httpErr(0))) } });
    await r.flush(APPROVALS_POLL_MS);
    expect(r.api.approvals).toHaveBeenCalledTimes(2);
    expect(qa(r, 'li.onb-appr-row')).toHaveLength(5);
    expect(q(r, '[role="alert"]')).toBeNull();
  });

  it('a late answer of an older read never overwrites a newer one', async () => {
    const first = new Subject<OnbApprovalsResponse>();
    const second = new Subject<OnbApprovalsResponse>();
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => (++n === 1 ? first : second)) } });
    await r.flush(APPROVALS_POLL_MS);
    second.next({ rows: ROWS({ verification: { status: 'done' } }) });
    await r.flush();
    first.next({ rows: ROWS({ verification: { status: 'needs_you' } }) });
    await r.flush();
    expect(rowEl(r, 'verification').getAttribute('data-state')).toBe('done');
  });
});

describe('ApprovalsScreen: live region', () => {
  it('announces the row that changed, with its title and its new status', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS(++n === 1 ? {} : { verification: { status: 'done' } }) })) } });
    expect(TestBed.inject(OnbAnnouncer).message()).toBe('');
    await r.flush(APPROVALS_POLL_MS);
    const said = TestBed.inject(OnbAnnouncer).message();
    expect(said).toContain('[onboarding.approvals.live|');
    expect(said).toContain('row=[onboarding.approvals.row.verification]');
    expect(said).toContain('status=[onboarding.stepstatus.done]');
  });

  it('a poll without a change announces NOTHING (a screen reader must not hear "Checked now" every 30 seconds)', async () => {
    const r = await mount();
    for (let i = 0; i < 4; i++) await r.flush(APPROVALS_POLL_MS);
    expect(r.api.approvals).toHaveBeenCalledTimes(5);
    expect(TestBed.inject(OnbAnnouncer).message()).toBe('');
  });

  it('a poll that finds a REAL change announces it, and only that', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS(++n >= 3 ? { verification: { status: 'done' } } : {}) })) } });
    await r.flush(APPROVALS_POLL_MS); // second read: nothing changed
    expect(TestBed.inject(OnbAnnouncer).message()).toBe('');
    await r.flush(APPROVALS_POLL_MS); // third read: verification is done
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('row=[onboarding.approvals.row.verification]');
    const said = TestBed.inject(OnbAnnouncer);
    said.clear();
    await r.flush(APPROVALS_POLL_MS); // fourth read: the same as the third
    expect(said.message()).toBe('');
  });

  it('Check now WITHOUT a change still says "checked just now" (the merchant pressed a button and expects an answer)', async () => {
    const r = await mount();
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.approvals.checked|');
  });

  it('becoming visible again does not announce "checked" either', async () => {
    const r = await mount();
    setVisibility('hidden');
    await r.flush(APPROVALS_POLL_MS * 2);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await r.flush();
    expect(r.api.approvals).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(OnbAnnouncer).message()).toBe('');
  });

  it('the first load announces nothing', async () => {
    const r = await mount();
    expect(TestBed.inject(OnbAnnouncer).message()).toBe('');
    void r;
  });

  it('Check now announces what changed', async () => {
    let n = 0;
    const r = await mount({ api: { approvals: vi.fn(() => of({ rows: ROWS(++n === 1 ? {} : { displayName: { status: 'needs_you', value: { value: 'X', rejectionKey: 'UNKNOWN' } } }) })) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    const said = TestBed.inject(OnbAnnouncer).message();
    expect(said).toContain('row=[onboarding.approvals.row.displayName]');
    expect(said).toContain('status=[onboarding.stepstatus.needsYou]');
  });
});

describe('ApprovalsScreen: clean-up and privacy', () => {
  it('on destroy the poll timer, the countdown and the visibility listener are gone', async () => {
    const r = await mount({ api: { connectionRefresh: vi.fn(() => httpErr(429, 'RATE_LIMITED')) } });
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush();
    const remove = vi.spyOn(document, 'removeEventListener');
    r.fixture.destroy();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const calls = r.api.approvals.mock.calls.length;
    await vi.advanceTimersByTimeAsync(APPROVALS_POLL_MS * 4);
    expect(r.api.approvals.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs nothing and sends no phone number, token or free text anywhere', async () => {
    const r = await mount();
    btn(r.el, '[onboarding.approvals.checkNow]')!.click();
    await r.flush(APPROVALS_POLL_MS);
    expect(consoleSpies.flatMap((s) => s.mock.calls)).toEqual([]);
    expect(JSON.stringify(r.api.event.mock.calls)).not.toMatch(/\+?\d{8,}/);
    expect(JSON.stringify({ ...localStorage })).not.toContain('Cafe');
  });

  it('step_enter is reported for the approvals step', async () => {
    const r = await mount();
    expect(r.api.event.mock.calls.map((c) => c[0] as unknown)).toContainEqual({ type: 'step_enter', step: 'approvals' });
  });

  it('the router is only used for links (no navigation by the page itself)', async () => {
    const r = await mount();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl');
    await r.flush(APPROVALS_POLL_MS * 3);
    expect(nav).not.toHaveBeenCalled();
  });
});

describe('pure helpers', () => {
  it('rowState maps the three server values and anything else to unknown', () => {
    expect(rowState('done')).toBe('done');
    expect(rowState('waiting')).toBe('waiting');
    expect(rowState('needs_you')).toBe('needs');
    for (const v of ['DONE', 'pending', '', null, undefined, 5, {}]) expect(rowState(v)).toBe('unknown');
  });

  it('relativeTime: now, minutes, hours, days; English and Arabic with Western digits only', () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    expect(relativeTime(now, now, 'en-GB')).toBe('now');
    expect(relativeTime(now - 44_000, now, 'en-GB')).toBe('now');
    expect(relativeTime(now - 60_000, now, 'en-GB')).toBe('1 minute ago');
    expect(relativeTime(now - 120_000, now, 'en-GB')).toBe('2 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now, 'en-GB')).toBe('3 hours ago');
    expect(relativeTime(now - 2 * 86_400_000, now, 'en-GB')).toBe('2 days ago');
    expect(relativeTime(now + 5000, now, 'en-GB')).toBe('now'); // a clock a little ahead is not "in the future"
    const ar = relativeTime(now - 5 * 60_000, now, 'ar-SA-u-nu-latn-ca-gregory');
    expect(ar).toMatch(/5/);
    expect(ar).not.toMatch(/[\u{660}-\u{669}]/u);
    expect(relativeTime(now - 60_000, now, 'not a locale!!')).toBe('1 minute ago'); // falls back, never throws
  });

  it('displayNameView reads the object, a bare string, and survives junk', () => {
    expect(displayNameView(row('displayName', 'x', { value: { value: ' Cafe ', canEdit: false, editsRemaining: 3, rejectionKey: 'NAME_NOT_CONSISTENT' } }))).toEqual({
      value: 'Cafe', canEdit: false, editsRemaining: 3, rejectionKey: 'NAME_NOT_CONSISTENT',
    });
    expect(displayNameView(row('displayName', 'x', { value: 'Plain' })).value).toBe('Plain');
    expect(displayNameView(undefined)).toEqual({ value: null, canEdit: null, editsRemaining: null, rejectionKey: null });
    const junk = displayNameView(row('displayName', 'x', { value: { value: 5, canEdit: 'yes', editsRemaining: -1, rejectionKey: 'bad key!' } }));
    expect(junk).toEqual({ value: null, canEdit: null, editsRemaining: null, rejectionKey: null });
    expect(displayNameView(row('displayName', 'x', { value: { editsRemaining: 2.9 } })).editsRemaining).toBe(2);
  });

  it('the REAL backend shape: name as the value string, canEdit / editsRemaining / rejectionKey and tierNumber as sibling row fields', () => {
    expect(displayNameView(row('displayName', 'needs_you', { value: 'Sara Cafe', canEdit: false, editsRemaining: 0, rejectionKey: 'NAME_NOT_CONSISTENT' }))).toEqual({
      value: 'Sara Cafe', canEdit: false, editsRemaining: 0, rejectionKey: 'NAME_NOT_CONSISTENT',
    });
    expect(displayNameView(row('displayName', 'waiting', { value: null, canEdit: true, editsRemaining: 7, rejectionKey: null }))).toEqual({
      value: null, canEdit: true, editsRemaining: 7, rejectionKey: null,
    });
    expect(messagingTier(row('messagingLimit', 'done', { value: 1000, tierNumber: 1000, raw: 'TIER_1K' }))).toBe(1000);
    expect(messagingTier(row('messagingLimit', 'done', { value: 'TIER_UNLIMITED_X', tierNumber: null, raw: 'TIER_UNLIMITED_X' }))).toBeNull();
    expect(messagingTier(row('messagingLimit', 'done', { value: 250 }))).toBe(250);
  });

  it('messagingTier needs a positive number', () => {
    expect(messagingTier(row('messagingLimit', 'x', { value: { tierNumber: 1000 } }))).toBe(1000);
    for (const v of [{ tierNumber: 0 }, { tierNumber: '250' }, { tierNumber: null }, null, 'TIER_250', undefined]) {
      expect(messagingTier(row('messagingLimit', 'x', { value: v }))).toBeNull();
    }
    expect(messagingTier(undefined)).toBeNull();
  });

  it('safeHttps accepts https only', () => {
    expect(safeHttps('https://business.facebook.com/x')).toBe('https://business.facebook.com/x');
    for (const bad of ['http://a.test', 'javascript:alert(1)', 'data:text/html,x', '//a.test', 'a.test', '', null, undefined, 5, 'https://' + 'a'.repeat(700)]) {
      expect(safeHttps(bad), String(bad)).toBeNull();
    }
  });

  it('metaStatusOf maps Meta statuses, queue words and unknowns', () => {
    expect(metaStatusOf('APPROVED')).toBe('APPROVED');
    expect(metaStatusOf('approved')).toBe('APPROVED');
    expect(metaStatusOf('in appeal')).toBe('IN_APPEAL');
    expect(metaStatusOf('queued')).toBe('PENDING');
    expect(metaStatusOf('SUBMITTING')).toBe('PENDING');
    expect(metaStatusOf('whatever')).toBe('NOT_CREATED');
    expect(metaStatusOf(null)).toBe('NOT_CREATED');
  });

  it('templateCounts and visibleTemplates', () => {
    expect(templateCounts(null)).toEqual({ approved: 0, waiting: 0, rejected: 0, total: 0 });
    expect(templateCounts(SEVEN)).toEqual({ approved: 5, waiting: 2, rejected: 0, total: 7 });
    const mixed: TemplateRowView[] = [tpl('a', 'en', 'APPROVED'), tpl('b', 'en', 'REJECTED'), tpl('c', 'ar', 'queued', { blockedReason: 'legal' }), tpl('d', 'ar', 'queued', { blockedReason: 'invalid' })];
    expect(templateCounts(mixed)).toEqual({ approved: 1, waiting: 0, rejected: 1, total: 2 });
    expect(visibleTemplates(mixed).map((t) => t.key)).toEqual(['a', 'b', 'c']);
    expect(visibleTemplates(undefined)).toEqual([]);
  });

  it('Arabic rows blocked for a merchant who never asked for Arabic are hidden; an approved Arabic row stays', () => {
    const list: TemplateRowView[] = [
      tpl('welcome_optin', 'en', 'approved'),
      tpl('welcome_optin', 'ar', 'blocked', { blockedReason: 'arabic_not_reviewed' }),
      tpl('comeback', 'ar', 'approved'),
    ];
    expect(visibleTemplates(list, false).map((t) => `${t.key}:${t.language}`)).toEqual(['welcome_optin:en', 'comeback:ar']);
    expect(visibleTemplates(list, true)).toHaveLength(3);
    expect(visibleTemplates(list, null)).toHaveLength(3);
    expect(visibleTemplates(list)).toHaveLength(3);
    expect(templateCounts(list, false)).toEqual({ approved: 2, waiting: 0, rejected: 0, total: 2 });
  });

  it('the internal test template is neither listed nor counted', () => {
    const list: TemplateRowView[] = [tpl('setup_test', 'en', 'approved'), tpl('setup_test', 'ar', 'approved'), tpl('welcome_optin', 'en', 'approved')];
    expect(visibleTemplates(list).map((t) => t.key)).toEqual(['welcome_optin']);
    expect(templateCounts(list)).toEqual({ approved: 1, waiting: 0, rejected: 0, total: 1 });
  });

  it('the backend status words (queued, pending, approved, rejected, paused, unavailable) land on a badge', () => {
    expect(['queued', 'pending', 'approved', 'rejected', 'paused', 'unavailable', 'blocked'].map((w) => metaStatusOf(w))).toEqual([
      'PENDING', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'NOT_CREATED', 'NOT_CREATED',
    ]);
  });

  it('OnbTemplateRow is satisfied by the rows used here', () => {
    const t: OnbTemplateRow = tpl('x', 'en', 'APPROVED');
    expect(t.key).toBe('x');
  });
});
