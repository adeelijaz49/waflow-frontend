import type { PlanWarning, PromotionSendPlan, SenderSendPlan } from '../localization.types';

type AnyPlan = PromotionSendPlan | SenderSendPlan;

export interface PlanCounts {
  ar: number;
  fallback: number;
  en: number;
  notMessaged: number;
}

const sum = (rows: Array<{ count: number }> | undefined): number =>
  (rows ?? []).reduce((n, r) => n + (Number.isFinite(r.count) ? r.count : 0), 0);

// The backend reports a customer who is blocked because another record with the same phone opted out TWICE:
// in skipped.optedOutSamePhone and as the blocked row 'opted_out_same_phone'. Only what the blocked rows do
// not already cover is counted here, so one customer is never counted twice.
export function samePhoneNotInBlocked(plan: AnyPlan): number {
  const blocked = (plan.blocked ?? []).filter((b) => b.reason === 'opted_out_same_phone');
  return Math.max(0, (plan.skipped?.optedOutSamePhone ?? 0) - sum(blocked));
}

export function skippedTotal(plan: AnyPlan): number {
  const s = plan.skipped;
  return (s?.noConsent ?? 0) + (s?.optedOut ?? 0) + (s?.demoSimulated ?? 0) + samePhoneNotInBlocked(plan);
}

// What each selected customer receives. byLanguage.en INCLUDES the customers who get English instead of
// Arabic (the fallbacks), so the plain-English count is derived (never negative: defensive against a
// backend that counts them separately).
export function planCounts(plan: AnyPlan): PlanCounts {
  const fallback = sum(plan.fallbacks);
  return {
    ar: plan.byLanguage?.ar ?? 0,
    fallback,
    en: Math.max(0, (plan.byLanguage?.en ?? 0) - fallback),
    notMessaged: skippedTotal(plan) + sum(plan.blocked),
  };
}

// "field_values_missing:date" -> { code: 'field_values_missing', field: 'date' }.
export function splitReason(reason: string): { code: string; field: string } {
  const i = reason.indexOf(':');
  return i < 0 ? { code: reason, field: '' } : { code: reason.slice(0, i), field: reason.slice(i + 1) };
}

export const KNOWN_FALLBACK_REASONS: readonly string[] = [
  'no_arabic_version', 'not_submitted', 'pending', 'rejected', 'paused', 'disabled', 'flagged', 'not_approved',
  'not_reviewed', 'no_opt_out_button', 'buttons_mismatch', 'field_values_missing', 'template_unusable', 'opted_out_same_phone',
];
export const KNOWN_BLOCKED_REASONS: readonly string[] = ['opted_out_same_phone', 'template_unusable'];
export const KNOWN_WARNINGS: readonly string[] = [
  'carousel_english_only', 'large_audience', 'duplicate_phones_in_selection', 'category_floored',
  'marketing_variant_missing_opt_out',
];

// Warnings shown as notes. 'arabic_fallback' repeats the fallback lines, so it is not shown; unknown codes
// are ignored.
export function knownWarnings(warnings: PlanWarning[] | undefined): PlanWarning[] {
  return (warnings ?? []).filter((w) => KNOWN_WARNINGS.includes(w.code));
}
