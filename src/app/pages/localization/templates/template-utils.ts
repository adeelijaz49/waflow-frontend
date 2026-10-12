import type {
  BilingualOrder, ButtonRole, MessageLanguage, TemplateButton, TemplateCategory, TemplateUseCase, TemplateVariant, ValidationIssue,
  VariantInput, VariantSource,
} from '../localization.types';

// Pure helpers shared by the Templates list and editor (no Angular, easy to unit-test).

export interface VariantForm {
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  bilingualOrder: BilingualOrder;
}

export const EMPTY_FORM: VariantForm = { header: '', body: '', footer: '', buttons: [], bilingualOrder: 'ar_first' };

export const LANGUAGES: readonly MessageLanguage[] = ['en', 'ar', 'bilingual'];
export const ROLE_OPTIONS: readonly ButtonRole[] = ['opt_out', 'opt_in', 'decline', 'url'];
export const QUICK_ROLES: ReadonlySet<ButtonRole> = new Set<ButtonRole>(['opt_out', 'opt_in', 'decline']);

// Issue codes WhatsApp rejects outright. The backend may still report some of them as warnings, but
// the editor always treats them as blocking.
const BLOCKING_CODES = new Set(['body_starts_with_variable', 'body_ends_with_variable']);

export function formOf(variant: TemplateVariant | null | undefined, defaultOrder: BilingualOrder = 'ar_first'): VariantForm {
  if (!variant) return { ...EMPTY_FORM, buttons: [], bilingualOrder: defaultOrder };
  return {
    header: variant.header ?? '',
    body: variant.body ?? '',
    footer: variant.footer ?? '',
    buttons: (variant.buttons ?? []).map(cleanButton),
    bilingualOrder: variant.bilingualOrder ?? defaultOrder,
  };
}

export function cleanButton(b: TemplateButton): TemplateButton {
  return b.role === 'url' ? { role: b.role, text: b.text ?? '', url: b.url ?? '' } : { role: b.role, text: b.text ?? '' };
}

export function sameForm(a: VariantForm, b: VariantForm, includeOrder: boolean): boolean {
  if (a.header !== b.header || a.body !== b.body || a.footer !== b.footer) return false;
  if (includeOrder && a.bilingualOrder !== b.bilingualOrder) return false;
  if (a.buttons.length !== b.buttons.length) return false;
  return a.buttons.every((x, i) => x.role === b.buttons[i].role && x.text === b.buttons[i].text && (x.url ?? '') === (b.buttons[i].url ?? ''));
}

export function toInput(form: VariantForm, language: MessageLanguage, source: VariantSource): VariantInput {
  const input: VariantInput = {
    header: form.header,
    body: form.body,
    footer: form.footer,
    buttons: form.buttons.map(cleanButton),
    source,
  };
  if (language === 'bilingual') input.bilingualOrder = form.bilingualOrder;
  return input;
}

// Inserts `token` over the selection [start, end) and returns the new text and caret position.
export function insertAtCaret(value: string, start: number | null, end: number | null, token: string): { value: string; caret: number } {
  const s = start === null || start < 0 || start > value.length ? value.length : start;
  const e = end === null || end < s || end > value.length ? s : end;
  return { value: value.slice(0, s) + token + value.slice(e), caret: s + token.length };
}

export function isBlockingIssue(code: string, language: MessageLanguage): boolean {
  return BLOCKING_CODES.has(code) || (language === 'ar' && code === 'arabic_variant_has_no_arabic');
}

// Splits validation results into what stops submission and what is only worth a look.
export function splitIssues(
  errors: ValidationIssue[], warnings: ValidationIssue[], language: MessageLanguage,
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const all = [...errors, ...warnings];
  const hard = all.filter((i) => errors.includes(i) || isBlockingIssue(i.code, language));
  const soft = all.filter((i) => !hard.includes(i));
  return { errors: hard, warnings: soft };
}

export function isRealRejectionReason(reason: string | null | undefined): boolean {
  const r = (reason ?? '').trim();
  return r.length > 0 && r.toUpperCase() !== 'NONE';
}

// Which statuses allow (re)submission. PENDING / APPROVED / IN_APPEAL are waiting or done;
// the rest (deleted, paused ...) are WhatsApp-side states a merchant can't fix by resubmitting.
export function canSubmitStatus(status: string): boolean {
  return status === 'NOT_CREATED' || status === 'REJECTED' || status === 'ERROR';
}

export function libraryGroupOf(useCase: string): string {
  switch (useCase) {
    case 'comeback': return 'comeback';
    case 'loyalty_reminder': case 'points_balance': case 'points_expiring': return 'loyalty';
    case 'payment_reminder': case 'order_confirmation': return 'payments';
    case 'booking_confirmation': case 'booking_reminder': return 'bookings';
    case 'referral_invite': case 'referral_reward': return 'referrals';
    case 'welcome_optin': return 'welcome';
    case 'promotion': return 'promotions';
    case 'greeting': return 'greetings';
    default: return 'other';
  }
}

export const LIBRARY_GROUP_ORDER = ['comeback', 'loyalty', 'payments', 'bookings', 'referrals', 'welcome', 'promotions', 'greetings', 'other'] as const;

export const USE_CASES: readonly TemplateUseCase[] = [
  'comeback', 'loyalty_reminder', 'points_balance', 'points_expiring', 'payment_reminder', 'booking_confirmation',
  'booking_reminder', 'order_confirmation', 'referral_invite', 'referral_reward', 'welcome_optin', 'promotion',
  'greeting', 'custom',
];

// Only these transactional use cases may be sent as UTILITY. The server stores and returns MARKETING for
// every other use case (even when UTILITY is requested), so the UI never offers a choice for them.
const TRANSACTIONAL_USE_CASES: ReadonlySet<string> = new Set<TemplateUseCase>([
  'payment_reminder', 'booking_confirmation', 'booking_reminder', 'order_confirmation',
]);

export function isTransactionalUseCase(useCase: string | null | undefined): boolean {
  return !!useCase && TRANSACTIONAL_USE_CASES.has(useCase);
}

// The category a template of this use case is really sent as (what the category <select> shows).
export function categoryFor(useCase: string | null | undefined, wanted: TemplateCategory): TemplateCategory {
  return wanted === 'UTILITY' && isTransactionalUseCase(useCase) ? 'UTILITY' : 'MARKETING';
}
