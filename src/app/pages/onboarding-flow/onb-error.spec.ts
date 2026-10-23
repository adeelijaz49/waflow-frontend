import enCatalog from '../../i18n/catalogs/en/onboarding.json';
import arCatalog from '../../i18n/catalogs/ar/onboarding.json';
import {
  LONG_RETRY_AFTER_S, ONB_ACTIONS, ONB_ERROR_CODES, ONB_ERROR_TABLE, RATE_LIMITED_LONG_KEY, onbErrorAction, onbErrorCode, onbErrorText, onbErrorTone,
  retryAfterOf,
} from './onb-error';
import { ONB_BACKEND_ERROR_CODES, ONB_CLIENT_ERROR_CODES } from './onb.types';

const en = enCatalog as Record<string, string>;
const ar = arCatalog as Record<string, string>;

// DB 4.7 catalogue, typed out here independently of onb.types so a code dropped from the type list is noticed.
const DB_CODES = [
  'ONBOARDING_NOT_AVAILABLE', 'SUBSCRIPTION_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_PAST_DUE', 'SUBSCRIPTION_CANCELLED', 'WHATSAPP_NOT_CONNECTED',
  'WHATSAPP_RECONNECT_REQUIRED', 'SENDING_NOT_AVAILABLE_YET', 'OWNER_ONLY', 'NOT_A_MEMBER', 'LEGAL_ACCEPTANCE_REQUIRED', 'VALIDATION_FAILED', 'STEP_PREREQUISITE',
  'NUMBER_PERSONAL_WARNING_REQUIRED', 'NUMBER_ALREADY_CONNECTED', 'RATE_LIMITED', 'CHECKOUT_NOT_CONFIGURED', 'PLAN_UNKNOWN',
  'BILLING_PORTAL_UNAVAILABLE', 'STRIPE_ERROR', 'SUBSCRIPTION_EXISTS', 'CONNECT_NOT_CONFIGURED', 'ENCRYPTION_NOT_CONFIGURED', 'CONNECT_IN_PROGRESS', 'CONNECT_ATTEMPT_INVALID',
  'CONNECT_CODE_INVALID_OR_EXPIRED', 'CONNECT_WABA_MISMATCH', 'CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT', 'CONNECT_NUMBER_REGISTERED_ELSEWHERE',
  'CONNECT_VERIFICATION_FAILED', 'CONNECT_CANCELLED', 'CONNECT_NO_FACEBOOK_ACCOUNT', 'CONNECT_COEXISTENCE_UNAVAILABLE', 'CONNECT_REGISTER_RATE_LIMITED',
  'CONNECT_PARTIAL', 'CONNECT_AMBIGUOUS_WABA', 'META_UNREACHABLE', 'META_ERROR', 'META_TOKEN_REVOKED', 'META_PERMISSION_MISSING', 'META_RATE_LIMITED',
  'META_NOT_CONFIGURED', 'TEMPLATE_LIMIT_REACHED', 'TEMPLATE_REJECTED', 'TEST_RATE_LIMITED', 'TEST_NO_APPROVED_TEMPLATE', 'TEST_RECIPIENT_OPTED_OUT',
  'TEST_PHONE_INVALID', 'TEST_NUMBER_LIMIT',
];

describe('ONB_ERROR_CODES', () => {
  it('contains every code of the backend catalogue (DB 4.7) and the client-only ONB_* codes, without duplicates', () => {
    for (const c of DB_CODES) expect(ONB_ERROR_CODES).toContain(c);
    expect([...ONB_BACKEND_ERROR_CODES].sort()).toEqual([...DB_CODES].sort());
    expect(new Set(ONB_ERROR_CODES).size).toBe(ONB_ERROR_CODES.length);
    for (const c of ONB_CLIENT_ERROR_CODES) expect(c.startsWith('ONB_')).toBe(true);
  });

  it.each(ONB_ERROR_CODES.map((c) => [c]))('%s has a table row, a valid action and tone, and en + ar catalogue keys', (code) => {
    const row = ONB_ERROR_TABLE[code];
    expect(row).toBeTruthy();
    expect(row.key).toBe(`onboarding.errors.${code}`);
    expect(ONB_ACTIONS).toContain(row.action);
    expect(['error', 'warn', 'info']).toContain(row.tone);
    expect(typeof en[`errors.${code}`]).toBe('string');
    expect(en[`errors.${code}`].length).toBeGreaterThan(5);
    expect(typeof ar[`errors.${code}`]).toBe('string');
    expect(ar[`errors.${code}`].length).toBeGreaterThan(3);
  });

  it('the table has no rows for unknown codes', () => {
    expect(Object.keys(ONB_ERROR_TABLE).sort()).toEqual([...ONB_ERROR_CODES].sort());
  });

  it('no copy contains WABA, Cloud API, "error code" or a raw error number', () => {
    for (const code of ONB_ERROR_CODES) {
      for (const text of [en[`errors.${code}`], ar[`errors.${code}`]]) {
        expect(text).not.toMatch(/WABA|Cloud API|error code/i);
        expect(text).not.toMatch(/#\d{3,}|\b(?:131|133|190|368|2388|3441)\d*\b/);
        expect(text).not.toContain(code);
      }
    }
  });
});

describe('onbErrorCode: stable code from an HTTP/client error', () => {
  it('uses the body code when it is a known code', () => {
    expect(onbErrorCode({ status: 402, error: { code: 'PAYMENT_PAST_DUE' } })).toBe('PAYMENT_PAST_DUE');
    expect(onbErrorCode({ status: 422, error: { code: 'NUMBER_PERSONAL_WARNING_REQUIRED' } })).toBe('NUMBER_PERSONAL_WARNING_REQUIRED');
  });
  it('accepts client-thrown codes', () => {
    expect(onbErrorCode({ code: 'ONB_SDK_BLOCKED' })).toBe('ONB_SDK_BLOCKED');
  });
  it('falls back by HTTP status', () => {
    expect(onbErrorCode({ status: 0 })).toBe('ONB_NETWORK');
    expect(onbErrorCode({ status: 429 })).toBe('RATE_LIMITED');
    expect(onbErrorCode({ status: 403 })).toBe('OWNER_ONLY');
    expect(onbErrorCode({ status: 403, error: {} })).toBe('OWNER_ONLY');
    for (const status of [404, 409, 422, 500, 502, 503, 402]) expect(onbErrorCode({ status })).toBe('ONB_GENERIC');
  });
  it('an unknown body code and junk inputs become ONB_GENERIC', () => {
    expect(onbErrorCode({ status: 422, error: { code: 'SOMETHING_NEW' } })).toBe('ONB_GENERIC');
    expect(onbErrorCode({ status: 403, error: { code: 'SOMETHING_NEW' } })).toBe('ONB_GENERIC');
    for (const junk of [null, undefined, 'x', 5, {}, { error: 'text' }]) expect(onbErrorCode(junk)).toBe('ONB_GENERIC');
  });
});

describe('onbErrorText', () => {
  const t = vi.fn((key: string) => `[${key}]`);
  const i18n = { t } as unknown as Parameters<typeof onbErrorText>[0];

  beforeEach(() => {
    t.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns the catalogue text of the code, never the server text', () => {
    const text = onbErrorText(i18n, { status: 402, error: { code: 'PAYMENT_PAST_DUE', error: 'Raw English server text with 12345' } });
    expect(text).toBe('[onboarding.errors.PAYMENT_PAST_DUE]');
    expect(text).not.toContain('Raw English');
  });

  it('an unknown code shows the generic text and only the code and status reach the console', () => {
    const text = onbErrorText(i18n, { status: 422, error: { code: 'BRAND_NEW', error: 'secret raw text' } });
    expect(text).toBe('[onboarding.errors.ONB_GENERIC]');
    const warned = JSON.stringify((console.warn as ReturnType<typeof vi.fn>).mock.calls);
    expect(warned).toContain('BRAND_NEW');
    expect(warned).not.toContain('secret raw text');
  });

  it('a malformed unknown code is never echoed to the console', () => {
    onbErrorText(i18n, { status: 422, error: { code: 'token=abc123 +966500001234' } });
    const warned = JSON.stringify((console.warn as ReturnType<typeof vi.fn>).mock.calls);
    expect(warned).toContain('(malformed)');
    expect(warned).not.toContain('abc123');
    expect(warned).not.toContain('966500001234');
  });

  it('the backend-only codes INTERNAL_ERROR and NOT_IMPLEMENTED show the generic copy without an unknown-code note', () => {
    for (const code of ['INTERNAL_ERROR', 'NOT_IMPLEMENTED']) {
      expect(onbErrorCode({ status: 500, error: { code } })).toBe('ONB_GENERIC');
      expect(onbErrorText(i18n, { status: 500, error: { code } })).toBe('[onboarding.errors.ONB_GENERIC]');
    }
    expect((console.warn as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')).not.toContain('INTERNAL_ERROR');
  });

  it('network errors and rate limits map to their own copy', () => {
    expect(onbErrorText(i18n, { status: 0 })).toBe('[onboarding.errors.ONB_NETWORK]');
    expect(onbErrorText(i18n, { status: 429 })).toBe('[onboarding.errors.RATE_LIMITED]');
  });

  describe('a rate limit that asks for a LONG wait is never "a moment" (R6-14)', () => {
    const limited = (retryAfter: string | null, code = 'RATE_LIMITED'): unknown => ({
      status: 429, error: { code }, headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? retryAfter : null) },
    });

    it.each([['121', true], ['3600', true], ['99999', true], ['120', false], ['60', false], ['1', false], ['0', false], ['-5', false], ['abc', false], ['', false], [null, false]])(
      'Retry-After %j -> the long wording: %s', (header, long) => {
        expect(onbErrorText(i18n, limited(header))).toBe(long ? '[onboarding.errors.RATE_LIMITED_LONG]' : '[onboarding.errors.RATE_LIMITED]');
      });

    it('a 429 without any header keeps the usual wording; another code is never rewritten', () => {
      expect(onbErrorText(i18n, { status: 429 })).toBe('[onboarding.errors.RATE_LIMITED]');
      expect(onbErrorText(i18n, limited('3600', 'META_RATE_LIMITED'))).toBe('[onboarding.errors.META_RATE_LIMITED]');
      expect(onbErrorText(i18n, limited('3600', 'TEST_RATE_LIMITED'))).toBe('[onboarding.errors.TEST_RATE_LIMITED]');
    });

    it('the catalogue has both sentences in both languages, and the long one does not say "a moment"', () => {
      for (const table of [en, ar]) {
        expect(table['errors.RATE_LIMITED_LONG']).toBeTruthy();
        expect(table['errors.RATE_LIMITED']).toBeTruthy();
      }
      expect(en['errors.RATE_LIMITED_LONG']).not.toMatch(/moment/i);
      expect(en['errors.RATE_LIMITED']).toMatch(/moment/i);
      expect(RATE_LIMITED_LONG_KEY).toBe('onboarding.errors.RATE_LIMITED_LONG');
      expect(LONG_RETRY_AFTER_S).toBe(120);
    });

    it('retryAfterOf reads the header, and never throws on odd errors', () => {
      expect(retryAfterOf(limited('30'))).toBe(30);
      expect(retryAfterOf(limited('  45 '))).toBe(45);
      expect(retryAfterOf(limited('0'))).toBe(0);
      expect(retryAfterOf({ status: 429, headers: { get: () => { throw new Error('boom'); } } })).toBe(0);
      for (const v of [null, undefined, 'x', 5, {}, { headers: null }, { headers: {} }]) expect(retryAfterOf(v)).toBe(0);
    });
  });
});

describe('onbErrorAction / onbErrorTone', () => {
  it('maps the documented codes to their recovery actions', () => {
    const expected: Record<string, string> = {
      SUBSCRIPTION_REQUIRED: 'billing', PAYMENT_PENDING: 'waitRetry', PAYMENT_PAST_DUE: 'portal', SUBSCRIPTION_CANCELLED: 'billing',
      WHATSAPP_NOT_CONNECTED: 'goConnect', WHATSAPP_RECONNECT_REQUIRED: 'reconnect', SENDING_NOT_AVAILABLE_YET: 'help', OWNER_ONLY: 'none',
      LEGAL_ACCEPTANCE_REQUIRED: 'legal', VALIDATION_FAILED: 'fix', STEP_PREREQUISITE: 'goLanding', NUMBER_ALREADY_CONNECTED: 'goApprovals',
      CHECKOUT_NOT_CONFIGURED: 'help', CONNECT_ATTEMPT_INVALID: 'reloadConfig', CONNECT_CODE_INVALID_OR_EXPIRED: 'reloadConfig',
      CONNECT_NUMBER_REGISTERED_ELSEWHERE: 'goNumber', CONNECT_NO_FACEBOOK_ACCOUNT: 'noFacebook', CONNECT_COEXISTENCE_UNAVAILABLE: 'goMigrate',
      CONNECT_PARTIAL: 'resume', META_TOKEN_REVOKED: 'reconnect', META_RATE_LIMITED: 'waitRetry', TEST_NO_APPROVED_TEMPLATE: 'goApprovals',
      ONB_SDK_BLOCKED: 'retry', ONB_IN_APP_BROWSER: 'none', SUBSCRIPTION_EXISTS: 'goLanding',
    };
    for (const [code, action] of Object.entries(expected)) expect(onbErrorAction(code)).toBe(action);
  });

  it('CONNECT_WABA_MISMATCH: owner disconnects, a member is sent to help; unknown codes use the generic action', () => {
    expect(onbErrorAction('CONNECT_WABA_MISMATCH', { isOwner: true })).toBe('disconnect');
    expect(onbErrorAction('CONNECT_WABA_MISMATCH')).toBe('disconnect');
    expect(onbErrorAction('CONNECT_WABA_MISMATCH', { isOwner: false })).toBe('help');
    expect(onbErrorAction('NOT_A_CODE')).toBe('retry');
    expect(onbErrorTone('NOT_A_CODE')).toBe('error');
    expect(onbErrorTone('CONNECT_CANCELLED')).toBe('info');
  });
});
