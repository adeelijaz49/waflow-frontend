import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CampaignPlan, LocalizedTemplate, TemplateVariant } from '../localization.types';
import { LocUiService } from '../shared/loc-ui.service';
import { CampaignComposer } from './campaign-composer';

const BIDI = /[\u{200E}\u{200F}\u{2066}-\u{2069}\u{202A}-\u{202E}]/gu;
const plain = (s: string | null | undefined): string => (s ?? '').replace(BIDI, '').replace(/\s+/g, ' ');

function variant(language: 'en' | 'ar', over: Partial<TemplateVariant> = {}): TemplateVariant {
  return {
    language, bilingualOrder: null, header: '', body: language === 'en' ? 'Hi {name}, {discount} off until {date}. {link} You have {points} points.' : 'مرحباً {name}، خصم {discount} حتى {date}. {link}',
    footer: '', buttons: [], metaTemplateName: null, metaStatus: language === 'en' ? 'APPROVED' : 'NOT_CREATED',
    metaRejectedReason: null, metaCategory: 'MARKETING', metaPreviousCategory: null, metaFlagged: false, metaStatusRaw: null,
    metaLastCheckedAt: null, submittedAt: null, submissionCount: 0, lastError: null, reviewStatus: 'draft', reviewedBy: null,
    reviewedAt: null, source: 'merchant', validation: { ok: true, errors: [], warnings: [], positionalText: '', params: [] },
    sendable: language === 'en', notSendableReason: language === 'en' ? null : 'not_submitted', updatedAt: '2026-10-01T00:00:00Z', ...over,
  };
}

const TEMPLATE: LocalizedTemplate = {
  id: 't1', key: 'winback', name: 'Win-back', useCase: 'comeback', category: 'MARKETING', archived: false,
  linkedMessageNodeId: null, variants: [variant('en'), variant('ar')], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

function makePlan(over: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    templateId: 't1', templateName: 'Win-back', category: 'MARKETING', languageMode: 'per_customer',
    audience: { selected: 60, eligible: 50 }, skipped: { noConsent: 6, optedOut: 2, demo: 1, invalidPhone: 1 },
    byLanguage: { en: 42, ar: 5, bilingual: 0 },
    fallbacks: [{ from: 'ar', to: 'en', reason: 'ar_not_submitted', count: 42 }],
    blocked: [{ reason: 'no_usable_variant', count: 3 }],
    variants: [
      { language: 'en', present: true, metaStatus: 'APPROVED', reviewStatus: 'reviewed', sendable: true, notSendableReason: null, recipients: 42 },
      { language: 'ar', present: true, metaStatus: 'NOT_CREATED', reviewStatus: 'draft', sendable: false, notSendableReason: 'not_submitted', recipients: 5 },
    ],
    missingFieldValues: [], warnings: [{ code: 'large_audience', detail: { count: 300 } }, { code: 'category_floored', detail: { useCase: 'comeback' } }, { code: 'brand_new_code' }],
    canSend: true, needsAcknowledgement: true,
    sampleRecipients: [{ customerId: 'c1', name: 'سارة العتيبي', language: 'en', fallback: true, preview: 'Hello Sara' }],
    ...over,
  };
}

describe('CampaignComposer', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let ui: LocUiService;
  let i18n: I18nService;
  let router: Router;
  let fixture: ComponentFixture<CampaignComposer>;
  let el: HTMLElement;

  const tick = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    fixture.detectChanges();
  };

  async function create(lang: 'en' | 'ar' = 'en'): Promise<void> {
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(CampaignComposer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    vi.useFakeTimers();
  }

  const click = (selector: string): void => {
    (el.querySelector(selector) as HTMLElement).click();
    fixture.detectChanges();
  };
  const planCalls = (): unknown[][] => api['planCampaign'].mock.calls;
  const lastPlanReq = (): Record<string, unknown> => planCalls()[planCalls().length - 1][0] as Record<string, unknown>;

  async function pickTemplate(): Promise<void> {
    click('input[name="cmp-template"]');
    await tick(500);
  }

  beforeEach(() => {
    localStorage.clear();
    api = {
      listTemplates: vi.fn(() => of({ items: [TEMPLATE] })),
      getSegments: vi.fn(() => of({ items: [{ key: 'language', params: ['language'] }, { key: 'awaiting_consent', params: [] }] })),
      planCampaign: vi.fn(() => of(makePlan())),
      createCampaign: vi.fn(() => of({ id: 'new1', name: 'x' })),
      sendCampaign: vi.fn(() => of({ campaign: { id: 'new1' } })),
      previewVariant: vi.fn((b: { variant: { language: string } }) => of({
        language: b.variant.language, header: '', body: `Rendered ${b.variant.language}`, footer: '', buttons: [], usedValues: {}, missingFields: [],
      })),
      listCustomers: vi.fn(() => of({
        items: [{ id: 'c1', name: 'سارة', phone: '+966501234567', language: 'ar', languageSource: null, effectiveLanguage: 'ar', marketingConsent: true, optedOut: false }],
        total: 1, page: 1, limit: 15, counts: { en: 0, ar: 1, unknown: 0, total: 1 },
      })),
      getSettings: vi.fn(() => of({ arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first' })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }, provideRouter([])] });
    ui = TestBed.inject(LocUiService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it('renders in English, lists the templates with approval badges and no raw keys', async () => {
    await create('en');
    expect(i18n.dir()).toBe('ltr');
    expect(el.textContent).toContain('New campaign');
    expect(el.textContent).toContain('Win-back');
    expect(el.textContent).toContain('Approved');
    expect(el.textContent).toContain('Not created');
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
    expect(el.querySelector('.cmp-opt-name')?.getAttribute('dir')).toBe('auto');
  });

  it('renders in Arabic (rtl) with localised sections', async () => {
    await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('حملة جديدة');
    expect(el.textContent).toContain('حقول الرسالة');
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
  });

  it('keeps later sections locked until a template is chosen', async () => {
    await create();
    expect(el.querySelector('input[name="cmp-mode"]')).toBeNull();
    expect(planCalls().length).toBe(0);
    await pickTemplate();
    expect(el.querySelectorAll('input[name="cmp-mode"]').length).toBe(4);
    expect(lastPlanReq()).toMatchObject({ templateId: 't1', languageMode: 'per_customer', audience: { kind: 'all_eligible' } });
  });

  it('changing the language mode re-plans with the new languageMode (debounced)', async () => {
    await create();
    await pickTemplate();
    const before = planCalls().length;
    const modeRadios = el.querySelectorAll<HTMLInputElement>('input[name="cmp-mode"]');
    modeRadios[2].click(); // ar
    fixture.detectChanges();
    await tick(200);
    expect(planCalls().length).toBe(before); // still debouncing
    await tick(300);
    expect(planCalls().length).toBe(before + 1);
    expect(lastPlanReq()).toMatchObject({ languageMode: 'ar' });
  });

  it('shows fallback and blocked callouts with plural-aware text, in English', async () => {
    await create('en');
    await pickTemplate();
    const text = plain(el.textContent);
    expect(text).toContain('42 customers will receive the English version because the Arabic version hasn\'t been submitted to WhatsApp for approval.');
    expect(text).toContain('3 customers will be skipped because no approved version of this template can be used for them.');
    expect(text).toContain('Will receive Arabic');
    expect(text).toContain('Will be skipped');
    expect(el.querySelectorAll('.pv-n')[0].textContent?.trim()).toBe('5');
    expect(text).toContain('This campaign goes to 300 customers');
    expect(text).toContain('This message type is always sent as Marketing, so only customers who opted in will receive it.');
    expect(text).toContain('There is a warning about this campaign that this page can\'t describe yet.');
  });

  it('shows the same callouts in Arabic with Arabic plural forms', async () => {
    await create('ar');
    await pickTemplate();
    const text = plain(el.textContent);
    expect(text).toContain('سيستلم 42 عميلاً النسخة الإنجليزية لأن النسخة العربية لم تُقدَّم للاعتماد لدى واتساب بعد');
    expect(text).toContain('سيتم تخطي 3 عملاء لأن');
    expect(text).toContain('يُرسل هذا النوع من الرسائل دائماً كرسالة تسويقية، لذلك لن يستلمه إلا العملاء الذين وافقوا على استلام الرسائل.');
    expect(el.querySelector('app-campaign-plan')).toBeTruthy();
  });

  it('shows previews as the customer sees them (variants rendered by the server)', async () => {
    await create();
    await pickTemplate();
    expect(api['previewVariant']).toHaveBeenCalled();
    const langs = api['previewVariant'].mock.calls.map((c) => (c[0] as { variant: { language: string } }).variant.language).sort();
    expect(langs).toEqual(['ar', 'en']);
    expect(el.textContent).toContain('Rendered ar');
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('app-campaign-variant-preview .btn'));
    buttons[0].click(); // Arabic customer only
    fixture.detectChanges();
    await tick(500);
    expect(el.textContent).not.toContain('Rendered en');
    expect(el.textContent).toContain('Rendered ar');
  });

  it('asks only for fields that are not filled automatically', async () => {
    await create();
    await pickTemplate();
    const ids = Array.from(el.querySelectorAll<HTMLInputElement>('input[id^="cmp-f-"]')).map((i) => i.id);
    expect(ids).toEqual(['cmp-f-discount', 'cmp-f-date', 'cmp-f-link']);
    expect(el.textContent).toContain('Filled in automatically for each customer:');
    expect(el.textContent).toContain('Customer name');
    expect(el.textContent).toContain('Loyalty points');
    expect(el.querySelector<HTMLInputElement>('#cmp-f-discount')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector<HTMLInputElement>('#cmp-f-date')?.type).toBe('date');
  });

  it('sends only valid field values to the plan and rejects a non-https link', async () => {
    await create();
    await pickTemplate();
    const set = (id: string, value: string): void => {
      const input = el.querySelector<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('#cmp-f-discount', '20%');
    set('#cmp-f-date', '2026-11-05');
    set('#cmp-f-link', 'http://insecure.example.com');
    fixture.detectChanges();
    await tick(500);
    expect(lastPlanReq()['fieldValues']).toEqual({ discount: '20%', date: '05/11/2026' });
    expect(el.textContent).toContain('Enter a link that starts with https://');
    set('#cmp-f-link', 'https://waflowtech.com/offer');
    fixture.detectChanges();
    await tick(500);
    expect(lastPlanReq()['fieldValues']).toEqual({ discount: '20%', date: '05/11/2026', link: 'https://waflowtech.com/offer' });
  });

  async function readyToSend(): Promise<HTMLButtonElement> {
    await pickTemplate();
    for (const [id, value] of [['#cmp-f-discount', '20%'], ['#cmp-f-date', '2026-11-05'], ['#cmp-f-link', 'https://waflowtech.com/o']]) {
      const input = el.querySelector<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    await tick(500);
    return el.querySelector<HTMLButtonElement>('[data-test="send"]')!;
  }

  it('keeps Send disabled until the acknowledgements are ticked', async () => {
    await create();
    const send = await readyToSend();
    expect(send.disabled).toBe(true);
    expect(el.textContent).toContain('Tick the acknowledgements above to continue.');
    const checks = el.querySelectorAll<HTMLInputElement>('.cmp-ack input');
    expect(checks.length).toBe(2);
    checks[0].click();
    fixture.detectChanges();
    expect(send.disabled).toBe(true);
    checks[1].click();
    fixture.detectChanges();
    expect(send.disabled).toBe(false);
  });

  it('keeps Send disabled when the plan says canSend is false, even when acknowledged', async () => {
    api['planCampaign'].mockReturnValue(of(makePlan({ canSend: false })));
    await create();
    const send = await readyToSend();
    el.querySelectorAll<HTMLInputElement>('.cmp-ack input').forEach((c) => c.click());
    fixture.detectChanges();
    expect(send.disabled).toBe(true);
    expect(el.textContent).toContain('This campaign can\'t be sent as planned.');
  });

  it('does not need acknowledgements when there are no fallbacks or blocked recipients', async () => {
    api['planCampaign'].mockReturnValue(of(makePlan({ fallbacks: [], blocked: [], needsAcknowledgement: false })));
    await create();
    const send = await readyToSend();
    expect(el.querySelectorAll('.cmp-ack').length).toBe(0);
    expect(send.disabled).toBe(false);
  });

  it('never calls the API before the user confirms; then creates, sends with acknowledgements and opens the campaign', async () => {
    await create();
    const send = await readyToSend();
    el.querySelectorAll<HTMLInputElement>('.cmp-ack input').forEach((c) => c.click());
    fixture.detectChanges();

    send.click();
    await tick();
    expect(ui.confirmState()).not.toBeNull();
    expect(plain(ui.confirmState()!.message)).toContain('Send to 47 customers: 5 in Arabic, 42 in English. 10 customers will be skipped.');
    expect(api['createCampaign']).not.toHaveBeenCalled();
    expect(api['sendCampaign']).not.toHaveBeenCalled();

    ui.respond(false); // declined
    await tick();
    expect(api['createCampaign']).not.toHaveBeenCalled();
    expect(api['sendCampaign']).not.toHaveBeenCalled();
    expect(send.disabled).toBe(false);

    send.click();
    await tick();
    ui.respond(true);
    await tick();
    expect(api['createCampaign']).toHaveBeenCalledTimes(1);
    const body = api['createCampaign'].mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ templateId: 't1', languageMode: 'per_customer', audience: { kind: 'all_eligible' }, fieldValues: { discount: '20%' } });
    expect(String(body['name'])).toContain('Win-back');
    expect(api['sendCampaign']).toHaveBeenCalledWith('new1', { fallbacks: true, blocked: true });
    expect(router.navigate).toHaveBeenCalledWith(['/arabic/campaigns', 'new1']);
  });

  it('is double-click safe: one confirmation, one create, one send', async () => {
    await create();
    const send = await readyToSend();
    el.querySelectorAll<HTMLInputElement>('.cmp-ack input').forEach((c) => c.click());
    fixture.detectChanges();
    const confirm = vi.spyOn(ui, 'confirm');
    send.click();
    send.click();
    send.click();
    await tick();
    expect(confirm).toHaveBeenCalledTimes(1);
    ui.respond(true);
    await tick();
    send.click();
    await tick();
    expect(api['createCampaign']).toHaveBeenCalledTimes(1);
    expect(api['sendCampaign']).toHaveBeenCalledTimes(1);
  });

  it('shows a localised inline error when creating fails and does not send', async () => {
    api['createCampaign'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'FIELD_VALUES_MISSING' } })));
    await create();
    const send = await readyToSend();
    el.querySelectorAll<HTMLInputElement>('.cmp-ack input').forEach((c) => c.click());
    fixture.detectChanges();
    send.click();
    await tick();
    ui.respond(true);
    await tick();
    expect(el.querySelector('section[aria-labelledby="cmp-s6"] .loc-error')?.textContent).toContain('Fill in all the message fields before sending.');
    expect(api['sendCampaign']).not.toHaveBeenCalled();
    expect(send.disabled).toBe(false);
  });

  it('maps a send failure to a localised toast and opens the draft so the user can retry', async () => {
    api['sendCampaign'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'PLAN_NEEDS_ACK' } })));
    await create('ar');
    const send = await readyToSend();
    el.querySelectorAll<HTMLInputElement>('.cmp-ack input').forEach((c) => c.click());
    fixture.detectChanges();
    send.click();
    await tick();
    ui.respond(true);
    await tick();
    expect(ui.toasts()[0].message).toBe(i18n.t('errors.PLAN_NEEDS_ACK'));
    expect(ui.toasts()[0].kind).toBe('error');
    expect(router.navigate).toHaveBeenCalledWith(['/arabic/campaigns', 'new1']);
  });

  it('save as draft creates the campaign without sending it', async () => {
    await create();
    await readyToSend();
    click('[data-test="draft"]');
    await tick();
    expect(api['createCampaign']).toHaveBeenCalledTimes(1);
    expect(api['sendCampaign']).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/arabic/campaigns', 'new1']);
  });

  it('shows a localised error when the plan cannot be built', async () => {
    api['planCampaign'].mockReturnValue(throwError(() => ({ status: 404, error: { code: 'TEMPLATE_NOT_FOUND' } })));
    await create();
    await pickTemplate();
    expect(el.textContent).toContain('We couldn\'t find that template.');
    expect(el.querySelector<HTMLButtonElement>('[data-test="send"]')).toBeNull();
  });

  it('chooses customers with a capped picker and plans with their ids', async () => {
    await create();
    await pickTemplate();
    const kinds = el.querySelectorAll<HTMLInputElement>('input[name="cmp-audience"]');
    kinds[2].click();
    fixture.detectChanges();
    await tick();
    expect(api['listCustomers']).toHaveBeenCalled();
    expect(el.textContent).toContain('0 / 2,000 selected');
    expect(planCalls().length).toBe(1); // nobody chosen yet: no new plan request
    el.querySelector<HTMLInputElement>('.cp-table tbody input[type=checkbox]')!.click();
    fixture.detectChanges();
    await tick(500);
    expect(el.textContent).toContain('1 / 2,000 selected');
    expect(lastPlanReq()['audience']).toEqual({ kind: 'customer_ids', customerIds: ['c1'] });
  });

  it('plans a segment audience with its parameters', async () => {
    await create();
    await pickTemplate();
    el.querySelectorAll<HTMLInputElement>('input[name="cmp-audience"]')[1].click();
    fixture.detectChanges();
    await tick(500);
    expect(lastPlanReq()['audience']).toEqual({ kind: 'segment', segmentKey: 'language', segmentParams: { language: 'ar' } });
  });

  it('disables a language option when the template has no such version', async () => {
    await create();
    await pickTemplate();
    const radios = el.querySelectorAll<HTMLInputElement>('input[name="cmp-mode"]');
    expect(radios[3].disabled).toBe(true); // bilingual
    expect(el.textContent).toContain('This template has no version in this language yet.');
    expect(el.textContent).toContain('This version isn\'t approved yet.');
  });
});
