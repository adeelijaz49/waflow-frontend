// Merge fields the localisation feature understands ({name}, {points}, ...) and the
// WhatsApp/Meta template limits the editors show counters for. Mirrors
// BE shared/localization/mergeFields.js (KNOWN_FIELDS) and metaConstraints.js (LIMITS).
// `autoFilled` fields are filled per customer at send time (name, points ...);
// the rest need a value per campaign (discount, date, link ...).
export interface MergeFieldInfo {
  key: string;
  autoFilled: boolean;
}

export const MERGE_FIELDS: readonly MergeFieldInfo[] = [
  { key: 'name', autoFilled: true },
  { key: 'full_name', autoFilled: true },
  { key: 'points', autoFilled: true },
  { key: 'business', autoFilled: true },
  { key: 'discount', autoFilled: false },
  { key: 'date', autoFilled: false },
  { key: 'time', autoFilled: false },
  { key: 'service', autoFilled: false },
  { key: 'link', autoFilled: false },
  { key: 'order_id', autoFilled: false },
  { key: 'amount', autoFilled: false },
  { key: 'code', autoFilled: false },
];

export const AUTO_FILLED_FIELDS: ReadonlySet<string> = new Set(MERGE_FIELDS.filter((f) => f.autoFilled).map((f) => f.key));

export const META_LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  // The product spec is stricter than Meta (25) for button labels.
  buttonLabel: 20,
  buttons: 10,
  visibleButtons: 3,
  caption: 2200,
} as const;

const FIELD_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

// Ordered, de-duplicated {fields} used in a text.
export function extractMergeFields(text: string | null | undefined): string[] {
  const seen: string[] = [];
  for (const m of (text ?? '').matchAll(FIELD_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

// Number of Unicode characters (code points), the way WhatsApp/Meta count them.
export function charCount(value: string | null | undefined): number {
  return Array.from(value ?? '').length;
}
