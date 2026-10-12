import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CampaignPlan, CampaignRecipientRow, CampaignReport, CampaignStatus, LocalizedCampaignView } from '../localization.types';
import { LocUiService } from '../shared/loc-ui.service';
import { CampaignDetail } from './campaign-detail';

const BIDI = /[\u{200E}\u{200F}\u{2066}-\u{2069}\u{202A}-\u{202E}]/gu;
const plain = (s: string | null | undefined): string => (s ?? '').replace(BIDI, '').replace(/\s+/g, ' ');

function plan(over: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    templateId: 't1', templateName: 'Win-back', category: 'MARKETING', languageMode: 'per_customer',
    audience: { selected: 10, eligible: 8 }, skipped: { noConsent: 2, optedOut: 0, demo: 0, invalidPhone: 0 },
    byLanguage: { en: 3, ar: 5, bilingual: 0 },
    fallbacks: [{ from: 'ar', to: 'en', reason: 'ar_pending', count: 1 }], blocked: [],
    variants: [{ language: 'en', present: true, metaStatus: 'APPROVED', reviewStatus: 'reviewed', sendable: true, notSendableReason: null, recipients: 3 }],
    missingFieldValues: [], warnings: [], canSend: true, needsAcknowledgement: true, sampleRecipients: [], ...over,
  };
}

function campaign(status: CampaignStatus, sent = 2, over: Partial<LocalizedCampaignView> = {}): LocalizedCampaignView {
  return {
    id: 'cmp1', name: 'عرض الجمعة', templateId: 't1', templateName: 'Win-back', languageMode: 'per_customer',
    audience: { kind: 'all_eligible' }, fieldValues: { discount: '20%' }, status, plan: plan(),
    stats: { total: 8, sent, failed: 1, skipped: 1, byLanguage: { en: 3, ar: 5, bilingual: 0 } },
    startedAt: '2026-10-10T10:00:00Z', finishedAt: null, lastError: null, createdAt: '2026-10-10T09:00:00Z', updatedAt: '2026-10-10T10:00:00Z', ...over,
  };
}

const ROWS: CampaignRecipientRow[] = [
  { customerId: 'c1', name: 'سارة العتيبي', phone: '+966501234567', requestedLanguage: 'ar', usedLanguage: 'en', fallback: true, fallbackReason: 'ar_pending', status: 'sent', deliveryStatus: 'read', wamid: 'w1', error: null, errorCode: null },
  { customerId: 'c2', name: 'John Smith', phone: '+14155550123', requestedLanguage: 'en', usedLanguage: 'en', fallback: false, fallbackReason: null, status: 'failed', deliveryStatus: null, wamid: null, error: 'Template paused', errorCode: '132015' },
  { customerId: 'c3', name: 'Ali', phone: '+966500000001', requestedLanguage: 'ar', usedLanguage: 'ar', fallback: false, fallbackReason: null, status: 'failed', deliveryStatus: null, wamid: null, error: 'Boom', errorCode: '999999' },
];

const REPORT: CampaignReport = {
  campaignId: 'cmp1', status: 'sent', stats: campaign('sent').stats,
  byLanguage: { en: { sent: 2, delivered: 1, read: 1, failed: 1 }, ar: { sent: 3, delivered: 2, read: 0, failed: 0 }, bilingual: { sent: 0, delivered: 0, read: 0, failed: 0 } },
  byStatus: { sent: 5, failed: 1, skipped_no_consent: 2 }, fallbackCount: 2,
};

describe('CampaignDetail', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let ui: LocUiService;
  let i18n: I18nService;
  let fixture: ComponentFixture<CampaignDetail>;
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
    vi.useFakeTimers();
    fixture = TestBed.createComponent(CampaignDetail);
    fixture.detectChanges();
    await tick();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    api = {
      getCampaign: vi.fn(() => of(campaign('sent', 5))),
      getCampaignReport: vi.fn(() => of(REPORT)),
      getCampaignRecipients: vi.fn(() => of({ items: ROWS, total: 3, page: 1, limit: 25 })),
      planCampaign: vi.fn(() => of(plan())),
      sendCampaign: vi.fn(() => of({ campaign: campaign('sending', 0) })),
      cancelCampaign: vi.fn(() => of(campaign('cancelled'))),
      getSettings: vi.fn(() => of({ arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first' })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: LocalizationApiService, useValue: api },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'cmp1' }) } } },
      ],
    });
    ui = TestBed.inject(LocUiService);
  });

  afterEach(() => vi.useRealTimers());

  it('renders a finished campaign in English: stats, stored plan, report and recipients', async () => {
    await create('en');
    expect(el.textContent).toContain('عرض الجمعة');
    expect(el.textContent).toContain('Sent');
    expect(plain(el.textContent)).toContain('Delivery report');
    expect(plain(el.textContent)).toContain('Plan used for this campaign');
    expect(plain(el.textContent)).toContain('Customers who received a fallback language: 2 customers');
    expect(el.querySelectorAll('.cd-rec tbody tr').length).toBe(3);
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
    expect(el.querySelector('.cd-cell')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('.cd-rec [appPhone], .cd-rec .loc-phone')?.getAttribute('dir')).toBe('ltr');
    expect(api['planCampaign']).not.toHaveBeenCalled(); // only drafts are re-planned
  });

  it('renders in Arabic (rtl)', async () => {
    await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('تقرير التسليم');
    expect(el.textContent).toContain('المستلمون');
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
  });

  it('maps failed-send error codes to plain text and keeps the raw code in a tooltip', async () => {
    await create('en');
    const rows = el.querySelectorAll('.cd-rec tbody tr');
    expect(rows[1].textContent).toContain('WhatsApp has paused this template.');
    expect(rows[1].querySelector('[title="132015 - Template paused"]')).toBeTruthy();
    expect(rows[2].textContent).toContain('The message couldn\'t be sent.');
    expect(rows[2].querySelector('[title="999999 - Boom"]')).toBeTruthy();
  });

  describe('a recipient skipped because another record with the same phone number opted out', () => {
    const SKIPPED: CampaignRecipientRow = {
      customerId: 'c4', name: 'Huda', phone: '+966500000002', requestedLanguage: 'ar', usedLanguage: null, fallback: false,
      fallbackReason: null, status: 'skipped_opted_out', deliveryStatus: null, wamid: null, error: null, errorCode: 'opted_out_same_phone',
    };
    beforeEach(() => api['getCampaignRecipients'].mockReturnValue(of({ items: [SKIPPED], total: 1, page: 1, limit: 25 })));

    it('shows the localised reason next to the status, in English', async () => {
      await create('en');
      const row = el.querySelector('.cd-rec tbody tr')!;
      expect(plain(row.textContent)).toContain('Skipped: opted out');
      expect(plain(row.textContent)).toContain('Skipped: another contact with this phone number opted out.');
      expect(plain(row.textContent)).not.toContain('The message couldn\'t be sent.');
      expect(row.querySelector('[title="opted_out_same_phone"]')).toBeTruthy(); // the raw code stays in the tooltip
    });

    it('shows the localised reason in Arabic', async () => {
      await create('ar');
      const row = el.querySelector('.cd-rec tbody tr')!;
      expect(plain(row.textContent)).toContain('تم التخطي: ألغى عميل آخر لديه رقم الهاتف نفسه اشتراكه.');
      expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
    });
  });

  describe('a campaign that stopped because WhatsApp rejected the template', () => {
    const stopped = (): LocalizedCampaignView => campaign('failed', 2, { lastError: 'template_unusable:132001' });
    const box = (): HTMLElement => el.querySelector<HTMLElement>('[data-test="last-error"]')!;

    it('explains it in a sentence with the parsed code instead of the raw error, in English', async () => {
      api['getCampaign'].mockReturnValue(of(stopped()));
      await create('en');
      expect(plain(box().textContent).trim()).toBe('Sending stopped: WhatsApp rejected this template (code 132001). The remaining recipients were not messaged.');
      expect(box().querySelector('.cd-raw')).toBeNull();
      expect(el.textContent).not.toContain('template_unusable');
    });

    it('explains it in Arabic (rtl) with the code kept left-to-right', async () => {
      api['getCampaign'].mockReturnValue(of(stopped()));
      await create('ar');
      expect(i18n.dir()).toBe('rtl');
      expect(plain(box().textContent)).toContain('توقف الإرسال: رفض واتساب هذا القالب (رمز الخطأ 132001). لم تُرسل الرسالة إلى بقية المستلمين.');
      expect(box().textContent).toMatch(/\u{2066}132001\u{2069}/u);
      expect(el.textContent).not.toContain('template_unusable');
    });

    it('still shows any other error as the raw text under the generic label', async () => {
      api['getCampaign'].mockReturnValue(of(campaign('failed', 2, { lastError: 'Something odd happened' })));
      await create('en');
      expect(plain(box().textContent)).toContain('Last error recorded:');
      expect(box().querySelector('.cd-raw')?.textContent).toBe('Something odd happened');
    });

    it('shows no error box when there is no error', async () => {
      await create('en');
      expect(el.querySelector('[data-test="last-error"]')).toBeNull();
    });
  });

  it('marks fallback recipients with the requested and used language and the reason', async () => {
    await create('en');
    const first = el.querySelectorAll('.cd-rec tbody tr')[0];
    expect(first.querySelectorAll('.loc-lang-pill').length).toBe(2);
    const badge = first.querySelector<HTMLElement>('.badge-warning')!;
    expect(badge.textContent).toContain('Fallback');
    expect(plain(badge.getAttribute('title'))).toContain('the Arabic version is still waiting for WhatsApp approval');
  });

  it('polls every 3 seconds while sending and stops once the campaign has finished', async () => {
    const seq = [campaign('sending', 1), campaign('sending', 3), campaign('sent', 6)];
    let i = 0;
    api['getCampaign'].mockImplementation(() => of(seq[Math.min(i++, seq.length - 1)]));
    await create('en');
    expect(api['getCampaign']).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Updating automatically');
    await tick(2900);
    expect(api['getCampaign']).toHaveBeenCalledTimes(1);
    await tick(200);
    expect(api['getCampaign']).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('.cd-n')[1].textContent?.trim()).toBe('3');
    await tick(3000);
    expect(api['getCampaign']).toHaveBeenCalledTimes(3);
    expect(el.textContent).not.toContain('Updating automatically');
    expect(api['getCampaignReport']).toHaveBeenCalled();
    await tick(15000);
    expect(api['getCampaign']).toHaveBeenCalledTimes(3);
  });

  it('keeps polling after a failed refresh and stops when the page is destroyed', async () => {
    let n = 0;
    api['getCampaign'].mockImplementation(() => (n++ === 1 ? throwError(() => ({ status: 0 })) : of(campaign('sending', 1))));
    await create('en');
    await tick(3100);
    expect(api['getCampaign']).toHaveBeenCalledTimes(2);
    await tick(3100);
    expect(api['getCampaign']).toHaveBeenCalledTimes(3);
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(10000);
    expect(api['getCampaign']).toHaveBeenCalledTimes(3);
  });

  it('a refresh still in flight when the page is left does not re-arm the polling timer', async () => {
    const inFlight = new Subject<LocalizedCampaignView>();
    let n = 0;
    api['getCampaign'].mockImplementation(() => (n++ === 1 ? inFlight : of(campaign('sending', 1))));
    await create('en');
    await tick(3100); // the second request is now pending
    expect(api['getCampaign']).toHaveBeenCalledTimes(2);
    fixture.destroy();
    inFlight.next(campaign('sending', 2));
    inFlight.complete();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api['getCampaign']).toHaveBeenCalledTimes(2);
  });

  it('cancel asks for confirmation first, then calls cancelCampaign', async () => {
    api['getCampaign'].mockReturnValue(of(campaign('sending', 1)));
    await create('en');
    const btn = el.querySelector<HTMLButtonElement>('[data-test="cancel"]')!;
    btn.click();
    await tick();
    expect(ui.confirmState()?.danger).toBe(true);
    expect(api['cancelCampaign']).not.toHaveBeenCalled();
    ui.respond(false);
    await tick();
    expect(api['cancelCampaign']).not.toHaveBeenCalled();
    btn.click();
    await tick();
    ui.respond(true);
    await tick();
    expect(api['cancelCampaign']).toHaveBeenCalledWith('cmp1');
    expect(el.textContent).toContain('Cancelled');
    expect(el.querySelector('[data-test="cancel"]')).toBeNull();
    expect(ui.toasts()[0].message).toBe('Campaign cancelled.');
  });

  it('offers no cancel button once the campaign is finished', async () => {
    await create('en');
    expect(el.querySelector('[data-test="cancel"]')).toBeNull();
  });

  it('filters recipients by status and language, going back to page 1', async () => {
    await create('en');
    const [statusSel, langSel] = Array.from(el.querySelectorAll<HTMLSelectElement>('.card-header select'));
    statusSel.value = 'failed';
    statusSel.dispatchEvent(new Event('change'));
    await tick();
    expect(api['getCampaignRecipients']).toHaveBeenLastCalledWith('cmp1', { status: 'failed', language: undefined, page: 1, limit: 25 });
    langSel.value = 'ar';
    langSel.dispatchEvent(new Event('change'));
    await tick();
    expect(api['getCampaignRecipients']).toHaveBeenLastCalledWith('cmp1', { status: 'failed', language: 'ar', page: 1, limit: 25 });
  });

  it('shows a localised error when the campaign cannot be loaded', async () => {
    api['getCampaign'].mockReturnValue(throwError(() => ({ status: 404, error: { code: 'CAMPAIGN_NOT_FOUND' } })));
    await create('en');
    expect(el.querySelector('.loc-error')?.textContent).toContain('We couldn\'t find that campaign.');
    expect(api['getCampaignRecipients']).not.toHaveBeenCalled();
  });

  describe('draft', () => {
    beforeEach(() => api['getCampaign'].mockReturnValue(of(campaign('draft', 0, { plan: null }))));

    it('re-plans the draft with its stored settings and needs acknowledgements before Send is enabled', async () => {
      await create('en');
      expect(api['planCampaign']).toHaveBeenCalledWith({ templateId: 't1', languageMode: 'per_customer', audience: { kind: 'all_eligible' }, fieldValues: { discount: '20%' } });
      expect(api['getCampaignRecipients']).not.toHaveBeenCalled();
      const send = el.querySelector<HTMLButtonElement>('[data-test="send"]')!;
      expect(send.disabled).toBe(true);
      el.querySelector<HTMLInputElement>('.cd-ack input')!.click();
      fixture.detectChanges();
      expect(send.disabled).toBe(false);
    });

    it('stays disabled when the fresh plan cannot be sent', async () => {
      api['planCampaign'].mockReturnValue(of(plan({ canSend: false, fallbacks: [], needsAcknowledgement: false })));
      await create('en');
      expect(el.querySelector<HTMLButtonElement>('[data-test="send"]')!.disabled).toBe(true);
    });

    it('sends only after the confirmation, with the acknowledgements, and then starts polling', async () => {
      await create('en');
      el.querySelector<HTMLInputElement>('.cd-ack input')!.click();
      fixture.detectChanges();
      const send = el.querySelector<HTMLButtonElement>('[data-test="send"]')!;
      send.click();
      send.click();
      await tick();
      expect(plain(ui.confirmState()?.message)).toContain('Send to 8 customers: 5 in Arabic, 3 in English. 2 customers will be skipped.');
      expect(api['sendCampaign']).not.toHaveBeenCalled();
      ui.respond(false);
      await tick();
      expect(api['sendCampaign']).not.toHaveBeenCalled();
      send.click();
      await tick();
      ui.respond(true);
      await tick();
      expect(api['sendCampaign']).toHaveBeenCalledTimes(1);
      expect(api['sendCampaign']).toHaveBeenCalledWith('cmp1', { fallbacks: true, blocked: false });
      api['getCampaign'].mockClear();
      await tick(3100);
      expect(api['getCampaign']).toHaveBeenCalledTimes(1); // now sending: polling
    });

    it('maps a send error to a localised message and reloads the real state', async () => {
      api['sendCampaign'].mockReturnValue(throwError(() => ({ status: 409, error: { code: 'CAMPAIGN_NOT_DRAFT' } })));
      await create('ar');
      el.querySelector<HTMLInputElement>('.cd-ack input')!.click();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('[data-test="send"]')!.click();
      await tick();
      ui.respond(true);
      await tick();
      expect(el.textContent).toContain(i18n.t('errors.CAMPAIGN_NOT_DRAFT'));
      expect(api['getCampaign']).toHaveBeenCalledTimes(2);
    });
  });
});
