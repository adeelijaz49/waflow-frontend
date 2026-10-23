import type { I18nService } from '../../i18n/i18n.service';
import { ONB_ERROR_CODES } from './onb.types';

export { ONB_ERROR_CODES } from './onb.types';

// What the UI does about an error (DF 6). The screen maps each value to a button.
export type OnbAction =
  | 'retry' | 'reloadConfig' | 'waitRetry' | 'billing' | 'portal'
  | 'goConnect' | 'goNumber' | 'goApprovals' | 'goMigrate' | 'goLanding'
  | 'reconnect' | 'legal' | 'fix' | 'resume' | 'noFacebook' | 'disconnect' | 'help' | 'none';

export const ONB_ACTIONS: readonly OnbAction[] = [
  'retry', 'reloadConfig', 'waitRetry', 'billing', 'portal', 'goConnect', 'goNumber', 'goApprovals', 'goMigrate',
  'goLanding', 'reconnect', 'legal', 'fix', 'resume', 'noFacebook', 'disconnect', 'help', 'none',
] as const;

export interface OnbErrorRow { key: string; action: OnbAction; tone: 'error' | 'warn' | 'info' }

const row = (code: string, action: OnbAction, tone: OnbErrorRow['tone'] = 'error'): OnbErrorRow => ({
  key: `onboarding.errors.${code}`, action, tone,
});

// Every code of ONB_ERROR_CODES has exactly one row (a spec asserts it). Copy lives in the catalogue, never here.
export const ONB_ERROR_TABLE: Record<string, OnbErrorRow> = {
  ONBOARDING_NOT_AVAILABLE: row('ONBOARDING_NOT_AVAILABLE', 'none', 'info'),
  SUBSCRIPTION_REQUIRED: row('SUBSCRIPTION_REQUIRED', 'billing', 'warn'),
  PAYMENT_PENDING: row('PAYMENT_PENDING', 'waitRetry', 'info'),
  PAYMENT_PAST_DUE: row('PAYMENT_PAST_DUE', 'portal', 'warn'),
  SUBSCRIPTION_CANCELLED: row('SUBSCRIPTION_CANCELLED', 'billing', 'warn'),
  WHATSAPP_NOT_CONNECTED: row('WHATSAPP_NOT_CONNECTED', 'goConnect', 'warn'),
  WHATSAPP_RECONNECT_REQUIRED: row('WHATSAPP_RECONNECT_REQUIRED', 'reconnect', 'warn'),
  SENDING_NOT_AVAILABLE_YET: row('SENDING_NOT_AVAILABLE_YET', 'help', 'info'),
  OWNER_ONLY: row('OWNER_ONLY', 'none', 'info'),
  NOT_A_MEMBER: row('NOT_A_MEMBER', 'none', 'info'),
  LEGAL_ACCEPTANCE_REQUIRED: row('LEGAL_ACCEPTANCE_REQUIRED', 'legal', 'warn'),
  VALIDATION_FAILED: row('VALIDATION_FAILED', 'fix'),
  STEP_PREREQUISITE: row('STEP_PREREQUISITE', 'goLanding', 'info'),
  NUMBER_PERSONAL_WARNING_REQUIRED: row('NUMBER_PERSONAL_WARNING_REQUIRED', 'fix', 'warn'),
  NUMBER_ALREADY_CONNECTED: row('NUMBER_ALREADY_CONNECTED', 'goApprovals', 'info'),
  RATE_LIMITED: row('RATE_LIMITED', 'waitRetry', 'warn'),
  CHECKOUT_NOT_CONFIGURED: row('CHECKOUT_NOT_CONFIGURED', 'help', 'info'),
  PLAN_UNKNOWN: row('PLAN_UNKNOWN', 'retry'),
  BILLING_PORTAL_UNAVAILABLE: row('BILLING_PORTAL_UNAVAILABLE', 'help'),
  STRIPE_ERROR: row('STRIPE_ERROR', 'retry'),
  // 409 from POST /checkout: a live subscription exists. The screen re-reads the state (owners then see the payment portal
  // where it is the right place); elsewhere the recovery is "continue where you belong".
  SUBSCRIPTION_EXISTS: row('SUBSCRIPTION_EXISTS', 'goLanding', 'info'),
  CONNECT_NOT_CONFIGURED: row('CONNECT_NOT_CONFIGURED', 'help'),
  ENCRYPTION_NOT_CONFIGURED: row('ENCRYPTION_NOT_CONFIGURED', 'help'),
  CONNECT_IN_PROGRESS: row('CONNECT_IN_PROGRESS', 'waitRetry', 'info'),
  CONNECT_ATTEMPT_INVALID: row('CONNECT_ATTEMPT_INVALID', 'reloadConfig'),
  CONNECT_CODE_INVALID_OR_EXPIRED: row('CONNECT_CODE_INVALID_OR_EXPIRED', 'reloadConfig'),
  CONNECT_WABA_MISMATCH: row('CONNECT_WABA_MISMATCH', 'disconnect'), // owner: disconnect; member: help (onbErrorAction)
  CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT: row('CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT', 'goNumber'),
  CONNECT_NUMBER_REGISTERED_ELSEWHERE: row('CONNECT_NUMBER_REGISTERED_ELSEWHERE', 'goNumber'),
  CONNECT_VERIFICATION_FAILED: row('CONNECT_VERIFICATION_FAILED', 'reloadConfig'),
  CONNECT_CANCELLED: row('CONNECT_CANCELLED', 'retry', 'info'),
  CONNECT_NO_FACEBOOK_ACCOUNT: row('CONNECT_NO_FACEBOOK_ACCOUNT', 'noFacebook', 'info'),
  CONNECT_COEXISTENCE_UNAVAILABLE: row('CONNECT_COEXISTENCE_UNAVAILABLE', 'goMigrate', 'warn'),
  CONNECT_REGISTER_RATE_LIMITED: row('CONNECT_REGISTER_RATE_LIMITED', 'help', 'warn'),
  CONNECT_PARTIAL: row('CONNECT_PARTIAL', 'resume', 'warn'),
  CONNECT_AMBIGUOUS_WABA: row('CONNECT_AMBIGUOUS_WABA', 'help'),
  META_UNREACHABLE: row('META_UNREACHABLE', 'retry'),
  META_ERROR: row('META_ERROR', 'retry'),
  META_TOKEN_REVOKED: row('META_TOKEN_REVOKED', 'reconnect', 'warn'),
  META_PERMISSION_MISSING: row('META_PERMISSION_MISSING', 'reconnect', 'warn'),
  META_RATE_LIMITED: row('META_RATE_LIMITED', 'waitRetry', 'warn'),
  META_NOT_CONFIGURED: row('META_NOT_CONFIGURED', 'help'),
  TEMPLATE_LIMIT_REACHED: row('TEMPLATE_LIMIT_REACHED', 'help'),
  TEMPLATE_REJECTED: row('TEMPLATE_REJECTED', 'retry', 'warn'),
  TEST_RATE_LIMITED: row('TEST_RATE_LIMITED', 'waitRetry', 'warn'),
  TEST_NO_APPROVED_TEMPLATE: row('TEST_NO_APPROVED_TEMPLATE', 'goApprovals', 'info'),
  TEST_RECIPIENT_OPTED_OUT: row('TEST_RECIPIENT_OPTED_OUT', 'fix', 'warn'),
  TEST_PHONE_INVALID: row('TEST_PHONE_INVALID', 'fix'),
  TEST_NUMBER_LIMIT: row('TEST_NUMBER_LIMIT', 'help'),
  ONB_NETWORK: row('ONB_NETWORK', 'retry'),
  ONB_GENERIC: row('ONB_GENERIC', 'retry'),
  ONB_STATE_UNAVAILABLE: row('ONB_STATE_UNAVAILABLE', 'retry'),
  ONB_SDK_BLOCKED: row('ONB_SDK_BLOCKED', 'retry'),
  ONB_SDK_TIMEOUT: row('ONB_SDK_TIMEOUT', 'retry'),
  ONB_POPUP_BLOCKED: row('ONB_POPUP_BLOCKED', 'retry', 'warn'),
  ONB_IN_APP_BROWSER: row('ONB_IN_APP_BROWSER', 'none', 'info'),
  ONB_CODE_HANDOFF_SLOW: row('ONB_CODE_HANDOFF_SLOW', 'reloadConfig'),
  ONB_IMPORT_TOO_MANY: row('ONB_IMPORT_TOO_MANY', 'fix'),
  ONB_IMPORT_BAD_FILE: row('ONB_IMPORT_BAD_FILE', 'fix'),
  ONB_IMPORT_NO_ROWS: row('ONB_IMPORT_NO_ROWS', 'fix'),
};

const CODE_SET = new Set<string>(ONB_ERROR_CODES);
// Backend-only codes (errors.js): a crash (500) and a module that is not built. They show the generic copy, without the
// "unknown code" console note (they are known, they just have no screen of their own).
const BACKEND_GENERIC_CODES = new Set<string>(['INTERNAL_ERROR', 'NOT_IMPLEMENTED']);

/**
 * The stable code of an HTTP/client error. A body `code` that is a known code wins; otherwise the HTTP status decides
 * (0 -> ONB_NETWORK, 429 -> RATE_LIMITED, 403 without a code -> OWNER_ONLY, anything else -> ONB_GENERIC).
 * 401 never reaches the UI (the interceptor logs out), so it is not mapped.
 */
export function onbErrorCode(err: unknown): string {
  const e = err as { status?: unknown; error?: { code?: unknown } | null; code?: unknown } | null;
  const bodyCode = e?.error && typeof e.error === 'object' ? e.error.code : undefined;
  if (typeof bodyCode === 'string' && CODE_SET.has(bodyCode)) return bodyCode;
  if (typeof e?.code === 'string' && CODE_SET.has(e.code)) return e.code; // client-side thrown codes (ONB_SDK_BLOCKED ...)
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === 0) return 'ONB_NETWORK';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 403 && typeof bodyCode !== 'string') return 'OWNER_ONLY';
  return 'ONB_GENERIC';
}

/**
 * Seconds of the `Retry-After` header of an HTTP error (0 = no header, or one that is not a positive number). The one place the
 * header is read (approvals' Check now countdown and the generic rate-limit wording). Never throws.
 */
export function retryAfterOf(err: unknown): number {
  try {
    const h = (err as { headers?: { get?(n: string): string | null } } | null)?.headers?.get?.('Retry-After');
    const n = h ? parseInt(h, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** A server wait longer than this (seconds) is not "a moment": the generic rate-limit copy would be untrue. */
export const LONG_RETRY_AFTER_S = 120;

/** The catalogue key of a generic RATE_LIMITED answer that asks for a long wait ("wait a while", never "a moment"). */
export const RATE_LIMITED_LONG_KEY = 'onboarding.errors.RATE_LIMITED_LONG';

/** The catalogue text for an error. The raw server text is never shown; only the code and status go to the console. */
export function onbErrorText(i18n: Pick<I18nService, 't'>, err: unknown): string {
  const code = onbErrorCode(err);
  if (code === 'RATE_LIMITED' && retryAfterOf(err) > LONG_RETRY_AFTER_S) return i18n.t(RATE_LIMITED_LONG_KEY);
  const e = err as { status?: unknown; error?: { code?: unknown } | null } | null;
  const bodyCode = e?.error && typeof e.error === 'object' ? e.error.code : undefined;
  if (typeof bodyCode === 'string' && !CODE_SET.has(bodyCode) && !BACKEND_GENERIC_CODES.has(bodyCode)) {
    // only a well-formed code is echoed: whatever else the body held is never logged
    console.warn('[onboarding] unknown error code', /^[A-Z][A-Z0-9_]{1,63}$/.test(bodyCode) ? bodyCode : '(malformed)', e?.status);
  }
  return i18n.t(ONB_ERROR_TABLE[code].key);
}

export interface OnbErrorContext { isOwner?: boolean }

/** The recovery action of a code (members cannot disconnect: they are sent to help). */
export function onbErrorAction(code: string, ctx: OnbErrorContext = {}): OnbAction {
  const r = ONB_ERROR_TABLE[code] ?? ONB_ERROR_TABLE['ONB_GENERIC'];
  if (r.action === 'disconnect' && ctx.isOwner === false) return 'help';
  return r.action;
}

export function onbErrorTone(code: string): OnbErrorRow['tone'] {
  return (ONB_ERROR_TABLE[code] ?? ONB_ERROR_TABLE['ONB_GENERIC']).tone;
}
