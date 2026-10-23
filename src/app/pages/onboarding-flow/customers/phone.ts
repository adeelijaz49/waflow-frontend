// Phone numbers of the customers prompt and the "send yourself a test" screen: ONE pure module (no Angular, no I/O, no logging).
//
// Why it exists (R6-01, R6-02, R6-05): the server reads a number WITHOUT a country code with the workspace default (Saudi Arabia, +966)
// and never learns the country picked in Step 1, so a Kuwaiti or Emirati list would be stored under Saudi numbers. The merchant's
// country is therefore applied HERE, before anything is sent, and the result is always an explicit international number:
//   - import rows are sent as "+<digits>" (the import engine keeps a number with a leading plus exactly as typed),
//   - a customer added one by one is saved with the DIGITS ONLY (the format WhatsApp's own lookups match exactly),
//   - the test-message recipient is sent as "+<digits>".
// The rules mirror the backend's utils/phoneNormalize.js (normalizePhoneForDedup) with the country made explicit.

/** 8 to 15 digits: the length of an international number (E.164 allows 15; fewer than 8 cannot be a full number). */
export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

export type PhoneReason = 'empty' | 'invalid_chars' | 'invalid_format' | 'too_short' | 'too_long' | 'country_code_needed';

export interface PhoneResult {
  ok: boolean;
  /** The international number without a plus ("966501234567"), empty when the number is not usable. */
  e164Digits: string;
  /** The same number with a leading plus ("+966501234567"), empty when the number is not usable. */
  withPlus: string;
  reason?: PhoneReason;
}

interface Dial {
  /** Country calling code. */
  cc: string;
  /**
   * How many digits a national number has (without the trunk zero). Used ONLY for a number the merchant wrote without a country code,
   * which we complete ourselves: a number of another length is a typo, not something to guess about (and it is how "already
   * international" is told from "local"). A number written with + or 00 is trusted as typed (8 to 15 digits).
   */
  national: readonly [min: number, max: number];
}

// The countries of Step 1 (business-name.ts BUSINESS_COUNTRIES). OTHER has no calling code on purpose: a bare number is refused there.
const DIAL: Record<string, Dial> = {
  SA: { cc: '966', national: [9, 9] },
  AE: { cc: '971', national: [8, 9] },
  KW: { cc: '965', national: [8, 8] },
  QA: { cc: '974', national: [8, 8] },
  BH: { cc: '973', national: [8, 8] },
  OM: { cc: '968', national: [8, 8] },
};

/** Where a workspace without a saved country starts (the same default as Step 1). */
export const DEFAULT_PHONE_COUNTRY = 'SA';

export interface PhoneCountry {
  /** Upper-case country key ('SA', 'OTHER', ...). */
  key: string;
  /** Country calling code, or null when the country has none here (OTHER and anything unknown). */
  cc: string | null;
}

/**
 * The country a number without a country code is read in. A missing country is Saudi Arabia (the default of Step 1); OTHER and any
 * key this module does not know have NO calling code, so only numbers written with + or 00 are accepted for them.
 */
export function phoneCountry(countryKey: unknown): PhoneCountry {
  const raw = typeof countryKey === 'string' ? countryKey.trim() : '';
  if (raw === '') return { key: DEFAULT_PHONE_COUNTRY, cc: DIAL[DEFAULT_PHONE_COUNTRY].cc };
  const key = raw.toUpperCase();
  return { key, cc: DIAL[key]?.cc ?? null };
}

const EASTERN_DIGITS = /[\u{660}-\u{669}\u{6f0}-\u{6f9}]/gu;
const ARABIC_DECIMAL = /\u{66b}/gu;
// Ignored while reading: spaces (any kind), hyphens and the other dashes, dots, parentheses, and the invisible direction / zero-width marks
// that phones add when a number is copied (code point escapes: no hidden character is typed into this file).
const SEPARATORS = /[\s\-.()\u{2010}-\u{2015}\u{2212}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}\u{2066}-\u{2069}\u{feff}]/gu;
// "+966 (0) 50 ...": the zero in brackets is the optional national trunk digit, never part of the number.
const OPTIONAL_TRUNK_ZERO = /\(\s*0\s*\)/g;
// A spreadsheet's float artefact: "966501110004.0" / "+966501110004.00" (one dot, only zeros after it, at the very end of the cell).
const FLOAT_TAIL = /^([^.]*\d)\.0+$/;
const MAX_RAW_LENGTH = 40;

const westernDigit = (d: string): string => {
  const c = d.codePointAt(0) as number;
  return String(c >= 0x6f0 ? c - 0x6f0 : c - 0x660);
};

/**
 * Reads one typed phone number as an explicit international number.
 *  - Arabic-Indic and Persian digits are converted; spaces, dashes, dots, brackets and invisible marks are ignored; a trailing ".0" /
 *    ".00" from a spreadsheet and an "(0)" trunk digit are dropped;
 *  - a leading "+" is an international number as typed; a leading "00" means the same;
 *  - a leading "0" is a local number: the zeros are dropped and the country calling code of the workspace is put in front;
 *  - a bare national number ("501234567") gets the calling code; a number that already starts with the calling code AND has the length
 *    of a national number after it is kept as it is;
 *  - a number we complete ourselves (local or bare) must have the digit count of a national number of the country (Saudi Arabia 9, the
 *    other countries 8, the Emirates 8 or 9): anything else is a typo and is refused instead of guessed;
 *  - OTHER / an unknown country has no calling code: a number without + or 00 is refused ('country_code_needed');
 *  - the result must have 8 to 15 digits and cannot start with 0.
 * Anything with letters or other symbols is refused. Never throws.
 */
export function normalizePhone(raw: unknown, countryKey?: string | null): PhoneResult {
  const fail = (reason: PhoneReason): PhoneResult => ({ ok: false, e164Digits: '', withPlus: '', reason });
  let s = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw : '';
  s = s.replace(EASTERN_DIGITS, westernDigit).replace(ARABIC_DECIMAL, '.').trim();
  if (s === '') return fail('empty');
  if (s.length > MAX_RAW_LENGTH) return fail('invalid_chars');
  const tail = FLOAT_TAIL.exec(s);
  if (tail) s = tail[1];
  s = s.replace(OPTIONAL_TRUNK_ZERO, '').replace(SEPARATORS, '');
  if (s === '') return fail('empty');
  const plus = s.startsWith('+');
  const body = plus ? s.slice(1) : s;
  if (!/^\d+$/.test(body)) return fail('invalid_chars');

  const country = phoneCountry(countryKey);
  const dial = country.cc === null ? null : (DIAL[country.key] as Dial);
  const [min, max] = dial ? dial.national : [0, 0];
  const within = (n: number): boolean => n >= min && n <= max;
  // "+966 0501234567" / "966 0501234567": the trunk zero written after the country code of the workspace is not part of the number.
  const withoutTrunkAfterCode = (d: string): string => {
    if (!dial || !d.startsWith(`${dial.cc}0`)) return d;
    const rest = d.slice(dial.cc.length).replace(/^0+/, '');
    return within(rest.length) ? dial.cc + rest : d;
  };

  let digits: string;
  if (plus) digits = withoutTrunkAfterCode(body);
  else if (body.startsWith('00')) digits = withoutTrunkAfterCode(body.slice(2));
  else if (!dial) return fail('country_code_needed');
  else {
    const typed = withoutTrunkAfterCode(body);
    if (!typed.startsWith('0') && typed.startsWith(dial.cc) && within(typed.length - dial.cc.length)) digits = typed;
    else {
      const national = typed.replace(/^0+/, '');
      if (national.length < min) return fail('too_short');
      if (national.length > max) return fail('too_long');
      digits = dial.cc + national;
    }
  }

  if (digits === '') return fail('too_short');
  if (digits.startsWith('0')) return fail('invalid_format');
  if (digits.length < PHONE_MIN_DIGITS) return fail('too_short');
  if (digits.length > PHONE_MAX_DIGITS) return fail('too_long');
  return { ok: true, e164Digits: digits, withPlus: `+${digits}` };
}

/**
 * The key two rows of the same person share: the last 9 digits of the international number. Deliberately looser than the whole number
 * (a collision can only WITHHOLD consent from a group of rows, never grant it; see splitByOptIn).
 */
export function phoneKey(e164Digits: string): string {
  return String(e164Digits ?? '').slice(-9);
}

// A format hint per country, shown where a number is asked for. The "x" letters keep it from being a number a person could copy.
const NUMBER_EXAMPLE: Record<string, string> = {
  SA: '+966 5x xxx xxxx', // i18n-ignore
  AE: '+971 5x xxx xxxx', // i18n-ignore
  KW: '+965 xxxx xxxx', // i18n-ignore
  QA: '+974 xxxx xxxx', // i18n-ignore
  BH: '+973 xxxx xxxx', // i18n-ignore
  OM: '+968 xxxx xxxx', // i18n-ignore
};
const OTHER_NUMBER_EXAMPLE = '+44 7xxx xxxxxx'; // i18n-ignore

/** How a full number of the workspace country is written, for example "+966 5x xxx xxxx" (a pattern, not a real number). */
export function phoneExample(countryKey: unknown): string {
  return NUMBER_EXAMPLE[phoneCountry(countryKey).key] ?? OTHER_NUMBER_EXAMPLE;
}

// A sample customer line for the paste box: a name and a number written the way people of that country write it locally.
const LOCAL_SAMPLE: Record<string, string> = {
  SA: '0501234567', // i18n-ignore
  AE: '0501234567', // i18n-ignore
  KW: '51234567', // i18n-ignore
  QA: '55123456', // i18n-ignore
  BH: '36123456', // i18n-ignore
  OM: '91234567', // i18n-ignore
};
const OTHER_SAMPLE = '+447700900123'; // i18n-ignore

/** The placeholder line of the paste box ("Sara Ahmed, 0501234567"): sample data, never read back. */
export function pasteSampleLine(countryKey: unknown): string {
  return `Sara Ahmed, ${LOCAL_SAMPLE[phoneCountry(countryKey).key] ?? OTHER_SAMPLE}`; // i18n-ignore
}
