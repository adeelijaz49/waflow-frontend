import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { ApiService } from '../../../services/api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocalizationFlagService } from '../../../services/localization-flag.service';
import type { LocalizedTemplate, PlanVariantInfo, PromotionSendPlan } from '../localization.types';
import { LanguagePlanBridge } from './language-plan-bridge';
import { PromotionLanguagePanel } from './promotion-language-panel';
import { TrackedSet } from './tracked-set';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 450;

const variant = (over: Partial<PlanVariantInfo> = {}): PlanVariantInfo => ({
  source: 'promotion', templateId: 't1', templateName: 'Eid sale', language: 'ar', metaStatus: 'PENDING', reviewStatus: 'draft',
  sendable: false, notSendableReason: 'pending', ...over,
});

const plan = (over: Partial<PromotionSendPlan> = {}): PromotionSendPlan => ({
  promotionId: 'p1', promotionName: 'Eid sale', sendFormat: 'separate', selected: 41, eligible: 38,
  skipped: { noConsent: 2, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 0 },
  byLanguage: { ar: 12, en: 26 },
  fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 6 }],
  blocked: [], variant: variant(), warnings: [], canSend: true, needsAcknowledgement: true,
  buckets: { arabic: ['a1', 'a2'], englishFallback: ['f1'], excluded: ['x1'] },
  ...over,
});

const TEMPLATE = {
  id: 't1', variants: [{ language: 'ar', header: '', body: 'مرحباً {name}، عرض العيد', footer: '', buttons: [{ role: 'shop_now', text: 'تسوق الآن' }, { role: 'opt_out', text: 'إلغاء الاشتراك' }] }],
} as unknown as LocalizedTemplate;

// A selection whose plan figures match its ids exactly (see the shortcut tests): a1-a3 get Arabic, f1-f2 get English
// instead of Arabic, e1-e2 get English, n1 has no marketing consent, n2 opted out, x1 is blocked (same phone opted out).
const CONSISTENT_IDS = ['a1', 'a2', 'a3', 'f1', 'f2', 'e1', 'e2', 'n1', 'n2', 'x1'];
const consistentPlan = (over: Partial<PromotionSendPlan> = {}): PromotionSendPlan => plan({
  selected: 10, eligible: 8,
  skipped: { noConsent: 1, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 1 },
  byLanguage: { ar: 3, en: 4 },
  fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 2 }],
  blocked: [{ reason: 'opted_out_same_phone', count: 1 }],
  buckets: { arabic: ['a1', 'a2', 'a3'], englishFallback: ['f1', 'f2'], excluded: ['x1'] },
  ...over,
});
// What GET /api/customers?ids= answers for the consistent selection.
const CONSENT: Record<string, { marketingConsent: boolean; optedOut: boolean }> = {
  e1: { marketingConsent: true, optedOut: false }, e2: { marketingConsent: true, optedOut: false },
  n1: { marketingConsent: false, optedOut: false }, n2: { marketingConsent: true, optedOut: true },
};
const lookup = (params: { ids: string }) => of({
  customers: params.ids.split(',').filter((id) => CONSENT[id]).map((id) => ({ _id: id, ...CONSENT[id] })),
});

interface Opts {
  api?: Record<string, unknown>;
  customersApi?: Record<string, unknown>;
  promo?: Record<string, unknown>;
  ids?: string[];
  testPhone?: string;
  sendResult?: unknown;
  uiLang?: 'en' | 'ar';
}

async function setup(opts: Opts = {}) {
  localStorage.clear();
  const api = {
    getPromotionSendPlan: vi.fn(() => of(plan())),
    getTemplate: vi.fn(() => of(TEMPLATE)),
    testSendPromotionArabic: vi.fn(() => of({ sent: true, dryRun: false })),
    ...opts.api,
  };
  const customersApi = { getCustomers: vi.fn(lookup), ...opts.customersApi };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocalizationApiService, useValue: api },
      { provide: ApiService, useValue: customersApi },
      { provide: LocalizationFlagService, useValue: { arabicEnabled: signal(true), defaultCustomerLanguage: signal('en') } },
    ],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  if (opts.uiLang === 'ar') await i18n.use('ar', false);
  const selection = new TrackedSet<string>(opts.ids ?? ['a1', 'a2', 'f1', 'e1']);
  const fixture = TestBed.createComponent(PromotionLanguagePanel);
  fixture.componentRef.setInput('promotion', opts.promo ?? { _id: 'p1', name: 'Eid sale', entryNodeId: null });
  fixture.componentRef.setInput('selection', selection);
  fixture.componentRef.setInput('testPhone', opts.testPhone ?? '');
  fixture.componentRef.setInput('sendResult', opts.sendResult ?? null);
  fixture.detectChanges();
  const settle = async (wait = 0) => {
    if (wait) await sleep(wait);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await sleep(0);
    }
    fixture.detectChanges();
  };
  await settle();
  return { fixture, api, customersApi, selection, i18n, el: fixture.nativeElement as HTMLElement, settle, bridge: TestBed.inject(LanguagePlanBridge) };
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (el: HTMLElement, re: RegExp) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => re.test(b.textContent ?? ''));
const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('PromotionLanguagePanel', () => {
  describe('plan requests', () => {
    it('sends no request before the debounce and ONE request for several quick selection changes', async () => {
      const { api, selection, fixture, settle } = await setup();
      expect(api.getPromotionSendPlan).not.toHaveBeenCalled();
      selection.add('n1'); fixture.detectChanges();
      selection.delete('n1'); fixture.detectChanges();
      selection.add('n2'); fixture.detectChanges();
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(1);
      expect(api.getPromotionSendPlan).toHaveBeenCalledWith('p1', ['a1', 'a2', 'f1', 'e1', 'n2'], true);
    });

    it('plans an EMPTY selection too: the Arabic version row, preview and test are available, the counts are not', async () => {
      const emptyPlan = plan({
        selected: 0, eligible: 0, skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 },
        byLanguage: { ar: 0, en: 0 }, fallbacks: [], buckets: { arabic: [], englishFallback: [], excluded: [] },
        variant: variant({ metaStatus: 'APPROVED', reviewStatus: 'reviewed', sendable: true, notSendableReason: null }),
      });
      const api = { getPromotionSendPlan: vi.fn(() => of(emptyPlan)) };
      const { api: a, el, bridge, settle } = await setup({ ids: [], api, testPhone: '966500000001' });
      expect(el.textContent).not.toContain('Arabic version for this promotion'); // nothing before the debounce
      await settle(DEBOUNCE);
      expect(a.getPromotionSendPlan).toHaveBeenCalledTimes(1);
      expect(a.getPromotionSendPlan).toHaveBeenCalledWith('p1', [], true);
      const t = text(el);
      expect(t).toContain('Arabic version for this promotion');
      expect(t).toContain('Select customers to see who will receive Arabic.');
      expect(button(el, /Preview in Arabic/)).toBeDefined();
      expect(button(el, /Send a test in Arabic/)!.disabled).toBe(false);
      // no zero counts, no bar, no shortcuts, nothing for the confirmation dialog
      expect(el.querySelector('.lps-bar')).toBeNull();
      expect(t).not.toContain('0 customers selected');
      expect(button(el, /Keep only|Skip the/)).toBeUndefined();
      expect(bridge.confirmNote('p1', 0)).toBe('');
    });

    it('keeps the version row visible when the selection is emptied, but never shows the old counts', async () => {
      const { api, selection, el, fixture, settle } = await setup();
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Arabic 12');
      selection.clear(); fixture.detectChanges();
      expect(text(el)).toContain('Arabic version for this promotion');
      expect(text(el)).not.toContain('Arabic 12');
      expect(text(el)).toContain('Select customers to see who will receive Arabic.');
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenLastCalledWith('p1', [], true);
      expect(text(el)).toContain('Arabic version for this promotion');
      selection.add('a1'); fixture.detectChanges();
      expect(text(el)).not.toContain('Arabic 0'); // no zero summary flashes while the new plan loads
      expect(el.querySelector('.lps-bar')).toBeNull();
    });

    it('goes silent (panel hidden) when the empty-selection plan answers 402', async () => {
      const api = { getPromotionSendPlan: vi.fn(() => throwError(() => ({ status: 402, error: { code: 'ARABIC_NOT_ENABLED' } }))) };
      const { el, settle } = await setup({ ids: [], api });
      await settle(DEBOUNCE);
      expect(text(el)).toBe('');
    });

    it.each([3001, 5001])('does not call the backend for more than 3000 ids (the 100 kb JSON body limit): %i ids show the too-many message', async (length) => {
      const ids = Array.from({ length }, (_, i) => `c${i}`);
      const { api, el, settle } = await setup({ ids });
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).not.toHaveBeenCalled();
      expect(text(el)).toContain('Too many customers selected to preview languages');
    });

    it('still asks the backend for exactly 3000 ids', async () => {
      const ids = Array.from({ length: 3000 }, (_, i) => `c${i}`);
      const { api, el, settle } = await setup({ ids });
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(1);
      expect(text(el)).not.toContain('Too many customers selected');
    });

    it('lets the newest answer win over a slower older one', async () => {
      const slow = new Subject<PromotionSendPlan>();
      const calls: unknown[][] = [];
      const getPromotionSendPlan = vi.fn((...args: unknown[]) => {
        calls.push(args);
        return calls.length === 1 ? slow : of(plan({ byLanguage: { ar: 1, en: 1 }, fallbacks: [], skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 } }));
      });
      const { fixture, selection, el, settle } = await setup({ api: { getPromotionSendPlan } });
      await settle(DEBOUNCE); // first request in flight (never answered yet)
      selection.add('n9'); fixture.detectChanges();
      await settle(DEBOUNCE);
      slow.next(plan({ byLanguage: { ar: 99, en: 99 } })); // the older answer arrives late
      await settle();
      expect(getPromotionSendPlan).toHaveBeenCalledTimes(2);
      expect(text(el)).not.toContain('99');
      expect(text(el)).toContain('Arabic 1');
    });

    it('publishes the plan to the confirmation bridge and clears it as soon as the selection changes', async () => {
      const { bridge, selection, fixture, settle } = await setup();
      await settle(DEBOUNCE);
      expect(bridge.confirmNote('p1', 4)).toContain('Language: 12 Arabic, 26 English.');
      selection.add('n1'); fixture.detectChanges();
      expect(bridge.confirmNote('p1', 5)).toBe('');
      expect(bridge.confirmNote('p1', 4)).toBe('');
    });
  });

  describe('counts and explanations', () => {
    it('shows the four counts (Arabic 12, English 20, fallback 6, not messaged 3) and hides zero rows', async () => {
      const { el, settle } = await setup();
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('Arabic 12');
      expect(t).toContain('English 20');
      expect(t).toContain('English instead of Arabic 6');
      expect(t).toContain('Not messaged 3');
      expect(el.querySelectorAll('.lps-bar .lps-seg').length).toBe(4);
    });

    it('hides rows that are zero', async () => {
      const api = { getPromotionSendPlan: vi.fn(() => of(plan({ fallbacks: [], byLanguage: { ar: 5, en: 0 }, skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 } }))) };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('Arabic 5');
      const counts = text(el.querySelector('.lps-counts') as HTMLElement);
      expect(counts).not.toContain('English instead of Arabic');
      expect(counts).not.toContain('Not messaged');
      expect(el.querySelectorAll('.lps-bar .lps-seg').length).toBe(1);
    });

    it('never shows a negative English count when byLanguage.en is smaller than the fallbacks', async () => {
      const api = { getPromotionSendPlan: vi.fn(() => of(plan({ byLanguage: { ar: 3, en: 2 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 6 }] }))) };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      expect(text(el)).not.toContain('English -');
    });

    it('explains each fallback reason in a sentence', async () => {
      const reasons = [
        ['no_arabic_version', 'there is no Arabic version of this message yet'],
        ['not_submitted', 'has not been submitted to WhatsApp yet'],
        ['pending', 'waiting for WhatsApp approval'],
        ['rejected', 'WhatsApp rejected the Arabic version'],
        ['paused', 'WhatsApp paused the Arabic version'],
        ['disabled', 'WhatsApp disabled the Arabic version'],
        ['flagged', 'flagged the Arabic version as at risk'],
        ['not_approved', 'is not approved by WhatsApp'],
        ['not_reviewed', 'has not been reviewed by a native Arabic speaker'],
        ['no_opt_out_button', 'has no opt-out button'],
        ['buttons_mismatch', 'buttons do not match'],
        ['template_unusable', 'stopped accepting the Arabic version'],
        ['opted_out_same_phone', 'same phone number has opted out'],
      ] as const;
      const api = { getPromotionSendPlan: vi.fn(() => of(plan({ fallbacks: reasons.map(([r]) => ({ from: 'ar' as const, to: 'en' as const, reason: r, count: 2 })) }))) };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      const t = text(el);
      for (const [, phrase] of reasons) expect(t).toContain(phrase);
      expect(t).toContain('2 Arabic-speaking customers will get English because');
      expect(t).not.toMatch(/promolang\./);
    });

    it('uses the singular for one customer, fills {field} and falls back to a generic line for an unknown reason', async () => {
      const api = {
        getPromotionSendPlan: vi.fn(() => of(plan({
          fallbacks: [
            { from: 'ar', to: 'en', reason: 'field_values_missing:date', count: 1 },
            { from: 'ar', to: 'en', reason: 'something_new', count: 3 },
          ],
        }))),
      };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('1 Arabic-speaking customer will get English because a value for date is missing');
      expect(t).toContain('3 Arabic-speaking customers will get English because the Arabic version is not ready');
    });

    it('lists what is not messaged at all, and the plan warnings (unknown codes ignored)', async () => {
      const api = {
        getPromotionSendPlan: vi.fn(() => of(plan({
          skipped: { noConsent: 2, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 0 },
          blocked: [{ reason: 'opted_out_same_phone', count: 4 }],
          warnings: [{ code: 'carousel_english_only' }, { code: 'large_audience', detail: { count: 300 } }, { code: 'mystery' }],
        }))),
      };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('Not messaged: 2 without marketing consent, 1 opted out, 4 opted out on another record of the same number.');
      expect(t).toContain('Carousel promotions are always sent in English.');
      expect(t).toContain('Large send: 300 customers.');
      expect(t).not.toContain('mystery');
    });
  });

  describe('message versions and links', () => {
    it('shows "Standard message" and no English badge when there is no custom entry message', async () => {
      const { el, settle } = await setup({ api: { getPromotionSendPlan: vi.fn(() => of(plan({ variant: variant({ source: 'none', templateId: null, metaStatus: null, reviewStatus: null }) }))) } });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Standard message');
      expect(text(el)).toContain('No Arabic version yet');
      expect(el.querySelectorAll('app-approval-badge').length).toBe(0);
    });

    it('maps the English custom message status to a badge', async () => {
      const { el, settle } = await setup({ promo: { _id: 'p1', name: 'Eid', entryNodeId: { _id: 'n1', templateStatus: 'approved' } } });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Your custom message');
      expect(el.querySelector('.plp-ver app-approval-badge')?.textContent).toContain('Approved');
    });

    it.each([
      [variant({ metaStatus: 'PENDING', reviewStatus: 'draft' }), ['Pending', 'Draft']],
      [variant({ metaStatus: 'APPROVED', reviewStatus: 'draft' }), ['Approved', 'Draft']],
      [variant({ metaStatus: 'APPROVED', reviewStatus: 'reviewed', sendable: true, notSendableReason: null }), ['Approved', 'Reviewed']],
      [variant({ metaStatus: 'REJECTED', reviewStatus: 'draft' }), ['Rejected', 'Draft']],
    ])('shows the Arabic badges for %#', async (v, words) => {
      const { el, settle } = await setup({ api: { getPromotionSendPlan: vi.fn(() => of(plan({ variant: v }))) } });
      await settle(DEBOUNCE);
      const badges = Array.from(el.querySelectorAll('.plp-ver'))[1].textContent ?? '';
      for (const w of words) expect(badges).toContain(w);
      expect(badges).toContain('Arabic version for this promotion');
    });

    it('links to the template editor, the flows tab (custom entry node) or a new promotion template', async () => {
      let r = await setup();
      await r.settle(DEBOUNCE);
      expect(hrefs(r.el)).toContain('/arabic/templates/t1');
      TestBed.resetTestingModule();

      r = await setup({
        promo: { _id: 'p1', name: 'Eid', entryNodeId: { _id: 'node1', templateStatus: 'approved' } },
        api: { getPromotionSendPlan: vi.fn(() => of(plan({ variant: variant({ source: 'none', templateId: null }) }))) },
      });
      await r.settle(DEBOUNCE);
      expect(hrefs(r.el)).toContain('/arabic/flows?node=node1');
      TestBed.resetTestingModule();

      r = await setup({
        promo: { _id: 'p1', name: 'Eid & sale', entryNodeId: null },
        api: { getPromotionSendPlan: vi.fn(() => of(plan({ variant: variant({ source: 'none', templateId: null }) }))) },
      });
      await r.settle(DEBOUNCE);
      expect(hrefs(r.el)).toContain('/arabic/templates?forPromotion=p1&name=Eid%20%26%20sale');
    });

    it('always offers the Arabic campaign builder for the other language modes', async () => {
      const { el } = await setup();
      expect(text(el)).toContain('Each customer gets their own language');
      expect(text(el)).toContain('Customers with no language set get English (your default).');
      expect(hrefs(el)).toContain('/arabic/campaigns/new');
    });

    it('survives a Latin, emoji and very long promotion name', async () => {
      const name = `Sale \u{1F389} ${'x'.repeat(300)}`;
      const { el, settle } = await setup({
        promo: { _id: 'p1', name, entryNodeId: null },
        api: { getPromotionSendPlan: vi.fn(() => of(plan({ variant: variant({ source: 'none', templateId: null }) }))) },
      });
      await settle(DEBOUNCE);
      const link = hrefs(el).find((h) => h?.startsWith('/arabic/templates?forPromotion=')) ?? '';
      expect(new URL(link, 'http://x').searchParams.get('name')).toBe(name);
    });
  });

  describe('selection shortcuts', () => {
    // Every label count must be EXACTLY the number of customers its button leaves selected, and agree with the plan
    // bar (Arabic = "Arabic"; English = "English" + "English instead of Arabic"; skip = the fallback customers).
    const withConsistentPlan = (over: Partial<PromotionSendPlan> = {}, customersApi?: Record<string, unknown>) =>
      setup({ ids: CONSISTENT_IDS, api: { getPromotionSendPlan: vi.fn(() => of(consistentPlan(over))) }, customersApi });

    it('labels match the plan bar: Arabic 3, English 2 + English instead of Arabic 2, so Keep only English is 4', async () => {
      const { el, settle } = await withConsistentPlan();
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('Arabic 3');
      expect(t).toContain('English 2');
      expect(t).toContain('English instead of Arabic 2');
      expect(t).toContain('Not messaged 3'); // no consent 1 + opted out 1 + blocked 1 (the backend reports it twice)
      expect(t.split('opted out on another record of the same number').length - 1).toBe(1);
      expect(t).toContain('Keep only Arabic (3)');
      expect(t).toContain('Keep only English (4)');
      expect(t).toContain('Skip the 2 getting English instead of Arabic');
    });

    it('Keep only English leaves exactly the 4 customers who will get English (not the 3 who are not messaged)', async () => {
      const { selection, el, settle, customersApi, api } = await withConsistentPlan();
      await settle(DEBOUNCE);
      button(el, /Keep only English \(4\)/)!.click();
      await settle();
      expect([...selection].sort()).toEqual(['e1', 'e2', 'f1', 'f2']);
      expect(selection.size).toBe(4); // = the number on the button
      // only the customers in no bucket were looked up (the blocked x1 and the bucketed ones were not)
      const asked = (customersApi.getCustomers as any).mock.calls.flatMap((c: any[]) => String(c[0].ids).split(',')).sort();
      expect(asked).toEqual(['e1', 'e2', 'n1', 'n2']);
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(2); // one refresh for the new selection
    });

    it('Keep only Arabic leaves exactly the 3 Arabic recipients and Skip the fallbacks removes exactly the 2', async () => {
      const { selection, el, settle, customersApi } = await withConsistentPlan();
      await settle(DEBOUNCE);
      button(el, /Skip the 2/)!.click();
      await settle();
      expect(selection.size).toBe(8);
      expect([...selection].sort()).toEqual(['a1', 'a2', 'a3', 'e1', 'e2', 'n1', 'n2', 'x1']);
      await settle(DEBOUNCE);
      button(el, /Keep only Arabic \(3\)/)!.click();
      await settle();
      expect([...selection].sort()).toEqual(['a1', 'a2', 'a3']);
      expect(customersApi.getCustomers).not.toHaveBeenCalled(); // these two never need a lookup
    });

    it('Keep only English needs no lookup when every selected customer will be messaged', async () => {
      const noSkips = { skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 }, byLanguage: { ar: 3, en: 4 }, blocked: [], buckets: { arabic: ['a1', 'a2', 'a3'], englishFallback: ['f1', 'f2'], excluded: [] } };
      const { selection, el, settle, customersApi } = await setup({
        ids: ['a1', 'a2', 'a3', 'f1', 'f2', 'e1', 'e2'], api: { getPromotionSendPlan: vi.fn(() => of(consistentPlan(noSkips))) },
      });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Keep only English (4)');
      button(el, /Keep only English/)!.click();
      await settle();
      expect([...selection].sort()).toEqual(['e1', 'e2', 'f1', 'f2']);
      expect(customersApi.getCustomers).not.toHaveBeenCalled();
    });

    it('looks the customers up in chunks of 50', async () => {
      const rest = Array.from({ length: 120 }, (_, i) => `r${i}`);
      const ids = ['a1', 'f1', ...rest];
      const customersApi = { getCustomers: vi.fn((p: { ids: string }) => of({ customers: p.ids.split(',').map((id) => ({ _id: id, marketingConsent: true, optedOut: false })) })) };
      const { selection, el, settle } = await setup({
        ids, customersApi,
        api: { getPromotionSendPlan: vi.fn(() => of(consistentPlan({
          skipped: { noConsent: 1, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 }, byLanguage: { ar: 1, en: 121 },
          fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 1 }], blocked: [], buckets: { arabic: ['a1'], englishFallback: ['f1'], excluded: [] },
        }))) },
      });
      await settle(DEBOUNCE);
      button(el, /Keep only English \(121\)/)!.click();
      await settle();
      const sizes = (customersApi.getCustomers as any).mock.calls.map((c: any[]) => String(c[0].ids).split(',').length).sort((a: number, b: number) => a - b);
      expect(sizes).toEqual([20, 50, 50]);
      expect(selection.size).toBe(121);
    });

    it('leaves the selection alone and says so when the customer lookup fails', async () => {
      const customersApi = { getCustomers: vi.fn(() => throwError(() => ({ status: 500 }))) };
      const { selection, el, settle } = await withConsistentPlan({}, customersApi);
      await settle(DEBOUNCE);
      button(el, /Keep only English/)!.click();
      await settle();
      expect(selection.size).toBe(10);
      expect(text(el)).toContain('Could not narrow the selection. Please try again.');
      expect(button(el, /Keep only English/)!.disabled).toBe(false); // can be tried again
    });

    it('does not overwrite a selection the merchant changed while the lookup was running', async () => {
      const pending = new Subject<unknown>();
      const customersApi = { getCustomers: vi.fn(() => pending) };
      const { selection, el, fixture, settle } = await withConsistentPlan({}, customersApi);
      await settle(DEBOUNCE);
      button(el, /Keep only English/)!.click();
      await settle();
      expect(button(el, /Keep only Arabic/)!.disabled).toBe(true); // the shortcuts wait for the lookup
      selection.add('z9'); fixture.detectChanges();
      pending.next({ customers: [{ _id: 'e1', marketingConsent: true, optedOut: false }] });
      pending.complete();
      await settle();
      expect(selection.has('z9')).toBe(true);
      expect(selection.size).toBe(11);
    });

    it('disables the shortcuts while a new plan is loading (their counts would be stale)', async () => {
      const slow = new Subject<PromotionSendPlan>();
      let calls = 0;
      const api = { getPromotionSendPlan: vi.fn(() => (++calls === 1 ? of(consistentPlan()) : slow)) };
      const { selection, el, fixture, settle } = await setup({ ids: CONSISTENT_IDS, api });
      await settle(DEBOUNCE);
      expect(button(el, /Keep only Arabic/)!.disabled).toBe(false);
      selection.add('z9'); fixture.detectChanges();
      expect(button(el, /Keep only Arabic/)!.disabled).toBe(true);
    });

    it('a carousel plan (English only, no Arabic bucket) still counts exactly the messaged customers', async () => {
      const { selection, el, settle } = await setup({
        ids: ['e1', 'e2', 'n1', 'n2'],
        api: { getPromotionSendPlan: vi.fn(() => of(consistentPlan({
          selected: 4, eligible: 2, skipped: { noConsent: 1, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 0 }, byLanguage: { ar: 0, en: 2 },
          fallbacks: [], blocked: [], buckets: { arabic: [], englishFallback: [], excluded: [] }, warnings: [{ code: 'carousel_english_only' }], variant: null,
        }))) },
      });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Keep only English (2)');
      button(el, /Keep only English/)!.click();
      await settle();
      expect([...selection].sort()).toEqual(['e1', 'e2']);
    });

    it('hides a shortcut whose count is zero or that would change nothing', async () => {
      const api = { getPromotionSendPlan: vi.fn(() => of(plan({ fallbacks: [], byLanguage: { ar: 4, en: 0 }, buckets: { arabic: ['a1', 'a2', 'f1', 'e1'], englishFallback: [], excluded: [] } }))) };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      expect(button(el, /Keep only/)).toBeUndefined();
      expect(button(el, /Skip the/)).toBeUndefined();
    });

    it('shows no shortcuts when the backend returned no bucket ids', async () => {
      const api = { getPromotionSendPlan: vi.fn(() => of(plan({ buckets: undefined }))) };
      const { el, settle } = await setup({ api });
      await settle(DEBOUNCE);
      expect(button(el, /Keep only|Skip the/)).toBeUndefined();
    });
  });

  describe('failures degrade quietly', () => {
    it('shows an inline note and a working Retry on a 500', async () => {
      const getPromotionSendPlan = vi.fn()
        .mockReturnValueOnce(throwError(() => ({ status: 500 })))
        .mockReturnValue(of(plan()));
      const { el, fixture, settle } = await setup({ api: { getPromotionSendPlan } });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Could not check the languages for this selection. Sending is not affected.');
      button(el, /Retry/)!.click();
      fixture.detectChanges();
      await settle(DEBOUNCE);
      expect(getPromotionSendPlan).toHaveBeenCalledTimes(2);
      expect(text(el)).toContain('Arabic 12');
    });

    it.each([[402], [404]])('renders nothing at all on %s (the old controls are all the merchant sees)', async (status) => {
      const { el, api, selection, fixture, settle } = await setup({ api: { getPromotionSendPlan: vi.fn(() => throwError(() => ({ status }))) } });
      await settle(DEBOUNCE);
      expect(el.querySelector('section')).toBeNull();
      selection.add('zzz'); fixture.detectChanges();
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(1); // no hammering an unavailable endpoint
    });
  });

  describe('Arabic preview', () => {
    it('is collapsed, loads the template once when first opened and renders RTL Arabic text', async () => {
      const { el, api, fixture, settle } = await setup();
      await settle(DEBOUNCE);
      expect(api.getTemplate).not.toHaveBeenCalled();
      expect(el.querySelector('app-wa-preview')).toBeNull();
      button(el, /Preview in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(api.getTemplate).toHaveBeenCalledWith('t1');
      const frame = el.querySelector('app-wa-preview .wap-frame');
      expect(frame?.getAttribute('lang')).toBe('ar');
      expect(frame?.getAttribute('dir')).toBe('rtl');
      expect(text(el)).toContain('مرحباً {name}، عرض العيد');
      expect(text(el)).toContain('تسوق الآن');
      expect(text(el)).toContain('Merge fields such as the customer');
      button(el, /Preview in Arabic/)!.click();
      button(el, /Preview in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(api.getTemplate).toHaveBeenCalledTimes(1);
    });

    it('shows a note when the template cannot be loaded', async () => {
      const { el, fixture, settle } = await setup({ api: { getTemplate: vi.fn(() => throwError(() => ({ status: 500 }))) } });
      await settle(DEBOUNCE);
      button(el, /Preview in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(text(el)).toContain('Could not load the Arabic version.');
    });
  });

  describe('Arabic test message', () => {
    const sendableVariant = variant({ metaStatus: 'APPROVED', reviewStatus: 'reviewed', sendable: true, notSendableReason: null });
    const sendablePlan = () => of(plan({ variant: sendableVariant }));

    it('is disabled while the Arabic version cannot be sent', async () => {
      const { el, settle } = await setup({ testPhone: '966500000001' });
      await settle(DEBOUNCE);
      expect(button(el, /Send a test in Arabic/)!.disabled).toBe(true);
      expect(text(el)).toContain('The Arabic version cannot be sent yet.');
    });

    it('prefills the phone from the existing test field and sends the test', async () => {
      const { el, api, fixture, settle } = await setup({ testPhone: '966500000001', api: { getPromotionSendPlan: vi.fn(sendablePlan) } });
      await settle(DEBOUNCE);
      const input = el.querySelector<HTMLInputElement>('.plp-input')!;
      expect(input.value).toBe('966500000001');
      button(el, /Send a test in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(api.testSendPromotionArabic).toHaveBeenCalledWith('p1', '966500000001');
      expect(text(el)).toContain('Arabic test message sent.');
    });

    it('says test mode when nothing left the system', async () => {
      const { el, fixture, settle } = await setup({
        testPhone: '966500000001',
        api: { getPromotionSendPlan: vi.fn(sendablePlan), testSendPromotionArabic: vi.fn(() => of({ sent: false, dryRun: true })) },
      });
      await settle(DEBOUNCE);
      button(el, /Send a test in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(text(el)).toContain('Test mode: nothing left the system.');
    });

    it('explains a 409 NO_ARABIC_VERSION with the reason sentence (never silently English)', async () => {
      const { el, fixture, settle } = await setup({
        testPhone: '966500000001',
        api: {
          getPromotionSendPlan: vi.fn(sendablePlan),
          testSendPromotionArabic: vi.fn(() => throwError(() => ({ status: 409, error: { code: 'NO_ARABIC_VERSION', reason: 'pending' } }))),
        },
      });
      await settle(DEBOUNCE);
      button(el, /Send a test in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(text(el)).toContain('No Arabic test was sent because the Arabic version is waiting for WhatsApp approval.');
    });

    it('shows a generic error for any other failure', async () => {
      const { el, fixture, settle } = await setup({
        testPhone: '966500000001',
        api: { getPromotionSendPlan: vi.fn(sendablePlan), testSendPromotionArabic: vi.fn(() => throwError(() => ({ status: 500 }))) },
      });
      await settle(DEBOUNCE);
      button(el, /Send a test in Arabic/)!.click();
      fixture.detectChanges();
      await settle();
      expect(text(el)).toContain('The Arabic test could not be sent.');
    });
  });

  describe('after a send', () => {
    it('shows the language breakdown and why some customers fell back', async () => {
      const sendResult = {
        sentCount: 38,
        languageCounts: { ar: 12, en: 26 },
        localization: { arabicCustomers: 18, arabicSent: 12, arabicFailed: 0, fallbackToEnglish: [{ reason: 'pending', count: 6 }], excludedOptedOutPhone: 0 },
      };
      const { el, settle } = await setup({ sendResult });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Last send: 12 in Arabic, 26 in English.');
      expect(text(el)).toContain('6 fell back to English because the Arabic version is waiting for WhatsApp approval.');
    });

    it('reports that Arabic sending stopped', async () => {
      const sendResult = { sentCount: 3, languageCounts: { ar: 0, en: 3 }, localization: { arabicCustomers: 5, arabicSent: 0, arabicFailed: 2, fallbackToEnglish: [], excludedOptedOutPhone: 0, stopped: 'template_unusable:132001' } };
      const { el, settle } = await setup({ sendResult });
      await settle(DEBOUNCE);
      expect(text(el)).toContain('Arabic sending stopped: WhatsApp stopped accepting the Arabic template (132001).');
    });

    it('refreshes the plan ONCE after a successful send (never after a failed one)', async () => {
      const { api, fixture, settle } = await setup();
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput('sendResult', { error: true, message: 'boom' });
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput('sendResult', { sentCount: 4 });
      await settle(DEBOUNCE);
      expect(api.getPromotionSendPlan).toHaveBeenCalledTimes(2);
    });

    it('shows nothing when the response has no language keys (English-only send)', async () => {
      const { el, settle } = await setup({ sendResult: { sentCount: 5 } });
      await settle(DEBOUNCE);
      expect(text(el)).not.toContain('Last send');
    });
  });

  describe('English forced on an English screen', () => {
    it('keeps every label English, left-to-right, with no raw keys, when the stored UI language is Arabic', async () => {
      const { el, i18n, settle } = await setup({ uiLang: 'ar', testPhone: '966500000001' });
      expect(i18n.lang()).toBe('ar');
      await settle(DEBOUNCE);
      const t = text(el);
      expect(t).toContain('Language');
      expect(t).toContain('Each customer gets their own language');
      expect(t).toContain('Arabic 12');
      expect(t).not.toMatch(/(promolang|flowlang|status|common)\.[a-zA-Z]/);
      expect(t).not.toMatch(/\p{Script=Arabic}/u);
      expect(el.querySelector('[dir="rtl"]')).toBeNull();
    });
  });
});
