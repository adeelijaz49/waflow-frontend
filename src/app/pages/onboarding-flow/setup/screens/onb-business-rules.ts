import type { OnbBusiness } from '../../onb.types';

// Step 1 rules (DF 3.3), pure and unit tested. The server applies the same limits (DB 5 PUT /business); these only give
// an inline message before a request is made. Nothing here is visible text.

export const BUSINESS_COUNTRIES: readonly string[] = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'OTHER'] as const;
export const DEFAULT_COUNTRY = 'SA';

// Control characters (tab, new line ...) become a space; zero-width and bidi marks are removed (code point escapes: no raw
// hidden characters in this file).
const CONTROLS = /[\u{0}-\u{1f}\u{7f}]/gu;
const INVISIBLE = /[\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2069}\u{feff}]/gu;

/** Single-line, trimmed text without control or bidi characters. */
export function cleanLine(value: unknown): string {
  return String(value ?? '').replace(INVISIBLE, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
}

/** Business name: 2 to 80 characters once cleaned. Returns the cleaned name or null. */
export function validBusinessName(value: unknown): string | null {
  const v = cleanLine(value);
  return v.length >= 2 && v.length <= 80 ? v : null;
}

/** CR number: 5 to 20 letters or digits (spaces and hyphens the merchant types are dropped). Returns the number or null. */
export function validCrNumber(value: unknown): string | null {
  const v = cleanLine(value).replace(/[\s-]+/g, '');
  return /^[A-Za-z0-9]{5,20}$/.test(v) ? v : null;
}

// The server's own check (steps.js validateBusinessInput, EMAIL_RE): something@something.something without whitespace, a second
// "@" or any of < > , ; : " ( ) [ ] and the backslash (U+005C, written as a code point escape).
const CONTACT_EMAIL = /^[^\s@<>,;:"()[\]\u{5c}]+@[^\s@<>,;:"()[\]\u{5c}]+\.[^\s@<>,;:"()[\]\u{5c}]+$/u;

/**
 * "Email for updates" (Step 1, optional): the cleaned, lower-case address, or null. At most 120 characters, like the server,
 * which lower-cases it too. An empty value is not an address (null): callers treat empty as "not given", never as an error.
 */
export function validContactEmail(value: unknown): string | null {
  const v = cleanLine(value).toLowerCase();
  return v.length > 0 && v.length <= 120 && CONTACT_EMAIL.test(v) ? v : null;
}

export type LinkClass =
  | { kind: 'empty' }
  | { kind: 'instagram'; instagram: string }
  | { kind: 'website'; website: string }
  | { kind: 'invalid' };

const HANDLE = /^@?([A-Za-z0-9._]{1,30})$/;
const INSTAGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i;
// A bare "name.tld" with one of these endings is far more likely a website than an Instagram name (which is a name, not a domain).
const COMMON_TLD = /\.(?:com|net|org|sa|ae|kw|qa|bh|om|co|io|shop|store|online|site)$/i;

function toWebsite(text: string): string | null {
  let candidate = text.replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  if (candidate.length > 200 || /\s/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * The one "website or Instagram" field: an `instagram.com/<name>` address or `@name` or a plain name is an Instagram handle
 * (the `@` is stripped); anything with a scheme, `www.`, a path or a common domain ending is a website (`https://` added when
 * missing, `http://` raised to `https://`). Empty is allowed (the field is optional); anything else is invalid.
 */
export function classifyLink(raw: unknown): LinkClass {
  const text = cleanLine(raw);
  if (!text) return { kind: 'empty' };
  const insta = INSTAGRAM_URL.exec(text);
  if (insta) return { kind: 'instagram', instagram: insta[1] };
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^www\./i.test(text) && !text.includes('/');
  const handle = HANDLE.exec(text);
  if (bare && handle && (text.startsWith('@') || !COMMON_TLD.test(text))) return { kind: 'instagram', instagram: handle[1] };
  const website = toWebsite(text);
  return website ? { kind: 'website', website } : { kind: 'invalid' };
}

/** The screens of Step 1 in order. */
export type BusinessScreen = 'name' | 'industry' | 'links' | 'cr';
export const BUSINESS_URLS: Record<BusinessScreen, string> = {
  name: '/setup/business/name',
  industry: '/setup/business/industry',
  links: '/setup/business/links',
  cr: '/setup/business/cr',
};
export const AFTER_BUSINESS_URL = '/setup/number';

/** True when the screen's data is already known and valid (the screen is skipped on the way through). */
export function isAnswered(screen: BusinessScreen, b: OnbBusiness | null | undefined): boolean {
  switch (screen) {
    case 'name':
      return validBusinessName(b?.name) !== null && !!b?.country;
    case 'industry':
      return !!b?.industry;
    case 'links':
      return !!(b?.website || b?.instagram);
    case 'cr':
      return !!(b?.crNumber || b?.crSkipped);
  }
}

/** The first screen after `from` whose data is not known yet; the Number step when everything is known. */
export function nextBusinessUrl(from: BusinessScreen | 'start', b: OnbBusiness | null | undefined): string {
  const order: BusinessScreen[] = ['name', 'industry', 'links', 'cr'];
  const start = from === 'start' ? 0 : order.indexOf(from) + 1;
  for (const s of order.slice(start)) if (!isAnswered(s, b)) return BUSINESS_URLS[s];
  return AFTER_BUSINESS_URL;
}
