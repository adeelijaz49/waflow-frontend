import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { SettingsService } from '../../../shared/settings.service';
import type { AiModeInsight, AiModePendingAction, AiModeSession } from '../localization.types';
import { LocUiService } from '../shared/loc-ui.service';
import { AiModeAr } from './ai-mode-ar';
import { maskPhone, shortId } from './aim-helpers';

const SESSION_KEY = 'waflow_ai_mode_ar_session_id';
const EMPTY_SESSION = (id: string): AiModeSession => ({ sessionId: id, messages: [], pendingAction: null });
const notFound = () => throwError(() => ({ status: 404, error: { code: 'SESSION_NOT_FOUND' } }));

const PENDING: AiModePendingAction = {
  id: 'act-1',
  toolName: 'send_promotion',
  args: { promotionId: '64b0c0ffee64b0c0ffee1234', customerIds: ['a', 'b', 'c'] },
  summary: 'سأرسل العرض «خصم الجمعة» إلى 3 عملاء.',
  createdAt: '2026-10-01T10:00:00.000Z',
};
const REFUND: AiModePendingAction = {
  id: 'act-2', toolName: 'refund_order', args: { orderId: '64b0c0ffee64b0c0ffee9999' },
  summary: 'سأسترد مبلغ الطلب 9999.', createdAt: '2026-10-01T10:00:00.000Z',
};
const INSIGHT = (over: Partial<AiModeInsight> = {}): AiModeInsight => ({
  insightKey: 'k1', category: 'revenue', categoryLabel: 'الإيرادات', icon: '💰', title: 'عرض الجمعة كان الأفضل',
  message: 'حقق 450.00 ر.س من 12 طلباً.', metricLabel: 'الإيراد', metricValue: '450.00 ر.س',
  primaryCtaLabel: 'تشغيل مرة أخرى', primaryCta: {}, secondaryCtaLabel: null, secondaryCta: null, localized: true, ...over,
});

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    aiModeSession: vi.fn((id: string) => of(EMPTY_SESSION(id))),
    aiModeMessage: vi.fn((b: { sessionId: string; message?: string; language?: string }) => of({ sessionId: b.sessionId, reply: 'تم، لديك 12 عميلاً.', pendingAction: null, language: 'ar', usage: { inputTokens: 1, outputTokens: 1 } })),
    aiModeConfirm: vi.fn(() => of({ reply: 'تم الإرسال.', pendingAction: null })),
    aiModeInsights: vi.fn(() => of({ items: [] as AiModeInsight[] })),
    getMyPrefs: vi.fn(() => of({ uiLanguage: 'ar', aiLanguage: 'auto' })),
    updateMyPrefs: vi.fn((p: object) => of({ uiLanguage: 'ar', aiLanguage: 'auto', ...p })),
    ...over,
  };
}

async function setup(api: ReturnType<typeof fakeApi>, lang: 'en' | 'ar' = 'ar') {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      { provide: LocalizationApiService, useValue: api },
      { provide: SettingsService, useValue: { settings: of({ merchantName: 'متجر الأمل' }) } },
    ],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.use(lang, false);
  const fixture = TestBed.createComponent(AiModeAr);
  const el = fixture.nativeElement as HTMLElement;
  const flush = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  await flush();
  const ui = TestBed.inject(LocUiService);
  const type = async (text: string) => {
    const ta = el.querySelector<HTMLTextAreaElement>('#aim-input')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    await flush();
  };
  const click = async (sel: string, idx = 0) => { el.querySelectorAll<HTMLElement>(sel)[idx].click(); await flush(); };
  return { fixture, el, i18n, ui, flush, type, click, cmp: fixture.componentInstance };
}

const sendBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.aim-inputrow .btn-primary')!;

describe('AiModeAr', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders in Arabic (rtl) with real strings and the merchant greeting', async () => {
    const { el, i18n } = await setup(fakeApi());
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('وضع الذكاء الاصطناعي');
    expect(el.textContent).toContain('مرحباً متجر الأمل');
    expect(el.textContent).toContain('لا شيء يُرسَل دون تأكيدك');
    expect(el.textContent).not.toMatch(/(aimode|common|errors)\.[a-zA-Z]/);
    expect(el.querySelector('#aim-input')!.getAttribute('dir')).toBe('auto');
    expect(el.querySelectorAll('.aim-chip').length).toBe(5);
  });

  it('renders in English (ltr) without raw keys', async () => {
    const { el, i18n } = await setup(fakeApi(), 'en');
    expect(i18n.dir()).toBe('ltr');
    expect(el.textContent).toContain('AI Mode');
    expect(el.textContent).toContain('New chat');
    expect(el.textContent).toContain('Nothing is sent without your confirmation');
    expect(el.textContent).not.toMatch(/(aimode|common|errors)\.[a-zA-Z]/);
  });

  it('restores the session by the stored id and shows the pending action again', async () => {
    const api = fakeApi({
      aiModeSession: vi.fn(() => of({
        sessionId: 'x', pendingAction: PENDING,
        messages: [{ role: 'user', text: 'أرسل العرض', createdAt: 'x' }, { role: 'assistant', text: 'ملخص الإجراء', createdAt: 'x' }],
      })),
    });
    const { el, flush, cmp } = await setup(api);
    expect(api.aiModeSession).toHaveBeenCalledTimes(1);
    expect(api.aiModeSession).toHaveBeenCalledWith(cmp.sessionId());
    expect(localStorage.getItem(SESSION_KEY)).toBe(cmp.sessionId());
    await flush();
    expect(el.querySelectorAll('.aim-bubble .aim-text').length).toBe(2);
    expect(el.querySelector('app-aim-confirm-card')).not.toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('#aim-input')!.disabled).toBe(true);
  });

  it('sends with {sessionId, message, language} and shows the reply', async () => {
    const api = fakeApi();
    const { el, type, click, cmp } = await setup(api);
    await type('كم عميل عندي؟');
    expect(sendBtn(el).disabled).toBe(false);
    await click('.aim-inputrow .btn-primary');
    expect(api.aiModeMessage).toHaveBeenCalledTimes(1);
    expect(api.aiModeMessage).toHaveBeenCalledWith({ sessionId: cmp.sessionId(), message: 'كم عميل عندي؟', language: 'auto' });
    const bubbles = [...el.querySelectorAll('.aim-bubble .aim-text')].map((b) => b.textContent);
    expect(bubbles).toEqual(['كم عميل عندي؟', 'تم، لديك 12 عميلاً.']);
    expect(localStorage.getItem(SESSION_KEY)).toBe(cmp.sessionId());
  });

  it('puts dir="auto" on every bubble, including mixed Arabic/English text', async () => {
    const api = fakeApi({ aiModeMessage: vi.fn((b: { sessionId: string }) => of({ sessionId: b.sessionId, reply: 'Order #123 للعميل Ahmed تم', pendingAction: null, language: 'ar', usage: { inputTokens: 0, outputTokens: 0 } })) });
    const { el, type, click } = await setup(api);
    await type('أبغى تقرير Revenue لهذا الشهر '.repeat(20));
    await click('.aim-inputrow .btn-primary');
    const texts = [...el.querySelectorAll('.aim-bubble .aim-text')];
    expect(texts.length).toBe(2);
    expect(texts.every((t) => t.getAttribute('dir') === 'auto')).toBe(true);
  });

  it('Enter sends, Shift+Enter does not', async () => {
    const api = fakeApi();
    const { el, type, flush } = await setup(api);
    await type('سؤال');
    const ta = el.querySelector<HTMLTextAreaElement>('#aim-input')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }));
    await flush();
    expect(api.aiModeMessage).not.toHaveBeenCalled();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await flush();
    expect(api.aiModeMessage).toHaveBeenCalledTimes(1);
  });

  it('shows a localised error bubble with Retry that resends the same text', async () => {
    let fail = true;
    const api = fakeApi({
      aiModeMessage: vi.fn((b: { sessionId: string }): Observable<unknown> => fail
        ? throwError(() => ({ status: 503, error: { code: 'AI_UNAVAILABLE', error: 'English only' } }))
        : of({ sessionId: b.sessionId, reply: 'تم', pendingAction: null, language: 'ar', usage: { inputTokens: 0, outputTokens: 0 } })),
    });
    const { el, type, click, i18n } = await setup(api);
    await type('سؤال');
    await click('.aim-inputrow .btn-primary');
    const err = el.querySelector('.aim-err')!;
    expect(err.textContent).toContain(i18n.t('errors.AI_UNAVAILABLE'));
    expect(err.textContent).not.toContain('English only');
    fail = false;
    await click('.aim-err button');
    expect(api.aiModeMessage).toHaveBeenCalledTimes(2);
    expect(api.aiModeMessage.mock.calls[1][0].message).toBe('سؤال');
    expect(el.querySelector('.aim-err')).toBeNull();
    // the user bubble was not duplicated
    expect([...el.querySelectorAll('.aim-bubble .aim-text')].map((b) => b.textContent)).toEqual(['سؤال', 'تم']);
  });

  describe('confirmation gate', () => {
    const withPending = (action: AiModePendingAction) => fakeApi({
      aiModeMessage: vi.fn((b: { sessionId: string }) => of({ sessionId: b.sessionId, reply: action.summary, pendingAction: action, language: 'ar', usage: { inputTokens: 0, outputTokens: 0 } })),
    });
    const ask = async (s: Awaited<ReturnType<typeof setup>>) => { await s.type('أرسل العرض'); await s.click('.aim-inputrow .btn-primary'); };

    it('shows the card, blocks the input, and calls confirm ONLY on click', async () => {
      const api = withPending(PENDING);
      const s = await setup(api);
      await ask(s);
      const card = s.el.querySelector('app-aim-confirm-card')!;
      expect(card.textContent).toContain('تأكيد الإجراء');
      expect(card.querySelector('.aim-cc-summary')!.getAttribute('dir')).toBe('auto');
      expect(card.querySelector('.aim-cc-summary')!.textContent).toContain('خصم الجمعة');
      expect(card.textContent).toContain('إرسال عرض ترويجي');
      expect(card.textContent).toContain('3 عملاء');
      expect(card.textContent).toContain('…ee1234');
      expect(s.el.querySelector<HTMLTextAreaElement>('#aim-input')!.disabled).toBe(true);
      expect(sendBtn(s.el).disabled).toBe(true);
      expect(api.aiModeConfirm).not.toHaveBeenCalled();
      await s.click('.aim-cc-actions .btn', 0);
      expect(api.aiModeConfirm).toHaveBeenCalledTimes(1);
      expect(api.aiModeConfirm).toHaveBeenCalledWith({ sessionId: s.cmp.sessionId(), actionId: 'act-1', confirm: true });
      expect(s.el.querySelector('app-aim-confirm-card')).toBeNull();
      expect(s.el.textContent).toContain('تم الإرسال.');
      expect(s.el.querySelector<HTMLTextAreaElement>('#aim-input')!.disabled).toBe(false);
    });

    it('Cancel calls confirm with false', async () => {
      const api = withPending(PENDING);
      const s = await setup(api);
      await ask(s);
      await s.click('.aim-cc-actions .btn', 1);
      expect(api.aiModeConfirm).toHaveBeenCalledWith({ sessionId: s.cmp.sessionId(), actionId: 'act-1', confirm: false });
    });

    it('409 ACTION_NOT_PENDING removes the card and explains', async () => {
      const api = withPending(PENDING);
      api.aiModeConfirm.mockImplementation(() => throwError(() => ({ status: 409, error: { code: 'ACTION_NOT_PENDING' } })) as never);
      const s = await setup(api);
      await ask(s);
      await s.click('.aim-cc-actions .btn', 0);
      expect(s.el.querySelector('app-aim-confirm-card')).toBeNull();
      expect(s.el.querySelector('.loc-warn')!.textContent).toContain(s.i18n.t('errors.ACTION_NOT_PENDING'));
    });

    it('keeps the card after another failure so the user can try again', async () => {
      const api = withPending(PENDING);
      api.aiModeConfirm.mockImplementation(() => throwError(() => ({ status: 0, error: null })) as never);
      const s = await setup(api);
      await ask(s);
      await s.click('.aim-cc-actions .btn', 0);
      expect(s.el.querySelector('app-aim-confirm-card')).not.toBeNull();
      expect(s.el.querySelector('.aim-err')!.textContent).toContain(s.i18n.t('aimode.confirm.failed'));
    });

    it('refund is styled as dangerous and needs an extra confirmation', async () => {
      const api = withPending(REFUND);
      const s = await setup(api);
      await ask(s);
      expect(s.el.querySelector('.aim-cc-danger')).not.toBeNull();
      expect(s.el.querySelector('.aim-cc .badge-danger')).not.toBeNull();
      await s.click('.aim-cc-actions .btn', 0);
      expect(api.aiModeConfirm).not.toHaveBeenCalled();
      expect(s.ui.confirmState()?.danger).toBe(true);
      s.ui.respond(false); // user backs out of the second confirmation
      await s.flush();
      expect(api.aiModeConfirm).not.toHaveBeenCalled();
      expect(s.el.querySelector('app-aim-confirm-card')).not.toBeNull();
      await s.click('.aim-cc-actions .btn', 0);
      s.ui.respond(true);
      await s.flush();
      await s.fixture.whenStable();
      expect(api.aiModeConfirm).toHaveBeenCalledWith({ sessionId: s.cmp.sessionId(), actionId: 'act-2', confirm: true });
    });
  });

  it('a suggested prompt fills the input and never sends', async () => {
    const api = fakeApi();
    const { el, click, cmp } = await setup(api);
    await click('.aim-chip', 0);
    expect(cmp.input()).toBe('كم عميلاً عاد للشراء هذا الشهر؟');
    expect(api.aiModeMessage).not.toHaveBeenCalled();
    await click('.aim-sg-item', 0);
    expect(api.aiModeMessage).not.toHaveBeenCalled();
    expect(el.querySelectorAll('.aim-sg-group').length).toBe(4);
  });

  it('offers the Gulf-dialect examples and fills them without sending', async () => {
    const api = fakeApi();
    const { el, cmp, flush } = await setup(api);
    const items = [...el.querySelectorAll<HTMLElement>('.aim-sg-item')];
    const own = items.find((b) => b.textContent!.includes('وش أكثر عرض جاب مبيعات؟'))!;
    expect(own).toBeTruthy();
    own.click();
    await flush();
    expect(cmp.input()).toBe('وش أكثر عرض جاب مبيعات؟');
    expect(api.aiModeMessage).not.toHaveBeenCalled();
  });

  it('shows localised insights, the fallback marker for English-only cards, and fills (not sends) on click', async () => {
    const api = fakeApi({
      aiModeInsights: vi.fn(() => of({ items: [INSIGHT(), INSIGHT({ insightKey: 'k2', title: 'Low conversion', message: 'Try a new offer.', localized: false })] })),
    });
    const { el, click, cmp } = await setup(api);
    expect(api.aiModeInsights).toHaveBeenCalledWith('ar');
    const cards = el.querySelectorAll('app-aim-insight-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('تشغيل مرة أخرى');
    expect(cards[0].querySelector('.aim-ic-fallback')).toBeNull();
    expect(cards[1].querySelector('.aim-ic-fallback')!.textContent).toContain('النص بالإنجليزية');
    await click('app-aim-insight-card .aim-ic', 0);
    expect(cmp.input()).toBe('عرض الجمعة كان الأفضل. حقق 450.00 ر.س من 12 طلباً.');
    expect(api.aiModeMessage).not.toHaveBeenCalled();
  });

  it('persists the reply-language override, refetches insights, and sends it with the message', async () => {
    const api = fakeApi();
    const { el, flush, type, click } = await setup(api);
    const select = el.querySelector<HTMLSelectElement>('#aim-lang')!;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(api.updateMyPrefs).toHaveBeenCalledWith({ aiLanguage: 'en' });
    expect(api.aiModeInsights).toHaveBeenLastCalledWith('en');
    await type('How many customers?');
    await click('.aim-inputrow .btn-primary');
    expect(api.aiModeMessage.mock.calls[0][0].language).toBe('en');
  });

  it('New chat starts a fresh session id and clears the thread', async () => {
    const api = fakeApi();
    const { el, type, click, cmp } = await setup(api);
    await type('سؤال');
    await click('.aim-inputrow .btn-primary');
    const before = cmp.sessionId();
    expect(el.querySelectorAll('.aim-bubble').length).toBe(2);
    await click('.aim-controls .btn-outline');
    expect(cmp.sessionId()).not.toBe(before);
    expect(el.querySelectorAll('.aim-bubble').length).toBe(0);
    expect(localStorage.getItem(SESSION_KEY)).toBe(cmp.sessionId());
  });

  it('tolerates unavailable storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const api = fakeApi({ aiModeSession: vi.fn(() => notFound()) });
    const { el, cmp } = await setup(api);
    expect(cmp.sessionId().length).toBeGreaterThan(8);
    expect(el.querySelector('.aim-greeting')).not.toBeNull();
    expect(el.querySelector('.aim-err')).toBeNull(); // a 404 for a new session is not an error
  });

  it('shows the character counter near the 2000 limit and blocks longer input', async () => {
    const { el, type } = await setup(fakeApi());
    await type('ا'.repeat(1850));
    expect(el.querySelector('.aim-foot [dir=ltr]')!.textContent).toContain('1,850 / 2,000');
    expect(el.querySelector<HTMLTextAreaElement>('#aim-input')!.getAttribute('maxlength')).toBe('2000');
  });

  it('formats masked phones and shortened ids', () => {
    expect(maskPhone('+966501234567')).toBe('+966••••••567');
    expect(maskPhone('12345')).toBe('12345');
    expect(shortId('64b0c0ffee64b0c0ffee1234')).toBe('…ee1234');
    expect(shortId('abc')).toBe('abc');
  });
});
