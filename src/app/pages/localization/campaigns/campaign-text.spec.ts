import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../../i18n';
import { MAX_CUSTOMER_IDS, buildAudience, isHttpsLink, lastErrorText, reasonText, sendErrorText, warningLine } from './campaign-text';

const NONE = { key: '' as const, language: 'ar' as const, days: null, minPoints: null };

describe('campaign-text helpers', () => {
  let i18n: I18nService;

  beforeEach(async () => {
    localStorage.clear();
    i18n = TestBed.inject(I18nService);
    await i18n.init();
  });

  it('maps <language>_<reason> codes, bare reasons and unknown codes', () => {
    expect(reasonText(i18n, 'ar_not_reviewed')).toBe('the Arabic version hasn\'t been marked as reviewed by a native speaker yet');
    expect(reasonText(i18n, 'bilingual_pending')).toBe('the bilingual version is still waiting for WhatsApp approval');
    expect(reasonText(i18n, 'rejected', 'en')).toBe('WhatsApp rejected the English version');
    expect(reasonText(i18n, 'no_usable_variant')).toBe('no approved version of this template can be used for them');
    expect(reasonText(i18n, 'ar_something_new')).toBe(i18n.t('campaigns.reason.unknown'));
    expect(reasonText(i18n, null)).toBe(i18n.t('campaigns.reason.unknown'));
  });

  it('gives every known Meta send error a plain sentence and a generic fallback', () => {
    for (const code of ['132001', '132015', '132016', '132000', '132012', '132018', '131049', '131050', '131047', '131026', 'opted_out_same_phone']) {
      expect(sendErrorText(i18n, code)).not.toContain('campaigns.sendError');
      expect(sendErrorText(i18n, code)).not.toBe(i18n.t('campaigns.sendError.generic'));
    }
    expect(sendErrorText(i18n, '1')).toBe('The message couldn\'t be sent.');
    expect(sendErrorText(i18n, null)).toBe('The message couldn\'t be sent.');
  });

  it('explains a recipient skipped because another record with the same phone number opted out, in both languages', async () => {
    expect(sendErrorText(i18n, 'opted_out_same_phone')).toBe('Skipped: another contact with this phone number opted out.');
    await i18n.use('ar', false);
    expect(sendErrorText(i18n, 'opted_out_same_phone')).toBe('تم التخطي: ألغى عميل آخر لديه رقم الهاتف نفسه اشتراكه.');
  });

  it('describes warnings, including category_changed and unknown codes', () => {
    expect(warningLine(i18n, { code: 'category_changed', detail: { from: 'UTILITY', to: 'MARKETING', language: 'ar' } }))
      .toContain('changed the Arabic version from "Utility message" to "Marketing message"');
    expect(warningLine(i18n, { code: 'large_audience', detail: { count: 1 } })).toContain('1 customer.');
    expect(warningLine(i18n, { code: 'whatever' })).toBe(i18n.t('campaigns.warning.unknown'));
  });

  it('describes the category_floored warning without needing its use case, in both languages', async () => {
    const warning = { code: 'category_floored', detail: { useCase: 'comeback' } };
    expect(warningLine(i18n, warning)).toBe('This message type is always sent as Marketing, so only customers who opted in will receive it.');
    expect(warningLine(i18n, { code: 'category_floored' })).toBe(warningLine(i18n, warning));
    await i18n.use('ar', false);
    expect(warningLine(i18n, warning)).toBe('يُرسل هذا النوع من الرسائل دائماً كرسالة تسويقية، لذلك لن يستلمه إلا العملاء الذين وافقوا على استلام الرسائل.');
    expect(warningLine(i18n, warning)).not.toBe(i18n.t('campaigns.warning.unknown'));
  });

  it('turns a template_unusable:<code> campaign error into a sentence with the parsed code and leaves other errors alone', async () => {
    expect(lastErrorText(i18n, 'template_unusable:132001'))
      .toBe('Sending stopped: WhatsApp rejected this template (code 132001). The remaining recipients were not messaged.');
    expect(lastErrorText(i18n, 'template_unusable:132015')).toContain('(code 132015)');
    expect(lastErrorText(i18n, ' template_unusable:132012 ')).toContain('(code 132012)');
    for (const other of ['template_unusable:', 'template_unusable:12 3', 'template_unusable:<b>', 'send_failed', 'Boom', '', null, undefined]) {
      expect(lastErrorText(i18n, other)).toBeNull();
    }
    await i18n.use('ar', false);
    const arabic = lastErrorText(i18n, 'template_unusable:132001') ?? '';
    expect(arabic).toContain('توقف الإرسال: رفض واتساب هذا القالب (رمز الخطأ');
    expect(arabic).toContain('132001');
    expect(arabic).toContain('لم تُرسل الرسالة إلى بقية المستلمين.');
  });

  it('builds audiences only when they are complete and within the 2000-id cap', () => {
    expect(buildAudience('all_eligible', [], NONE)).toEqual({ kind: 'all_eligible' });
    expect(buildAudience('customer_ids', [], NONE)).toBeNull();
    expect(buildAudience('customer_ids', ['a'], NONE)).toEqual({ kind: 'customer_ids', customerIds: ['a'] });
    const tooMany = Array.from({ length: MAX_CUSTOMER_IDS + 1 }, (_, i) => String(i));
    expect(buildAudience('customer_ids', tooMany, NONE)).toBeNull();
    expect(buildAudience('segment', [], NONE)).toBeNull();
    expect(buildAudience('segment', [], { ...NONE, key: 'inactive_days' })).toBeNull();
    expect(buildAudience('segment', [], { ...NONE, key: 'inactive_days', days: 30 })).toEqual({ kind: 'segment', segmentKey: 'inactive_days', segmentParams: { days: 30 } });
    expect(buildAudience('segment', [], { ...NONE, key: 'awaiting_consent' })).toEqual({ kind: 'segment', segmentKey: 'awaiting_consent' });
  });

  it('accepts only https links', () => {
    expect(isHttpsLink('https://waflowtech.com/a')).toBe(true);
    expect(isHttpsLink('http://waflowtech.com')).toBe(false);
    expect(isHttpsLink('javascript:alert(1)')).toBe(false);
    expect(isHttpsLink('https://')).toBe(false);
    expect(isHttpsLink('waflowtech.com')).toBe(false);
  });
});
