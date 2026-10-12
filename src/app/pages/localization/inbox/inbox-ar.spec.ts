import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { InboxApiService } from '../../../services/inbox-api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { SettingsService } from '../../../shared/settings.service';
import { LocUiService } from '../shared/loc-ui.service';
import type { InboxConversation } from '../localization.types';
import { InboxAr } from './inbox-ar';
import { InboxLabels, normalizeStatus, parseAmount } from './inbox-labels';
import type { SnapshotResponse, ThreadResponse } from './inbox-types';

const NOW = '2026-10-12T09:30:00.000Z';
const ARABIC_TEXT = 'مرحبا، هل عندكم Order #123 متوفر؟';

const C1: InboxConversation = {
  customerId: 'c1', name: 'سارة العتيبي', phone: '+966501234567', optedOut: false, unreadCount: 2,
  lastMessageAt: NOW, lastMessagePreview: '📣 Promotion sent', tags: ['High-value', 'Mystery tag'], language: 'ar',
};
const C2: InboxConversation = {
  customerId: 'c2', name: 'John Smith', phone: '+14155550123', optedOut: true, unreadCount: 0,
  lastMessageAt: NOW, lastMessagePreview: '↩️ Button tap', tags: [], language: 'unknown',
};

const THREAD: ThreadResponse = {
  customer: { _id: 'c1', name: 'سارة العتيبي', phone: '+966501234567', optedOut: false },
  messages: [
    { id: 'm1', direction: 'inbound', messageType: 'manual', body: ARABIC_TEXT, timestamp: NOW },
    { id: 'm2', direction: 'outbound', messageType: 'manual', body: 'Hello, yes we have it', status: 'read', timestamp: NOW },
    { id: 'm3', direction: 'outbound', messageType: 'booking', body: '📅 Booking no-show — Haircut on 2026-10-14 at 15:30', status: 'no-show', timestamp: NOW },
    { id: 'm4', direction: 'outbound', messageType: 'order', body: '🛍️ Order confirmed — 2 item(s) · 40.00 SAR', status: 'delivered', timestamp: NOW },
    { id: 'm5', direction: 'outbound', messageType: 'weird', body: 'Plain text', status: 'something_new', timestamp: NOW },
  ],
};

const SNAPSHOT: SnapshotResponse = {
  customer: {
    _id: 'c1', name: 'سارة العتيبي', phone: '+966501234567', optedOut: false, marketingConsent: true,
    loyaltyPoints: 3, createdAt: NOW,
  },
  totalOrders: 4, totalSpent: 150,
  lastOrder: { _id: 'o1', total: 40, status: 'confirmed', paymentStatus: 'paid', createdAt: NOW },
  lastCampaign: { kind: 'loyalty_reminder', promotionName: null },
  productsPurchased: [{ name: 'قهوة عربية', quantity: 2 }],
  servicesBooked: [{ name: 'Haircut', status: 'no-show', date: '2026-10-14', startTime: '15:30' }],
  tags: ['High-value'],
  prompts: ['This customer has not ordered in 40 days.', 'This customer has 3 unused loyalty points.', 'Something new from the server.'],
};

describe('InboxAr', () => {
  let loc: Record<string, ReturnType<typeof vi.fn>>;
  let inbox: Record<string, ReturnType<typeof vi.fn>>;
  let ui: LocUiService;
  let i18n: I18nService;
  let fixture: ComponentFixture<InboxAr>;

  async function create(lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(InboxAr);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function flush(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  async function openFirst(el: HTMLElement): Promise<void> {
    (el.querySelector('.cl-row') as HTMLButtonElement).click();
    flush();
    await Promise.resolve();
    flush();
  }

  function type(el: HTMLElement, selector: string, value: string): void {
    const box = el.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    flush();
  }

  function button(el: HTMLElement, scope: string, labelKey: string): HTMLButtonElement {
    const label = i18n.t(labelKey);
    const found = [...el.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`button not found: ${labelKey} (${label})`);
    return found;
  }

  beforeEach(() => {
    localStorage.clear();
    loc = {
      searchConversations: vi.fn(() => of({ conversations: [C1, C2] })),
      getInboxContext: vi.fn((id: string) => of({ customerId: id, language: 'ar', languageSource: 'merchant_set', effectiveLanguage: 'ar' })),
      aiTranslateInbound: vi.fn(() => of({ translation: 'Hello, do you have Order #123 in stock?', detectedLanguage: 'ar', draft: true })),
      aiReplyInArabic: vi.fn(() => of({ text: 'سنشحن طلبك غداً إن شاء الله', draft: true, from: 'en', to: 'ar', warnings: [], protectedTokens: { count: 0, verified: true } })),
      sendLocalizedPaymentLink: vi.fn(() => of({ sent: true })),
      sendLocalizedLoyaltyReminder: vi.fn(() => of({ sent: false, reason: 'no_approved_variant', fallbackAvailable: true })),
      setCustomerLanguage: vi.fn(() => of({})),
    };
    inbox = {
      getThread: vi.fn(() => of(THREAD)),
      getSnapshot: vi.fn(() => of(SNAPSHOT)),
      sendMessage: vi.fn(() => of({ ok: true })),
      sendLoyaltyReminder: vi.fn(() => of({})),
      sendPaymentLink: vi.fn(() => of({})),
      getConversations: vi.fn(() => of({ conversations: [] })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocalizationApiService, useValue: loc },
        { provide: InboxApiService, useValue: inbox },
        { provide: SettingsService, useValue: { currencySnapshot: 'SAR' } },
      ],
    });
    ui = TestBed.inject(LocUiService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the list in English and calls the Arabic-aware search endpoint without search or filter', async () => {
    const el = await create('en');
    expect(i18n.dir()).toBe('ltr');
    expect(loc['searchConversations']).toHaveBeenCalledWith({ filter: undefined, search: undefined });
    expect(el.textContent).toContain('All conversations');
    expect(el.textContent).toContain('Promotion sent');
    expect(el.textContent).not.toContain('inbox.');
  });

  it('renders in Arabic (rtl): chips, previews and tags are localised, names are dir=auto, phones ltr', async () => {
    const el = await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain(i18n.t('inbox.filter.highValue'));
    expect(el.textContent).toContain(i18n.t('inbox.line.promotionSent'));
    expect(el.textContent).toContain(i18n.t('inbox.tag.high_value'));
    expect(el.textContent).toContain('Mystery tag'); // unknown tag falls back to the raw text
    expect(el.textContent).not.toContain('Button tap'); // mapped placeholder
    expect(el.textContent).not.toContain('inbox.');
    expect(el.querySelector('.cl-name')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('.cl-phone')?.getAttribute('dir')).toBe('ltr');
  });

  it('searches with the typed Arabic query after a debounce, and filters with the chosen chip', async () => {
    const el = await create('ar');
    vi.useFakeTimers();
    type(el, '.cl-search', 'سَارَة ٠٥٠');
    expect(loc['searchConversations']).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(350);
    expect(loc['searchConversations']).toHaveBeenLastCalledWith({ filter: undefined, search: 'سَارَة ٠٥٠' });
    vi.useRealTimers();
    button(el, '.cl-filters', 'inbox.filter.unread').click();
    flush();
    expect(loc['searchConversations']).toHaveBeenLastCalledWith({ filter: 'unread', search: 'سَارَة ٠٥٠' });
  });

  it('shows a localised inline error with retry when the list cannot load', async () => {
    loc['searchConversations'].mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const el = await create('ar');
    expect(el.querySelector('.cl-rows .loc-error')?.textContent).toContain(i18n.t('errors.network'));
  });

  it('thread: bubbles use dir=auto, statuses are keyed by (type,status) incl. no-show, unknown values fall back', async () => {
    const el = await create('ar');
    await openFirst(el);
    const bubbles = [...el.querySelectorAll('.mb-body')];
    expect(bubbles.length).toBe(5);
    expect(bubbles.every((b) => b.getAttribute('dir') === 'auto')).toBe(true);
    expect(bubbles[0].textContent).toContain('Order #123');
    const states = [...el.querySelectorAll('.mb-state')].map((s) => s.textContent?.trim());
    expect(states).toContain(i18n.t('status.booking.no_show')); // hyphen vs underscore quirk
    expect(states).toContain(i18n.t('status.order.delivered')); // order status is a label, not a delivery tick
    expect(states).toContain('something_new'); // unknown status -> raw
    expect(el.textContent).not.toContain('no-show');
    const tick = el.querySelector('.mb-tick') as HTMLElement;
    expect(tick.getAttribute('aria-label')).toContain(i18n.t('status.delivery.read'));
    expect(el.textContent).toContain(i18n.t('inbox.type.booking'));
    // system lines are re-built from the documented English templates
    expect(bubbles[2].textContent).toContain(i18n.t('status.booking.no_show'));
    expect(bubbles[3].textContent).toContain(i18n.t('inbox.line.orderState.confirmed'));
    expect(bubbles[3].textContent).toContain('40.00 ر.س');
    expect(bubbles[4].textContent).toBe('Plain text');
  });

  it('snapshot: every label is localised, prompts are mapped, last campaign kind is key-mapped, language is editable', async () => {
    const el = await create('ar');
    await openFirst(el);
    const snap = el.querySelector('app-loc-snapshot-pane') as HTMLElement;
    for (const key of ['inbox.snap.consent', 'inbox.snap.loyalty', 'inbox.snap.totalOrders', 'inbox.snap.totalSpend', 'inbox.snap.lastOrder',
      'inbox.snap.lastPayment', 'inbox.snap.lastCampaign', 'inbox.snap.firstInteraction', 'inbox.snap.products', 'inbox.snap.services']) {
      expect(snap.textContent).toContain(i18n.t(key));
    }
    expect(snap.textContent).toContain('150.00 ر.س');
    expect(snap.textContent).toContain(i18n.t('inbox.campaign.kind.loyalty_reminder')); // not "Loyalty_reminder"
    expect(snap.textContent).toContain(i18n.t('status.payment.paid'));
    expect(snap.textContent).toContain(i18n.t('status.booking.no_show'));
    expect(snap.textContent).toContain(i18n.tp('inbox.prompt.noOrder', 40));
    expect(snap.textContent).toContain(i18n.tp('inbox.prompt.points', 3));
    expect(snap.textContent).toContain('Something new from the server.');
    expect(snap.querySelector('.sp-prompt')?.textContent).toContain('💡');
    expect(snap.querySelector('.sp-section .sp-strong')?.getAttribute('dir')).toBe('auto');

    const select = snap.querySelector('select') as HTMLSelectElement;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    flush();
    expect(loc['setCustomerLanguage']).toHaveBeenCalledWith('c1', 'en');
  });

  it('translate shows a labelled AI draft beneath an inbound message and never sends anything', async () => {
    const el = await create('en');
    await openFirst(el);
    const link = el.querySelector('.mb-link') as HTMLButtonElement;
    link.click();
    flush();
    expect(loc['aiTranslateInbound']).toHaveBeenCalledWith(ARABIC_TEXT);
    const box = el.querySelector('.mb-translation') as HTMLElement;
    expect(box.textContent).toContain('AI translation (draft)');
    expect(box.textContent).toContain('Hello, do you have Order #123 in stock?');
    expect(inbox['sendMessage']).not.toHaveBeenCalled();
    // collapsible: second click hides the translation without calling the API again
    (el.querySelector('.mb-link') as HTMLButtonElement).click();
    flush();
    expect(el.querySelector('.mb-translation')).toBeNull();
    expect(loc['aiTranslateInbound']).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('.mb-link').length).toBe(1); // only the inbound message has Translate
  });

  it('shows a localised error when translate fails', async () => {
    loc['aiTranslateInbound'].mockReturnValueOnce(throwError(() => ({ status: 503, error: { code: 'AI_UNAVAILABLE' } })));
    const el = await create('ar');
    await openFirst(el);
    (el.querySelector('.mb-link') as HTMLButtonElement).click();
    flush();
    expect(el.querySelector('.mb-note')?.textContent).toContain(i18n.t('errors.AI_UNAVAILABLE'));
  });

  it('reply in Arabic only drafts; nothing is sent until the user uses the draft AND presses Send', async () => {
    const el = await create('en');
    await openFirst(el);
    const send = el.querySelector('.rc-side .btn-primary') as HTMLButtonElement;
    const reply = el.querySelector('.rc-side .btn-outline') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(reply.disabled).toBe(true);

    type(el, '.rc-box', 'We ship tomorrow');
    expect(send.disabled).toBe(false);
    reply.click();
    flush();
    expect(loc['aiReplyInArabic']).toHaveBeenCalledWith({ englishText: 'We ship tomorrow', customerMessage: ARABIC_TEXT, customerName: 'سارة العتيبي' });
    expect(inbox['sendMessage']).not.toHaveBeenCalled();
    const draft = el.querySelector('.rc-draft') as HTMLElement;
    expect(draft.textContent).toContain('AI-suggested');
    expect((draft.querySelector('textarea') as HTMLTextAreaElement).value).toBe('سنشحن طلبك غداً إن شاء الله');

    (el.querySelector('.rc-draft .btn-primary') as HTMLButtonElement).click(); // "Use in message box"
    flush();
    expect(el.querySelector('.rc-draft')).toBeNull();
    expect((el.querySelector('.rc-box') as HTMLTextAreaElement).value).toBe('سنشحن طلبك غداً إن شاء الله');
    expect(inbox['sendMessage']).not.toHaveBeenCalled();

    (el.querySelector('.rc-side .btn-primary') as HTMLButtonElement).click();
    flush();
    expect(inbox['sendMessage']).toHaveBeenCalledTimes(1);
    expect(inbox['sendMessage']).toHaveBeenCalledWith('c1', 'سنشحن طلبك غداً إن شاء الله');
    expect((el.querySelector('.rc-box') as HTMLTextAreaElement).value).toBe('');
  });

  it('discarding the Arabic draft sends nothing; a failed send shows a localised inline error', async () => {
    const el = await create('ar');
    await openFirst(el);
    type(el, '.rc-box', 'We ship tomorrow');
    (el.querySelector('.rc-side .btn-outline') as HTMLButtonElement).click();
    flush();
    (el.querySelector('.rc-draft .btn-outline') as HTMLButtonElement).click(); // discard
    flush();
    expect(el.querySelector('.rc-draft')).toBeNull();
    expect(inbox['sendMessage']).not.toHaveBeenCalled();

    inbox['sendMessage'].mockReturnValueOnce(throwError(() => ({ status: 500, error: { error: 'boom' } })));
    (el.querySelector('.rc-side .btn-primary') as HTMLButtonElement).click();
    flush();
    expect(el.querySelector('.rc-note')?.textContent).toContain(i18n.t('inbox.composer.sendFailed'));
    expect((el.querySelector('.rc-box') as HTMLTextAreaElement).value).toBe('We ship tomorrow'); // kept for retry
  });

  it('Enter sends, Shift+Enter does not', async () => {
    const el = await create('en');
    await openFirst(el);
    type(el, '.rc-box', 'Hi');
    const box = el.querySelector('.rc-box') as HTMLTextAreaElement;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(inbox['sendMessage']).not.toHaveBeenCalled();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(inbox['sendMessage']).toHaveBeenCalledWith('c1', 'Hi');
  });

  it('send offer fills the composer in the customer language (draft only)', async () => {
    const el = await create('en');
    await openFirst(el);
    button(el, '.qa-bar', 'inbox.qa.offer').click();
    flush();
    expect((el.querySelector('.rc-box') as HTMLTextAreaElement).value).toBe(i18n.t('inbox.offer.draft', undefined, 'ar'));
    expect(inbox['sendMessage']).not.toHaveBeenCalled();
  });

  it('payment link: accepts Arabic-Indic digits, calls the localised endpoint, and reports errors in the modal', async () => {
    const el = await create('ar');
    await openFirst(el);
    button(el, '.qa-bar', 'inbox.qa.payment').click();
    flush();
    type(el, '#inbox-pay-amount', '٥٠٫٥');
    el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
    flush();
    expect(loc['sendLocalizedPaymentLink']).toHaveBeenCalledWith('c1', 50.5);
    expect(el.querySelector('.modal')).toBeNull();
    expect(ui.toasts().some((t) => t.message === i18n.t('inbox.pay.sent'))).toBe(true);

    loc['sendLocalizedPaymentLink'].mockReturnValueOnce(throwError(() => ({ status: 503, error: { code: 'STRIPE_UNAVAILABLE' } })));
    button(el, '.qa-bar', 'inbox.qa.payment').click();
    flush();
    type(el, '#inbox-pay-amount', '10');
    el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
    flush();
    expect(el.querySelector('.modal .loc-error')?.textContent).toContain(i18n.t('errors.STRIPE_UNAVAILABLE'));

    type(el, '#inbox-pay-amount', 'abc');
    el.querySelector('.modal form')!.dispatchEvent(new Event('submit'));
    flush();
    expect(el.querySelector('.modal .loc-error')?.textContent).toContain(i18n.t('inbox.pay.invalid'));
    expect(loc['sendLocalizedPaymentLink']).toHaveBeenCalledTimes(2);
  });

  it('a language lookup still in flight when the thread is closed does not repopulate it', async () => {
    const pending = new Subject<unknown>();
    loc['getInboxContext'].mockReturnValue(pending);
    const el = await create('en');
    await openFirst(el);
    (el.querySelector('.tp-back') as HTMLButtonElement).click();
    flush();
    pending.next({ customerId: 'c1', language: 'ar', languageSource: 'manual', effectiveLanguage: 'ar' });
    pending.complete();
    flush();
    expect(fixture.componentInstance.context()).toBeNull();
  });

  it('loyalty reminder is only sent after the merchant confirms; declining sends nothing', async () => {
    const el = await create('en');
    await openFirst(el);
    button(el, '.qa-bar', 'inbox.qa.loyalty').click();
    flush();
    expect(ui.confirmState()?.confirmLabel).toBe(i18n.t('inbox.loyalty.confirm'));
    expect(loc['sendLocalizedLoyaltyReminder']).not.toHaveBeenCalled();
    ui.respond(false);
    await new Promise((r) => setTimeout(r));
    flush();
    expect(loc['sendLocalizedLoyaltyReminder']).not.toHaveBeenCalled();
    expect(button(el, '.qa-bar', 'inbox.qa.loyalty').disabled).toBe(false); // not stuck busy
  });

  it('loyalty reminder without an approved variant offers the English version only after confirmation', async () => {
    const el = await create('ar');
    await openFirst(el);
    const click = async () => {
      button(el, '.qa-bar', 'inbox.qa.loyalty').click();
      flush();
      ui.respond(true); // the first confirmation: send in the customer's language
      await new Promise((r) => setTimeout(r));
      flush();
    };

    await click();
    expect(loc['sendLocalizedLoyaltyReminder']).toHaveBeenCalledWith('c1');
    expect(ui.confirmState()?.confirmLabel).toBe(i18n.t('inbox.loyalty.fallbackConfirm'));
    expect(inbox['sendLoyaltyReminder']).not.toHaveBeenCalled();
    ui.respond(false); // declined
    await Promise.resolve();
    expect(inbox['sendLoyaltyReminder']).not.toHaveBeenCalled();

    await click();
    ui.respond(true); // confirmed
    await new Promise((r) => setTimeout(r));
    expect(inbox['sendLoyaltyReminder']).toHaveBeenCalledWith('c1');
    expect(ui.toasts().some((t) => t.message === i18n.t('inbox.loyalty.fallbackSent'))).toBe(true);
  });

  it('loyalty reminder: no_consent is explained, a normal send does not touch the English endpoint', async () => {
    const el = await create('en');
    await openFirst(el);
    const sendConfirmed = async () => {
      button(el, '.qa-bar', 'inbox.qa.loyalty').click();
      flush();
      ui.respond(true);
      await new Promise((r) => setTimeout(r));
      flush();
    };
    loc['sendLocalizedLoyaltyReminder'].mockReturnValueOnce(of({ sent: false, reason: 'no_consent', fallbackAvailable: false }));
    await sendConfirmed();
    expect(ui.toasts().some((t) => t.message === i18n.t('inbox.loyalty.noConsent'))).toBe(true);
    expect(ui.confirmState()).toBeNull();

    loc['sendLocalizedLoyaltyReminder'].mockReturnValueOnce(of({ sent: true }));
    await sendConfirmed();
    expect(ui.toasts().some((t) => t.message === i18n.t('inbox.loyalty.sent'))).toBe(true);
    expect(inbox['sendLoyaltyReminder']).not.toHaveBeenCalled();
  });

  it('opted-out customers cannot be sent offers or loyalty reminders from the quick actions', async () => {
    loc['getInboxContext'].mockImplementation((id: string) => of({ customerId: id, language: 'unknown', languageSource: null, effectiveLanguage: 'en' }));
    inbox['getThread'].mockImplementation(() => of({ customer: { _id: 'c2', name: 'John Smith', phone: '+14155550123', optedOut: true }, messages: [] }));
    const el = await create('en');
    (el.querySelectorAll('.cl-row')[1] as HTMLButtonElement).click();
    flush();
    expect(button(el, '.qa-bar', 'inbox.qa.offer').disabled).toBe(true);
    expect(button(el, '.qa-bar', 'inbox.qa.loyalty').disabled).toBe(true);
    expect(button(el, '.qa-bar', 'inbox.qa.payment').disabled).toBe(false);
  });

  it('polls the list every 20 s, pauses while the tab is hidden and stops on destroy', async () => {
    vi.useFakeTimers();
    await create('en');
    const calls = () => loc['searchConversations'].mock.calls.length;
    expect(calls()).toBe(1);
    vi.advanceTimersByTime(20000);
    expect(calls()).toBe(2);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    vi.advanceTimersByTime(60000);
    expect(calls()).toBe(2); // paused
    hidden.mockReturnValue(false);
    vi.advanceTimersByTime(20000);
    expect(calls()).toBe(3);

    fixture.destroy();
    vi.advanceTimersByTime(60000);
    expect(calls()).toBe(3);
  });

  it('keeps the list on screen when a background refresh fails', async () => {
    vi.useFakeTimers();
    const el = await create('en');
    loc['searchConversations'].mockReturnValue(throwError(() => ({ status: 0 })));
    vi.advanceTimersByTime(20000);
    flush();
    expect(el.querySelectorAll('.cl-row').length).toBe(2);
    expect(el.querySelector('.cl-rows .loc-error')).toBeNull();
  });
});

describe('InboxLabels', () => {
  let labels: InboxLabels;
  let i18n: I18nService;

  async function setup(lang: 'en' | 'ar'): Promise<void> {
    TestBed.configureTestingModule({});
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    await i18n.use(lang, false);
    labels = TestBed.inject(InboxLabels);
  }

  it('maps statuses by (messageType,status) and normalises no-show', async () => {
    await setup('ar');
    expect(labels.status('booking', 'no-show').label).toBe(i18n.t('status.booking.no_show'));
    expect(labels.status('booking', 'sent')).toMatchObject({ kind: 'tick', icon: '✓' }); // booking notification delivery
    expect(labels.status('order', 'delivered')).toMatchObject({ kind: 'label' });
    expect(labels.status('manual', 'delivered')).toMatchObject({ kind: 'tick', icon: '✓✓' });
    expect(labels.status('payment', 'paid').label).toBe(i18n.t('status.payment.paid'));
    expect(labels.status('payment', 'read')).toMatchObject({ kind: 'tick', read: true });
    expect(labels.status('manual', 'failed')).toMatchObject({ failed: true });
    expect(labels.status('manual', 'brand_new').label).toBe('brand_new');
    expect(labels.status('manual', undefined).kind).toBe('none');
    expect(normalizeStatus('No-Show')).toBe('no_show');
  });

  it('localises the closed set of backend English lines and falls back to the raw text', async () => {
    await setup('ar');
    expect(labels.line('📣 Promotion sent')).toBe(i18n.t('inbox.line.promotionSent'));
    expect(labels.line('📣 Promotion — Summer sale')).toContain('Summer sale');
    expect(labels.line('↩️ Button tap')).toContain(i18n.t('inbox.line.buttonTap'));
    expect(labels.line('↩️ نعم أوافق')).toContain('نعم أوافق');
    expect(labels.line('[Button tap]')).toBe(i18n.t('inbox.line.buttonTap'));
    expect(labels.line('📷 Photo')).toBe(i18n.t('inbox.line.photo'));
    expect(labels.line('📄 invoice.pdf')).toBe('📄 invoice.pdf');
    expect(labels.line('🛍️ Order placed — 1 item(s)')).toContain(i18n.t('inbox.line.items_one'));
    expect(labels.line('💳 Payment paid — 40.00 SAR')).toContain('40.00 ر.س');
    expect(labels.line('📅 Booking confirmed')).toContain(i18n.t('status.booking.confirmed'));
    expect(labels.line('Just a customer message')).toBe('Just a customer message');
    expect(labels.line(null)).toBe('');
  });

  it('maps tags, campaign kinds and prompts, with raw fallbacks', async () => {
    await setup('en');
    expect(labels.tag('Loyalty member')).toBe('Loyalty member');
    expect(labels.tag('VIP')).toBe('VIP');
    expect(labels.tagClass('VIP')).toBe('badge-neutral');
    expect(labels.campaignKind('loyalty_reminder')).toBe('Loyalty reminder');
    expect(labels.campaignKind('promotion', 'Eid sale')).toBe('Eid sale');
    expect(labels.campaignKind('mystery_kind')).toBe('mystery kind');
    expect(labels.prompt('This customer has not ordered in 1 days.')).toBe('This customer has not ordered in 1 day.');
    expect(labels.prompt('Anything else')).toBe('Anything else');
    expect(labels.messageType('manual')).toBe('');
    expect(labels.messageType('mystery')).toBe('mystery');
  });

  it('parses amounts typed with Western or Arabic-Indic digits', () => {
    expect(parseAmount('50')).toBe(50);
    expect(parseAmount('٥٠٫٢٥')).toBe(50.25);
    expect(parseAmount('۱۲۰')).toBe(120);
    expect(parseAmount('1,200.50')).toBe(1200.5);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});
