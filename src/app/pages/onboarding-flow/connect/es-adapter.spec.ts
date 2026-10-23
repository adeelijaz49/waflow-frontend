import {
  ES_ALLOWED_ORIGINS, ES_ERROR_MESSAGE_MAX, ES_FINISH_EVENTS, ES_MAX_RAW_LENGTH, ES_MESSAGE_TYPE,
  buildLoginOptions, isFacebookOrigin, parseEsMessage, sanitizeId, toCompleteBody,
} from './es-adapter';

const WWW = 'https://www.facebook.com';
const msg = (event: string, data?: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: ES_MESSAGE_TYPE, event, ...(data ? { data } : {}), ...extra,
});
const asString = (m: unknown): string => JSON.stringify(m);

const IDS = { phone_number_id: '106540352242922', waba_id: '524126980791429', business_id: '2729063490586005' };

describe('isFacebookOrigin (exact allow-list)', () => {
  it('accepts exactly the two Embedded Signup origins', () => {
    expect(ES_ALLOWED_ORIGINS).toEqual(['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com']);
    expect(isFacebookOrigin('https://www.facebook.com')).toBe(true);
    expect(isFacebookOrigin('https://web.facebook.com')).toBe(true);
  });

  it.each([
    'https://facebook.com.evil.test',
    'https://www.facebook.com.evil.test',
    'https://evilfacebook.com',
    'https://notfacebook.com',
    'http://facebook.com',
    'http://www.facebook.com',
    'https://facebook.com',
    'https://www.facebook.com:8443',
    'https://www.facebook.com/',
    'https://m.facebook.com',
    'https://www.FACEBOOK.com',
    'null',
    '',
    'https://evil.test/https://www.facebook.com',
  ])('rejects %j', (origin) => {
    expect(isFacebookOrigin(origin)).toBe(false);
  });

  it('rejects non-strings (a null origin, undefined)', () => {
    expect(isFacebookOrigin(null as unknown as string)).toBe(false);
    expect(isFacebookOrigin(undefined as unknown as string)).toBe(false);
    expect(isFacebookOrigin({} as unknown as string)).toBe(false);
  });
});

describe('parseEsMessage: the documented samples', () => {
  it.each([...ES_FINISH_EVENTS])('%s -> a finish signal with sanitised ids (object data)', (event) => {
    const s = parseEsMessage({ origin: WWW, data: msg(event, IDS, { version: 3 }) });
    expect(s).toEqual({ kind: 'finish', event, phoneNumberId: IDS.phone_number_id, wabaId: IDS.waba_id, businessId: IDS.business_id });
  });

  it('the same message as a JSON string gives the same signal', () => {
    const m = msg('FINISH', IDS);
    expect(parseEsMessage({ origin: WWW, data: asString(m) })).toEqual(parseEsMessage({ origin: WWW, data: m }));
    expect(parseEsMessage({ origin: 'https://web.facebook.com', data: asString(m) })?.kind).toBe('finish');
  });

  it('FINISH_ONLY_WABA has no phone number id', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('FINISH_ONLY_WABA', { waba_id: IDS.waba_id, business_id: IDS.business_id }) });
    expect(s).toEqual({ kind: 'finish', event: 'FINISH_ONLY_WABA', wabaId: IDS.waba_id, businessId: IDS.business_id });
    expect(s).not.toHaveProperty('phoneNumberId');
  });

  it('coexistence: FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING with version 3 and only a waba id', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', { waba_id: IDS.waba_id }, { version: 3 }) });
    expect(s).toEqual({ kind: 'finish', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', wabaId: IDS.waba_id });
  });

  it('extra arrays of ids (pages, catalogs, ad accounts) are never forwarded', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('FINISH', { ...IDS, page_ids: ['1'], ad_account_ids: ['22222'], catalog_ids: ['33333'], waba_ids: ['44444'] }) });
    expect(Object.keys(s as object).sort()).toEqual(['businessId', 'event', 'kind', 'phoneNumberId', 'wabaId']);
  });

  it('CANCEL with current_step is an abandon', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' }) });
    expect(s).toEqual({ kind: 'cancel', event: 'CANCEL', currentStep: 'PHONE_NUMBER_SETUP' });
  });

  it('CANCEL with error fields is an error (the docs use CANCEL, not ERROR, for user-reported problems)', () => {
    const s = parseEsMessage({
      origin: WWW,
      data: msg('CANCEL', { error_message: 'Could not send code', error_code: 2388091, session_id: 'abc', timestamp: '1700000000' }),
    });
    expect(s).toEqual({ kind: 'error', event: 'CANCEL', errorCode: '2388091', errorMessage: 'Could not send code' });
  });

  it('ERROR is handled as well, with a string error code', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('ERROR', { error_code: '3441030', error_message: 'Number already registered', current_step: 'VERIFY' }) });
    expect(s).toEqual({ kind: 'error', event: 'ERROR', currentStep: 'VERIFY', errorCode: '3441030', errorMessage: 'Number already registered' });
  });

  it('an unknown event carrying an error code is an error; one without is ignored', () => {
    expect(parseEsMessage({ origin: WWW, data: msg('SOMETHING_NEW', { error_code: 99 }) })).toEqual({ kind: 'error', event: 'SOMETHING_NEW', errorCode: '99' });
    expect(parseEsMessage({ origin: WWW, data: msg('SOMETHING_NEW', { foo: 'bar' }) })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: msg('PAGE_VIEW') })).toBeNull();
  });
});

describe('parseEsMessage: hostile and junk input', () => {
  const good = msg('FINISH', IDS);

  it('a wrong or look-alike origin yields null even for a perfect message', () => {
    for (const origin of ['https://facebook.com.evil.test', 'http://facebook.com', 'null', '', 'https://evil.test']) {
      expect(parseEsMessage({ origin, data: good }), origin).toBeNull();
      expect(parseEsMessage({ origin, data: asString(good) }), origin).toBeNull();
    }
  });

  it('another message type is not ours', () => {
    expect(parseEsMessage({ origin: WWW, data: { type: 'OTHER', event: 'FINISH', data: IDS } })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: { event: 'FINISH', data: IDS } })).toBeNull();
  });

  it.each([
    ['not JSON', '{nope'],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an array', [good]],
    ['a JSON array string', '[1,2]'],
    ['a JSON string literal', '"WA_EMBEDDED_SIGNUP"'],
    ['a function', () => 1],
  ])('%s -> null, never a throw', (_n, data) => {
    expect(() => parseEsMessage({ origin: WWW, data })).not.toThrow();
    expect(parseEsMessage({ origin: WWW, data })).toBeNull();
  });

  it('an oversized message string is dropped before it is parsed', () => {
    const big = asString(msg('FINISH', { ...IDS, pad: 'x'.repeat(ES_MAX_RAW_LENGTH) }));
    expect(big.length).toBeGreaterThan(ES_MAX_RAW_LENGTH);
    expect(parseEsMessage({ origin: WWW, data: big })).toBeNull();
  });

  it('a missing or odd event name is not ours', () => {
    expect(parseEsMessage({ origin: WWW, data: { type: ES_MESSAGE_TYPE } })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: msg('finish') })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: msg('FINISH; DROP', IDS) })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: { type: ES_MESSAGE_TYPE, event: 5 } })).toBeNull();
    expect(parseEsMessage({ origin: WWW, data: msg('X'.repeat(80)) })).toBeNull();
  });

  it('a missing ev object does not throw', () => {
    expect(parseEsMessage(null as unknown as { origin: string; data: unknown })).toBeNull();
    expect(parseEsMessage(undefined as unknown as { origin: string; data: unknown })).toBeNull();
  });

  it('non-object inner data is treated as empty', () => {
    expect(parseEsMessage({ origin: WWW, data: { type: ES_MESSAGE_TYPE, event: 'FINISH', data: 'str' } })).toEqual({ kind: 'finish', event: 'FINISH' });
    expect(parseEsMessage({ origin: WWW, data: { type: ES_MESSAGE_TYPE, event: 'FINISH', data: [1] } })).toEqual({ kind: 'finish', event: 'FINISH' });
  });
});

describe('ids, steps and text are sanitised', () => {
  it('sanitizeId keeps 5 to 30 digits only (string or safe integer)', () => {
    expect(sanitizeId('12345')).toBe('12345');
    expect(sanitizeId('9'.repeat(30))).toBe('9'.repeat(30));
    expect(sanitizeId(123456789)).toBe('123456789');
    for (const bad of ['1234', '9'.repeat(31), 'abc12345', '12 345', '12345a', '-12345', '12.345', '', null, undefined, {}, [], true, 1.5, -5, Number.NaN, 2 ** 60]) {
      expect(sanitizeId(bad), String(bad)).toBeUndefined();
    }
  });

  it('a bad id is dropped from the signal, never forwarded', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('FINISH', { phone_number_id: '12', waba_id: '<script>1</script>', business_id: 'abc' }) });
    expect(s).toEqual({ kind: 'finish', event: 'FINISH' });
  });

  it('errorMessage is truncated to 120 characters and control characters are removed', () => {
    const long = 'a'.repeat(500);
    const s = parseEsMessage({ origin: WWW, data: msg('CANCEL', { error_code: 1, error_message: long }) });
    expect(s?.errorMessage).toHaveLength(ES_ERROR_MESSAGE_MAX);
    const dirty = parseEsMessage({ origin: WWW, data: msg('CANCEL', { error_code: 1, error_message: `  bad${String.fromCharCode(0)}thing${String.fromCharCode(10)}here  ` }) });
    expect(dirty?.errorMessage).toBe('bad thing here');
  });

  it('an error code or step that does not look like one is dropped', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('ERROR', { error_code: 'x'.repeat(40), current_step: 'bad step!', error_message: 'ok' }) });
    expect(s).toEqual({ kind: 'error', event: 'ERROR', errorMessage: 'ok' });
  });
});

describe('buildLoginOptions (unchanged behaviour)', () => {
  it('asks for a code with the config id and the configured extras', () => {
    expect(buildLoginOptions({ configId: 'cfg-1' })).toEqual({
      config_id: 'cfg-1', response_type: 'code', override_default_response_type: true, extras: {},
    });
    expect(buildLoginOptions({ configId: 'cfg-1', extras: { setup: {} } })['extras']).toEqual({ setup: {} });
  });
});

describe('toCompleteBody', () => {
  it('builds the session block from a finish signal only', () => {
    const finish = parseEsMessage({ origin: WWW, data: msg('FINISH', IDS) });
    expect(toCompleteBody('att-1', 'CODE', finish)).toEqual({
      attemptId: 'att-1', code: 'CODE',
      session: { event: 'FINISH', phone_number_id: IDS.phone_number_id, waba_id: IDS.waba_id, business_id: IDS.business_id },
    });
  });

  it('no signal (code without event) or a cancel/error signal gives an empty session', () => {
    expect(toCompleteBody('a', 'c', null)).toEqual({ attemptId: 'a', code: 'c', session: {} });
    const cancel = parseEsMessage({ origin: WWW, data: msg('CANCEL', { current_step: 'X' }) });
    expect(toCompleteBody('a', 'c', cancel).session).toEqual({});
    const err = parseEsMessage({ origin: WWW, data: msg('CANCEL', { error_code: 7 }) });
    expect(toCompleteBody('a', 'c', err).session).toEqual({});
  });

  it('a waba-only finish forwards the event and no phone number id', () => {
    const s = parseEsMessage({ origin: WWW, data: msg('FINISH_ONLY_WABA', { waba_id: IDS.waba_id }) });
    expect(toCompleteBody('a', 'c', s).session).toEqual({ event: 'FINISH_ONLY_WABA', waba_id: IDS.waba_id });
  });
});
