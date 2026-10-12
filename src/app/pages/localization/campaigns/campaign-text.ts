import { I18nService } from '../../../i18n';
import type {
  AudienceSpec, CampaignPlan, CampaignStatus, LanguageMode, MessageLanguage, SegmentKey, SendStatus,
} from '../localization.types';

// Pure helpers shared by the campaign list, composer and detail pages: reason /
// warning / send-error code -> localised sentences, status -> badge class, and
// the audience payload checks. Unknown codes always degrade to a generic line.

export const MAX_CUSTOMER_IDS = 2000;
export const LARGE_AUDIENCE_HINT = 250;

const REASON_SUFFIXES = new Set([
  'missing', 'not_submitted', 'pending', 'rejected', 'paused', 'disabled', 'flagged', 'not_approved', 'not_reviewed',
]);
const WARNING_CODES = new Set([
  'template_archived', 'category_changed', 'category_floored', 'marketing_variant_missing_opt_out', 'audience_ids_not_found',
  'duplicate_phones_skipped', 'consent_request_skipped', 'large_audience',
]);
const COUNT_WARNINGS = new Set(['audience_ids_not_found', 'duplicate_phones_skipped', 'large_audience']);
// Meta error codes, plus our own reason for a recipient skipped because another customer record with the same phone opted out.
const SEND_ERROR_CODES = new Set([
  '132001', '132015', '132016', '132000', '132012', '132018', '131049', '131050', '131047', '131026', 'opted_out_same_phone',
]);
// A campaign stops with `template_unusable:<WhatsApp code>` after three template-level errors in a row.
const TEMPLATE_UNUSABLE = /^template_unusable:([\w.-]{1,20})$/;
const LANGS = new Set<string>(['en', 'ar', 'bilingual']);

// "English" / "Arabic" / "Bilingual" in the adjective form used inside sentences ("the Arabic version").
export function langAdj(i18n: I18nService, lang: string | null | undefined): string {
  return lang && LANGS.has(lang) ? i18n.t(`campaigns.langAdj.${lang}`) : (lang ?? '');
}

export function customersText(i18n: I18nService, count: number): string {
  return i18n.tp('campaigns.n.customer', count);
}

// Reason codes come from the server as `<language>_<reason>` ("ar_pending"), a bare reason in the
// variants table ("pending") or "no_usable_variant". Anything else is shown generically.
export function reasonText(i18n: I18nService, code: string | null | undefined, rowLanguage?: string): string {
  if (!code) return i18n.t('campaigns.reason.unknown');
  if (code === 'no_usable_variant') return i18n.t('campaigns.reason.no_usable_variant');
  const m = /^(en|ar|bilingual)_(.+)$/.exec(code);
  const language = m ? m[1] : rowLanguage;
  const suffix = m ? m[2] : code;
  if (REASON_SUFFIXES.has(suffix)) {
    return i18n.t(`campaigns.reason.${suffix}`, { language: langAdj(i18n, language) });
  }
  return i18n.t('campaigns.reason.unknown');
}

export function fallbackLine(i18n: I18nService, f: CampaignPlan['fallbacks'][number]): string {
  return i18n.t('campaigns.fallback', {
    customers: customersText(i18n, f.count),
    language: langAdj(i18n, f.to),
    reason: reasonText(i18n, f.reason, f.from),
  });
}

export function blockedLine(i18n: I18nService, b: CampaignPlan['blocked'][number]): string {
  return i18n.t('campaigns.blocked', { customers: customersText(i18n, b.count), reason: reasonText(i18n, b.reason) });
}

export function warningLine(i18n: I18nService, w: CampaignPlan['warnings'][number]): string {
  const code = w.code;
  if (!WARNING_CODES.has(code)) return i18n.t('campaigns.warning.unknown');
  const detail = w.detail ?? {};
  const params: Record<string, string | number> = { ...detail };
  if (typeof detail['language'] === 'string') params['language'] = langAdj(i18n, detail['language']);
  for (const k of ['from', 'to']) {
    const v = detail[k];
    if (typeof v === 'string' && (v === 'MARKETING' || v === 'UTILITY')) params[k] = i18n.t(`campaigns.category.${v}`);
  }
  if (COUNT_WARNINGS.has(code)) params['customers'] = customersText(i18n, Number(detail['count'] ?? 0));
  return i18n.t(`campaigns.warning.${code}`, params);
}

export function sendErrorText(i18n: I18nService, code: string | null | undefined): string {
  return code && SEND_ERROR_CODES.has(code) ? i18n.t(`campaigns.sendError.${code}`) : i18n.t('campaigns.sendError.generic');
}

// Readable sentence for a campaign's lastError, or null when it is not a known one (the page then shows the raw text).
export function lastErrorText(i18n: I18nService, lastError: string | null | undefined): string | null {
  const match = lastError ? TEMPLATE_UNUSABLE.exec(lastError.trim()) : null;
  return match ? i18n.t('campaigns.detail.templateUnusable', { code: match[1] }) : null;
}

export function plannedRecipients(plan: CampaignPlan): number {
  return plan.byLanguage.en + plan.byLanguage.ar + plan.byLanguage.bilingual;
}

export function skippedTotal(plan: CampaignPlan): number {
  const s = plan.skipped;
  return s.noConsent + s.optedOut + s.demo + s.invalidPhone;
}

// "Send to 214 customers: 150 in Arabic, 64 in English. 12 will be skipped."
export function sendSummary(i18n: I18nService, plan: CampaignPlan): string {
  const total = plannedRecipients(plan);
  const parts: string[] = [];
  for (const lang of ['ar', 'en', 'bilingual'] as const) {
    const n = plan.byLanguage[lang];
    if (n > 0) parts.push(i18n.t(`campaigns.confirm.part.${lang}`, { count: n }));
  }
  let text = i18n.t('campaigns.confirm.summary', {
    customers: customersText(i18n, total),
    parts: parts.join(i18n.t('campaigns.listSeparator')),
  });
  const skipped = skippedTotal(plan);
  if (skipped > 0) text += ' ' + i18n.t('campaigns.confirm.skipped', { customers: customersText(i18n, skipped) });
  return text;
}

export function campaignBadge(status: CampaignStatus): string {
  switch (status) {
    case 'sending': return 'badge-info';
    case 'sent': return 'badge-success';
    case 'partial': return 'badge-warning';
    case 'failed': return 'badge-danger';
    default: return 'badge-neutral'; // draft, cancelled
  }
}

export function sendBadge(status: SendStatus): string {
  if (status === 'sent') return 'badge-success';
  if (status === 'failed') return 'badge-danger';
  if (status === 'queued' || status === 'sending') return 'badge-info';
  return 'badge-neutral'; // skipped_*
}

export function deliveryBadge(status: string): string {
  if (status === 'read') return 'badge-success';
  if (status === 'delivered') return 'badge-info';
  if (status === 'failed') return 'badge-danger';
  return 'badge-neutral';
}

export function isHttpsLink(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export interface SegmentInput { key: SegmentKey | ''; language: 'en' | 'ar' | 'unknown'; days: number | null; minPoints: number | null }

// null = the audience is not complete yet (no plan can be requested).
export function buildAudience(
  kind: AudienceSpec['kind'], customerIds: readonly string[], seg: SegmentInput,
): AudienceSpec | null {
  if (kind === 'all_eligible') return { kind };
  if (kind === 'customer_ids') {
    return customerIds.length > 0 && customerIds.length <= MAX_CUSTOMER_IDS ? { kind, customerIds: [...customerIds] } : null;
  }
  if (!seg.key) return null;
  switch (seg.key) {
    case 'language': return { kind, segmentKey: 'language', segmentParams: { language: seg.language } };
    case 'inactive_days':
      return seg.days && seg.days >= 1 ? { kind, segmentKey: 'inactive_days', segmentParams: { days: seg.days } } : null;
    case 'has_points':
      return seg.minPoints && seg.minPoints >= 1 ? { kind, segmentKey: 'has_points', segmentParams: { minPoints: seg.minPoints } } : null;
    default: return { kind, segmentKey: seg.key };
  }
}

export function audienceLabel(i18n: I18nService, a: AudienceSpec): string {
  if (a.kind === 'all_eligible') return i18n.t('campaigns.audience.all_eligible');
  if (a.kind === 'customer_ids') return i18n.t('campaigns.audience.pickedN', { customers: customersText(i18n, a.customerIds?.length ?? 0) });
  const key = a.segmentKey ?? 'language';
  const p = a.segmentParams ?? {};
  const value = key === 'language' ? i18n.t(`status.language.${p.language ?? 'unknown'}`) : String(p.days ?? p.minPoints ?? '');
  const segment = i18n.t(`campaigns.segment.${key}`);
  return value ? i18n.t('campaigns.audience.segmentLine', { segment, value }) : segment;
}

export function modeLabel(i18n: I18nService, mode: LanguageMode): string {
  return i18n.t(`campaigns.mode.${mode}`);
}

export function isMessageLanguage(v: string | null | undefined): v is MessageLanguage {
  return v === 'en' || v === 'ar' || v === 'bilingual';
}
