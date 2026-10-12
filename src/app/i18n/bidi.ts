// Bidirectional-text helpers (spec Phase 0: "bidirectional text safety").
// Pure functions. Direction marks are written as \u{...} escapes so they stay
// reviewable in source.
const LRI = '\u{2066}'; // left-to-right isolate
const RLI = '\u{2067}'; // right-to-left isolate
const PDI = '\u{2069}'; // pop directional isolate
const LRM = '\u{200E}'; // left-to-right mark

const ARABIC_LETTER = /(?=\p{L})\p{Script=Arabic}/u;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

export function containsArabic(value: string | null | undefined): boolean {
  if (!value) return false;
  for (const ch of value) {
    if (ARABIC_LETTER.test(ch)) return true;
  }
  return false;
}

// True when a value (a name, product, number, "50 SAR"...) must be kept
// left-to-right when it is placed inside Arabic text.
export function needsLtrProtection(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value);
  if (!s) return false;
  if (containsArabic(s)) return false;
  return LATIN_OR_DIGIT.test(s);
}

// Directional isolate: the modern, spec-recommended way to embed an LTR run in
// RTL text in the DOM.
export function isolateLtr(value: string | number): string {
  return `${LRI}${value}${PDI}`;
}

export function isolateRtl(value: string | number): string {
  return `${RLI}${value}${PDI}`;
}

// LRM wrapper — used where an isolate is not appropriate (plain-text copies
// such as clipboard text or WhatsApp-style previews that mirror what is sent).
export function wrapLtr(value: string | number): string {
  return `${LRM}${value}${LRM}`;
}

// Guess the base direction of a free-text value from its first strong letter
// (same rule as dir="auto"). Used for chart labels / places where the
// attribute can't be used.
export function detectDir(value: string | null | undefined): 'ltr' | 'rtl' {
  if (!value) return 'ltr';
  for (const ch of value) {
    if (/\p{L}/u.test(ch)) return ARABIC_LETTER.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}
