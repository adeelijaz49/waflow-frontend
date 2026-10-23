// The ONLY place where Meta's Embedded Signup field names appear (DF 4.2, AU4 1.1 and 1.2).
// Everything else in the app talks about EsSignal. Isolated on purpose: Meta's message shapes are documented
// inconsistently (CANCEL with error fields vs ERROR, JSON string vs object `data`), so the parser is tolerant on
// input and strict on output (allow-listed origin, sanitised ids, truncated text, unknown events ignored).

export const ES_MESSAGE_TYPE = 'WA_EMBEDDED_SIGNUP';
export const ES_FINISH_EVENTS = [
  'FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH_OBO_MIGRATION', 'FINISH_GRANT_ONLY_API_ACCESS',
] as const;

/** The two origins the Embedded Signup popup posts from. Exact match: no suffix or subdomain tricks. */
export const ES_ALLOWED_ORIGINS: readonly string[] = ['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'] as const;

export const ES_ID_PATTERN = /^[0-9]{5,30}$/;
export const ES_ERROR_MESSAGE_MAX = 120;
/** A message string longer than this is junk (the real ones are a few hundred bytes). */
export const ES_MAX_RAW_LENGTH = 20_000;

export interface EsSignal {
  kind: 'finish' | 'cancel' | 'error';
  event: string;
  phoneNumberId?: string;
  wabaId?: string;
  businessId?: string;
  currentStep?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function isFacebookOrigin(origin: string): boolean {
  return typeof origin === 'string' && ES_ALLOWED_ORIGINS.includes(origin);
}

// ---- sanitisers -----------------------------------------------------------------------------------------------

const EVENT_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const STEP_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

/** Ids are kept only when they are 5 to 30 digits (a number or a numeric string); anything else is dropped. */
export function sanitizeId(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof text === 'string' && ES_ID_PATTERN.test(text) ? text : undefined;
}

function cleanCode(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof text === 'string' && ERROR_CODE_PATTERN.test(text) ? text : undefined;
}

function cleanStep(value: unknown): string | undefined {
  return typeof value === 'string' && STEP_PATTERN.test(value) ? value : undefined;
}

// Control characters are removed and the text cut to 120 chars. It is only forwarded to our server, never displayed.
function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0) as number;
    out += c < 32 || c === 0x7f ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, ES_ERROR_MESSAGE_MAX);
  return out || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** null = not ours: wrong origin, other type, junk, an unknown event that is not an error. */
export function parseEsMessage(ev: { origin: string; data: unknown }): EsSignal | null {
  try {
    if (!ev || !isFacebookOrigin(ev.origin)) return null;
    let data: unknown = ev.data;
    if (typeof data === 'string') {
      if (data.length > ES_MAX_RAW_LENGTH) return null;
      data = JSON.parse(data);
    }
    const msg = asRecord(data);
    if (!msg || msg['type'] !== ES_MESSAGE_TYPE) return null;
    const event = typeof msg['event'] === 'string' ? msg['event'].trim() : '';
    if (!EVENT_PATTERN.test(event)) return null;
    const inner = asRecord(msg['data']) ?? {};
    const errorCode = cleanCode(inner['error_code']);
    const errorMessage = cleanMessage(inner['error_message']);
    const hasError = errorCode !== undefined || errorMessage !== undefined;

    if ((ES_FINISH_EVENTS as readonly string[]).includes(event)) {
      return compact<EsSignal>({
        kind: 'finish',
        event,
        phoneNumberId: sanitizeId(inner['phone_number_id']),
        wabaId: sanitizeId(inner['waba_id']),
        businessId: sanitizeId(inner['business_id']),
      });
    }
    if (event === 'CANCEL') {
      // CANCEL carries either `current_step` (abandoned) or error fields (the user hit a problem).
      return compact<EsSignal>(
        hasError
          ? { kind: 'error', event, currentStep: cleanStep(inner['current_step']), errorCode, errorMessage }
          : { kind: 'cancel', event, currentStep: cleanStep(inner['current_step']) },
      );
    }
    if (event === 'ERROR') {
      return compact<EsSignal>({ kind: 'error', event, currentStep: cleanStep(inner['current_step']), errorCode, errorMessage });
    }
    // Any other event is ignored unless it reports an error code.
    if (errorCode !== undefined) {
      return compact<EsSignal>({ kind: 'error', event, currentStep: cleanStep(inner['current_step']), errorCode, errorMessage });
    }
    return null;
  } catch {
    return null; // not JSON, or anything unexpected: not ours
  }
}

export function buildLoginOptions(cfg: { configId: string; extras?: Record<string, unknown> }): Record<string, unknown> {
  return { config_id: cfg.configId, response_type: 'code', override_default_response_type: true, extras: cfg.extras ?? {} };
}

/** The body of POST /connect/complete. The session block is built only from a finish signal (never from a cancel). */
export function toCompleteBody(
  attemptId: string, code: string, s: EsSignal | null,
): { attemptId: string; code: string; session: { event?: string; phone_number_id?: string; waba_id?: string; business_id?: string } } {
  const session: { event?: string; phone_number_id?: string; waba_id?: string; business_id?: string } = {};
  if (s && s.kind === 'finish') {
    session.event = s.event;
    if (s.phoneNumberId) session.phone_number_id = s.phoneNumberId;
    if (s.wabaId) session.waba_id = s.wabaId;
    if (s.businessId) session.business_id = s.businessId;
  }
  return { attemptId, code, session };
}
