import {
  DEFAULT_PHONE_COUNTRY, PHONE_MAX_DIGITS, PHONE_MIN_DIGITS, normalizePhone, pasteSampleLine, phoneCountry, phoneExample, phoneKey,
} from './phone';

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
// 0501234567 in Arabic-Indic and in Persian digits
const ARABIC_INDIC = cp(0x660, 0x665, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667);
const PERSIAN = cp(0x6f0, 0x6f5, 0x6f0, 0x6f1, 0x6f2, 0x6f3, 0x6f4, 0x6f5, 0x6f6, 0x6f7);
const LRM = cp(0x200e);
const NBSP = cp(0xa0);
const ENDASH = cp(0x2013);

const digitsOf = (raw: unknown, country?: string | null): string => normalizePhone(raw, country).e164Digits;

describe('phoneCountry: how a number without a country code is read', () => {
  it('a missing country is Saudi Arabia (the default of Step 1)', () => {
    for (const v of [undefined, null, '', '   ', 42]) expect(phoneCountry(v)).toEqual({ key: 'SA', cc: '966' });
    expect(DEFAULT_PHONE_COUNTRY).toBe('SA');
  });

  it.each([['SA', '966'], ['AE', '971'], ['KW', '965'], ['QA', '974'], ['BH', '973'], ['OM', '968'], [' ae ', '971'], ['kw', '965']])(
    '%s -> +%s', (key, cc) => {
      expect(phoneCountry(key).cc).toBe(cc);
    });

  it('OTHER and anything the module does not know have NO calling code', () => {
    expect(phoneCountry('OTHER')).toEqual({ key: 'OTHER', cc: null });
    expect(phoneCountry('XX')).toEqual({ key: 'XX', cc: null });
    expect(phoneCountry('constructor').cc).toBeNull();
  });
});

describe('normalizePhone: Saudi Arabia (the default)', () => {
  it('the limits are 8 and 15', () => {
    expect([PHONE_MIN_DIGITS, PHONE_MAX_DIGITS]).toEqual([8, 15]);
  });

  it.each([
    ['a local number with the trunk zero', '0501234567'],
    ['the same without the zero (Excel strips it)', '501234567'],
    ['already international, no plus', '966501234567'],
    ['with a plus', '+966501234567'],
    ['with 00', '00966501234567'],
    ['spaces and a plus', '+966 50 123 4567'],
    ['dashes', '+966-50-123-4567'],
    ['dots', '050.123.4567'],
    ['brackets', '(050) 123 4567'],
    ['spaces around', '  0501234567  '],
    ['the optional trunk zero in brackets', '+966 (0) 50 123 4567'],
    ['the trunk zero after the country code', '+966 0501234567'],
    ['the trunk zero after the code, no plus', '966 0501234567'],
    ['a local number written in brackets with the zero', '(0) 50 123 4567'],
    ['00 and the trunk zero', '00966 0501234567'],
  ])('%s: %s -> 966501234567', (_name, raw) => {
    const r = normalizePhone(raw, 'SA');
    expect(r).toEqual({ ok: true, e164Digits: '966501234567', withPlus: '+966501234567' });
  });

  it('Arabic-Indic and Persian digits are converted (and mixed with Western ones)', () => {
    expect(digitsOf(ARABIC_INDIC)).toBe('966501234567');
    expect(digitsOf(PERSIAN)).toBe('966501234567');
    expect(digitsOf(`+${cp(0x669, 0x666, 0x666)} ${cp(0x665, 0x660)} 123 4567`)).toBe('966501234567');
  });

  it('invisible direction marks and Unicode dashes that phones add when a number is copied are ignored', () => {
    expect(digitsOf(`${LRM}+966${NBSP}50${ENDASH}123${ENDASH}4567`)).toBe('966501234567');
    expect(digitsOf(`${cp(0x202a)}0501234567${cp(0x202c)}`)).toBe('966501234567');
  });

  it('a spreadsheet float artefact (.0 / .00) is dropped: it used to become a wrong 13-digit number', () => {
    expect(digitsOf('966501110004.0')).toBe('966501110004');
    expect(digitsOf('+966501110004.00')).toBe('966501110004');
    expect(digitsOf('0501234567.0')).toBe('966501234567');
    expect(digitsOf('501234567.0')).toBe('966501234567');
    expect(digitsOf(`${cp(0x669, 0x666, 0x666, 0x665, 0x660, 0x661, 0x661, 0x661, 0x660, 0x660, 0x660, 0x664)}${cp(0x66b)}${cp(0x660)}`)).toBe('966501110004');
    // dots that are separators are not an artefact
    expect(digitsOf('050.123.4567')).toBe('966501234567');
    expect(digitsOf('0.0')).toBe('');
  });

  it('a number typed as a spreadsheet number value (a JS number) is read too', () => {
    expect(digitsOf(966501234567)).toBe('966501234567');
    expect(digitsOf(501234567)).toBe('966501234567');
  });

  it.each([
    ['letters', '0501234abc', 'invalid_chars'], ['only letters', 'phone', 'invalid_chars'], ['letters around digits', 'abc12345678xyz', 'invalid_chars'],
    ['a plus in the middle', '050+1234567', 'invalid_chars'], ['a second plus', '++966501234567', 'invalid_chars'],
    ['a plus at the end', '0501234567+', 'invalid_chars'], ['an extension', '0501234567 ext 5', 'invalid_chars'],
    ['a slash', '050/1234567', 'invalid_chars'], ['an Arabic comma', `050${cp(0x60c)}1234567`, 'invalid_chars'], ['an at sign', '0501234567@', 'invalid_chars'],
    ['scientific notation', '9.66501E+11', 'invalid_chars'], ['an over-long text', `0501234567${' '.repeat(10)}${'1'.repeat(30)}`, 'invalid_chars'],
    ['an empty string', '', 'empty'], ['spaces only', '   ', 'empty'], ['null', null, 'empty'], ['undefined', undefined, 'empty'], ['an object', {}, 'empty'],
    ['a lone plus', '+', 'invalid_chars'],
    ['four digits', '0501', 'too_short'], ['a bare 8-digit number is not a Saudi number', '12345678', 'too_short'],
    ['a bare 7-digit number', '1234567', 'too_short'], ['a local number with a missing digit', '050123456', 'too_short'],
    ['a local number with an extra digit', '05012345678', 'too_long'], ['a bare number with an extra digit', '5012345678', 'too_long'],
    ['too short with a plus', '+1234567', 'too_short'], ['too long with a plus', '+1234567890123456', 'too_long'],
    ['00 and nothing else', '00', 'too_short'], ['an international number may not start with 0', '+0501234567', 'invalid_format'],
  ])('%s: %j is refused (%s)', (_name, raw, reason) => {
    const r = normalizePhone(raw, 'SA');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
    expect(r.e164Digits).toBe('');
    expect(r.withPlus).toBe('');
  });

  it('a number written with its full country code is trusted for any country (8 to 15 digits)', () => {
    expect(digitsOf('+44 7700 900123', 'SA')).toBe('447700900123');
    expect(digitsOf('0044 7700 900123', 'SA')).toBe('447700900123');
    expect(digitsOf('+1 (555) 123-4567', 'SA')).toBe('15551234567');
    expect(digitsOf('+12345678', 'SA')).toBe('12345678');
    expect(digitsOf('+123456789012345', 'SA')).toBe('123456789012345');
  });

  it('never throws on odd input', () => {
    for (const v of [Symbol, () => 1, [], [1, 2], NaN, Infinity, 1e21, new Date(0)]) expect(() => normalizePhone(v, 'SA')).not.toThrow();
  });
});

describe('normalizePhone: the other countries (the SAME local number is read in the country of the workspace)', () => {
  it.each([
    ['AE', '0501234567', '971501234567'],
    ['AE', '501234567', '971501234567'],
    ['AE', '041234567', '97141234567'], // a Dubai landline: 8 digits after the zero
    ['AE', '971501234567', '971501234567'],
    ['AE', '+971 50 123 4567', '971501234567'],
    ['KW', '51234567', '96551234567'],
    ['KW', '965 5123 4567', '96551234567'],
    ['KW', '96512345678', '96512345678'], // already international (3 + 8 digits)
    ['KW', '96551234', '96596551234'], // an 8-digit national number that happens to start with 965: completed, not mistaken for an international one
    ['QA', '55123456', '97455123456'],
    ['BH', '36123456', '97336123456'],
    ['OM', '91234567', '96891234567'],
    ['ae', '0501234567', '971501234567'],
  ])('%s: %s -> %s', (country, raw, expected) => {
    expect(digitsOf(raw, country)).toBe(expected);
    expect(normalizePhone(raw, country).withPlus).toBe(`+${expected}`);
  });

  it('a Saudi-looking local number is NOT read as Saudi in another country', () => {
    expect(digitsOf('0501234567', 'AE')).not.toBe('966501234567');
    expect(digitsOf('0501234567', 'AE')).toBe('971501234567');
    expect(normalizePhone('0501234567', 'KW')).toMatchObject({ ok: false, reason: 'too_long' }); // 9 digits: not a Kuwaiti number
  });

  it('the length of a national number is checked for the countries we complete ourselves', () => {
    expect(normalizePhone('5123456', 'KW')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(normalizePhone('512345678', 'KW')).toMatchObject({ ok: false, reason: 'too_long' });
    expect(normalizePhone('5012345', 'AE')).toMatchObject({ ok: false, reason: 'too_short' });
    expect(normalizePhone('5012345678', 'AE')).toMatchObject({ ok: false, reason: 'too_long' });
  });

  it('a missing country reads like Saudi Arabia', () => {
    expect(digitsOf('0501234567')).toBe('966501234567');
    expect(digitsOf('0501234567', null)).toBe('966501234567');
    expect(digitsOf('0501234567', '')).toBe('966501234567');
  });
});

describe('normalizePhone: "Another country" has no calling code to assume', () => {
  it.each(['OTHER', 'XX', 'other'])('%s: a number without + or 00 is refused with the reason "country code needed"', (country) => {
    for (const raw of ['0501234567', '501234567', '966501234567', '07700900123', ARABIC_INDIC, '12345678']) {
      expect(normalizePhone(raw, country), `${country} ${raw}`).toEqual({ ok: false, e164Digits: '', withPlus: '', reason: 'country_code_needed' });
    }
  });

  it('a plus or 00 makes it a full number', () => {
    expect(normalizePhone('+44 7700 900123', 'OTHER')).toEqual({ ok: true, e164Digits: '447700900123', withPlus: '+447700900123' });
    expect(digitsOf('0044 7700 900123', 'OTHER')).toBe('447700900123');
    expect(digitsOf('+966501234567', 'OTHER')).toBe('966501234567');
  });

  it('text that is not a number keeps its own reason (not "country code needed")', () => {
    expect(normalizePhone('abc', 'OTHER').reason).toBe('invalid_chars');
    expect(normalizePhone('', 'OTHER').reason).toBe('empty');
    expect(normalizePhone('+123', 'OTHER').reason).toBe('too_short');
  });
});

describe('phoneKey, examples', () => {
  it('the key is the last 9 digits (a shorter number is its own key)', () => {
    expect(phoneKey('966501234567')).toBe('501234567');
    expect(phoneKey('971501234567')).toBe('501234567'); // another country, the same national part: the key collides on purpose
    expect(phoneKey('12345678')).toBe('12345678');
    expect(phoneKey('')).toBe('');
  });

  it('every country has a format hint that is not a number someone could copy, and a sample paste line', () => {
    for (const c of ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'OTHER', undefined]) {
      const hint = phoneExample(c);
      expect(hint.startsWith('+'), String(c)).toBe(true);
      expect(normalizePhone(hint, c).ok, `${String(c)} hint ${hint}`).toBe(false);
      const line = pasteSampleLine(c);
      expect(line.startsWith('Sara Ahmed, '), String(c)).toBe(true);
    }
    expect(phoneExample('AE')).toBe('+971 5x xxx xxxx');
    expect(phoneExample('OTHER')).toBe('+44 7xxx xxxxxx');
  });

  it('the sample line of each country is a number that country accepts', () => {
    for (const c of ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'OTHER']) {
      const number = pasteSampleLine(c).split(', ')[1];
      expect(normalizePhone(number, c).ok, `${c} ${number}`).toBe(true);
    }
  });
});
