// Customers prompt, pure helpers (DF 3.7): CSV / paste parsing, the consent rules, the template, the skipped-rows merge.
// No Angular, no I/O, no logging: customer rows are personal data and never leave memory except in the requests of the import API.
//
// CONSENT IS NEVER INFERRED (R6-03, R6-04, R6-06). The rules this file enforces:
//  - a row can only be added WITH permission when the merchant ticked the attestation AND the row is a clear yes (a recognised yes in the
//    file's own opt-in column) or, under "all of them agreed", a row nobody marked as no;
//  - an explicit negative always wins, under every answer: an opt-in cell that is not a recognised yes, a recognised opt-out column
//    (Unsubscribed, Do not contact, ...) that is marked, or a pasted third value that is not yes;
//  - a column that LOOKS like consent but is not understood is reported (never used as consent), and the "all agreed" shortcut stays
//    off while the file has one (the caller reads `unknownConsentColumns`);
//  - rows of one person (the last 9 digits of the number) are decided together: if one of them is not a clear yes, none of them is added
//    with permission;
//  - "Opted in: <source>, <date>" is written only for rows of the attested job, from columns that are named after the opt-in.
import { normalizePhone, phoneKey } from './phone';

/** Server limit (importEngine MAX_ROWS) and the client file cap (DF 3.7). */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Written into the existing Notes field: the engine has no per-row source/date field (DF 3.7). It is stored data, not UI copy. */
export const NOTES_OPT_IN_PREFIX = 'Opted in: '; // i18n-ignore

const BOM = String.fromCodePoint(0xfeff);
const ARABIC_COMMA = String.fromCodePoint(0x060c);
const ARABIC_SEMICOLON = String.fromCodePoint(0x061b);

/** 'yes' = a clear yes; 'no' = an explicit negative or an unclear answer (never consent); 'unset' = nobody said anything (follows the merchant's answer). */
export type OptIn = 'yes' | 'no' | 'unset';
export type RejectReason = 'missing_name' | 'missing_phone' | 'invalid_phone' | 'country_code_needed' | 'unreadable';
export type ConsentMode = 'rows' | 'all' | 'none';
export type ImportIssue = 'no_rows' | 'too_many' | 'no_phone_column' | 'no_name_column';

export interface CustomerRow {
  name: string;
  /** "+<digits>": the number as an import job receives it (a leading plus is kept exactly as typed by the engine). */
  phone: string;
  /** The same number without the plus: what a customer added one by one is saved with. */
  digits: string;
  email: string;
  notes: string;
  language: string;
  optIn: OptIn;
  source: string;
  date: string;
}

export interface RejectedRow {
  name: string;
  phone: string;
  email: string;
  notes: string;
  language: string;
  reason: RejectReason;
}

export interface ParsedCustomers {
  rows: CustomerRow[];
  /** Every line that cannot be added, with the reason (the lines that could not be read are in here too). */
  rejected: RejectedRow[];
  /** The file has a column we understand as the opt-in column (the paste box never has one). */
  hasOptInColumn: boolean;
  hasLanguageColumn: boolean;
  issue: ImportIssue | null;
  /** Lines that could not be read at all (a quote that is never closed, a line break inside a name or a number). */
  unreadable: number;
  /** Headers (as written, shortened) of columns that look like consent but are NOT understood: they are never used as consent. */
  unknownConsentColumns: string[];
  /** Headers (as written, shortened) of opt-out columns we understand: a marked row is never added with permission. */
  optOutColumns: string[];
}

export interface ParseOptions {
  /** Country of the workspace (Step 1): how a number without a country code is read. Missing = Saudi Arabia. */
  country?: string | null;
  /** Raw lines the CSV reader could not read (parseCsvDetailed): they are reported with the rejected rows. */
  unreadable?: string[];
}

const emptyParsed = (): ParsedCustomers => ({
  rows: [], rejected: [], hasOptInColumn: false, hasLanguageColumn: false, issue: null, unreadable: 0, unknownConsentColumns: [], optOutColumns: [],
});

// ---------------------------------------------------------------------------------------------------------------------
// Low-level CSV

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/** Comma, semicolon or tab: whichever occurs most in the first line outside quotes (comma wins a tie and an empty file). */
export function detectDelimiter(text: string): string {
  const s = stripBom(text);
  const counts: Record<string, number> = { ',': 0, ';': 0, [TAB]: 0 };
  let inQ = false;
  let seen = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQ = !inQ;
    if (!inQ && (c === LF || c === CR)) {
      if (seen) break;
      continue;
    }
    seen = true;
    if (!inQ && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of [';', TAB]) if (counts[d] > counts[best]) best = d;
  return best;
}

export interface CsvDetailed {
  rows: string[][];
  /** The raw text of every record that could not be read (a quote that is never closed). */
  unreadable: string[];
}

interface ScanStop {
  /** Where the record that holds the unclosed quote began. */
  recordStart: number;
  /** End (exclusive) of the physical line that holds the unclosed quote. */
  lineEnd: number;
}

// One pass over the text from `from`: complete records go to `rows`. Returns null when the text ended cleanly, or where it ended inside
// a quote that was never closed (the record being built is dropped by the caller).
function scanRecords(s: string, d: string, from: number, rows: string[][]): ScanStop | null {
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  let quoteAt = -1;
  let recordStart = from;
  const endRow = (next: number): void => {
    row.push(cell);
    cell = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    recordStart = next;
  };
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      // a quote opens a quoted cell at the start of the cell, spaces before it allowed (`, "a, b"`)
      cell = '';
      inQ = true;
      quoteAt = i;
    } else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      if (s[i + 1] === '\n') i++;
      endRow(i + 1);
    } else if (c === '\n') endRow(i + 1);
    else cell += c;
  }
  if (inQ) {
    let lineEnd = quoteAt;
    while (lineEnd < s.length && s[lineEnd] !== '\n' && s[lineEnd] !== '\r') lineEnd++;
    return { recordStart, lineEnd };
  }
  if (cell !== '' || row.length > 0) endRow(s.length);
  return null;
}

const MAX_RESTARTS = 200;

/**
 * RFC 4180 reader: quotes (at the start of a cell, spaces before it allowed), doubled quotes, CRLF / LF / CR, BOM; blank lines are dropped.
 * A quote that is opened and never closed does NOT swallow the rest of the file: the line that holds it is returned in `unreadable`
 * (so the caller can report it) and reading goes on with the next line.
 */
export function parseCsvDetailed(text: string, delimiter?: string): CsvDetailed {
  const s = stripBom(text ?? '');
  const d = delimiter ?? detectDelimiter(s);
  const rows: string[][] = [];
  const unreadable: string[] = [];
  let from = 0;
  for (let restarts = 0; ; restarts++) {
    if (restarts > MAX_RESTARTS) {
      // a file made of unclosed quotes: stop re-reading it, report what is left line by line
      for (const line of s.slice(from).split(/\r\n|\r|\n/)) if (line.trim() !== '') unreadable.push(line);
      break;
    }
    const stop = scanRecords(s, d, from, rows);
    if (!stop) break;
    unreadable.push(s.slice(stop.recordStart, stop.lineEnd));
    from = stop.lineEnd + 1;
    if (from >= s.length) break;
  }
  return { rows, unreadable };
}

/** The rows of a CSV text (see parseCsvDetailed; the lines that could not be read are left out). */
export function parseCsvText(text: string, delimiter?: string): string[][] {
  return parseCsvDetailed(text, delimiter).rows;
}

/** Bytes of an uploaded file -> text: UTF-8 (BOM or not), UTF-16 with a BOM, else Windows-1256 (Arabic Excel "CSV"). */
export function decodeCsvBytes(input: ArrayBuffer | Uint8Array): string {
  const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return stripBom(new TextDecoder('utf-16le').decode(bytes));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return stripBom(new TextDecoder('utf-16be').decode(bytes));
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

export type FileKind = 'csv' | 'xlsx' | 'other';

/** `.csv` / `.txt` are read here; spreadsheets are sent to the full import page; anything else is refused. */
export function fileKind(name: string, mime = ''): FileKind {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'ods') return 'xlsx';
  if (!ext && /^text\/(csv|plain)$/i.test(mime)) return 'csv';
  return 'other';
}

// ---------------------------------------------------------------------------------------------------------------------
// Header matching: the engine's aliases + the opt-in columns of our own template, and the broad "looks like consent" checks

function norm(v: string): string {
  return String(v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Arabic letters that are written in several ways are folded (hamza on alef, alef maksura, teh marbuta, tatweel) before the broad checks. */
const arabicLoose = (s: string): string =>
  s
    .replace(/[\u{622}\u{623}\u{625}]/gu, String.fromCodePoint(0x627))
    .replace(/\u{649}/gu, String.fromCodePoint(0x64a))
    .replace(/\u{629}/gu, String.fromCodePoint(0x647))
    .replace(/\u{640}/gu, '');

const aliasSet = (list: string[]): Set<string> => new Set(list.map(norm));

const NAME_ALIASES = aliasSet(['name', 'full name', 'customer name', 'الاسم', 'اسم العميل', 'الاسم الكامل']); // i18n-ignore
const FIRST_ALIASES = aliasSet(['first name', 'firstname', 'given name']); // i18n-ignore
const LAST_ALIASES = aliasSet(['last name', 'lastname', 'surname', 'family name']); // i18n-ignore
const PHONE_ALIASES = aliasSet([
  'phone', 'mobile', 'contact number', 'phone number', 'whatsapp', 'whatsapp number', 'mobile number', 'tel', 'telephone', // i18n-ignore
  'الجوال', 'رقم الجوال', 'الهاتف', 'رقم الهاتف', 'جوال', 'هاتف', 'رقم الواتساب', // i18n-ignore
]);
const EMAIL_ALIASES = aliasSet(['email', 'e-mail', 'email address', 'البريد الإلكتروني', 'البريد']); // i18n-ignore
const NOTES_ALIASES = aliasSet(['notes', 'note', 'tags', 'ملاحظات']); // i18n-ignore
// The ONLY headers read as the file's opt-in column (a recognised yes/no per row). Everything else that looks like consent is "not understood".
const OPTIN_ALIASES = aliasSet([
  'opted in', 'opt-in', 'opt in', 'optin', 'consent', 'marketing consent', 'agreed', 'subscribed', 'whatsapp opt-in', 'whatsapp consent', // i18n-ignore
  'الموافقة', 'موافقة', 'موافق', // i18n-ignore
]);
// Consent EVIDENCE columns (written to Notes for rows of the attested job): only columns named after the opt-in. A plain "Date" or
// "Source" column (a purchase date, "Instagram") is not consent evidence.
const SOURCE_ALIASES = aliasSet(['opt-in source', 'optin source', 'consent source', 'how they opted in', 'مصدر الموافقة']); // i18n-ignore
const DATE_ALIASES = aliasSet(['opt-in date', 'optin date', 'consent date', 'opted in date', 'تاريخ الموافقة']); // i18n-ignore
const LANGUAGE_ALIASES = aliasSet([
  'language', 'lang', 'preferred language', 'customer language', 'اللغة', 'لغة', 'اللغة المفضلة', 'لغة العميل', // i18n-ignore
]);

// Broad header checks (substring, case-insensitive, Arabic too) on the normalised header. Opt-out is checked BEFORE consent, so
// "Unsubscribed" is an opt-out column, never an unknown consent column.
const OPTOUT_HEADER =
  /unsubscri|opted out|opt out|optout|do not (?:contact|call|message|email|text|sms|disturb)|don t (?:contact|call|message|email)|dont (?:contact|call)|\bdnc\b|\bblocked?\b|\bblacklist|\bstop(?:ped)?\b|الغاء الاشتراك|الغي الاشتراك|ملغي|غير مشترك|لا تتصل|لا تراسل|لا تزعج|محظور|حظر|ايقاف|توقف|انسحاب|رفض/;
const CONSENT_HEADER =
  /consent|permission|agree|accept|subscri|marketing|newsletter|gdpr|\bopt\b|opt ?in|\bopted|موافق|اشتراك|مشترك|تسويق|قبول|اذن|تصريح|نشره/;
const SOURCE_WORDS = /\b(?:source|origin|channel|method|how)\b|مصدر|طريق/;
const DATE_WORDS = /\b(?:date|when|time|timestamp)\b|تاريخ|وقت/;

/** The header for the broad checks: letters and digits only. Words inside brackets count here ("Status (subscribed / unsubscribed)"). */
const flatHeader = (v: string): string => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// "subscribed" next to "unsubscribed" in ONE header is both an opt-in and an opt-out word: not understood (never guessed either way).
const PLAIN_SUBSCRIBED = /\bsubscribed\b|\bopted in\b|\bopt in\b/;

type Kind = 'name' | 'first' | 'last' | 'phone' | 'email' | 'notes' | 'language' | 'optin' | 'source' | 'date' | 'optout' | 'consent' | 'other';

function classify(header: string): Kind {
  const h = norm(header);
  if (NAME_ALIASES.has(h)) return 'name';
  if (FIRST_ALIASES.has(h)) return 'first';
  if (LAST_ALIASES.has(h)) return 'last';
  if (PHONE_ALIASES.has(h)) return 'phone';
  if (EMAIL_ALIASES.has(h)) return 'email';
  if (NOTES_ALIASES.has(h)) return 'notes';
  if (LANGUAGE_ALIASES.has(h)) return 'language';
  if (SOURCE_ALIASES.has(h)) return 'source';
  if (DATE_ALIASES.has(h)) return 'date';
  if (OPTIN_ALIASES.has(h)) return 'optin';
  const loose = arabicLoose(flatHeader(header));
  if (OPTOUT_HEADER.test(loose)) return PLAIN_SUBSCRIBED.test(loose.replace(/unsubscribed/g, '')) ? 'consent' : 'optout';
  if (CONSENT_HEADER.test(loose)) {
    if (SOURCE_WORDS.test(loose)) return 'source';
    if (DATE_WORDS.test(loose)) return 'date';
    return 'consent';
  }
  return 'other';
}

interface Columns {
  name: number;
  first: number;
  last: number;
  phone: number;
  email: number;
  notes: number;
  language: number;
  source: number;
  date: number;
  optIn: number[];
  optOut: number[];
  /** Look like consent, not understood. */
  consent: number[];
  /** Columns whose cells are scanned for an explicit opt-out word (everything but the identity columns). */
  scan: number[];
}

function classifyHeaders(head: string[]): Columns {
  const cols: Columns = {
    name: -1, first: -1, last: -1, phone: -1, email: -1, notes: -1, language: -1, source: -1, date: -1, optIn: [], optOut: [], consent: [], scan: [],
  };
  head.forEach((h, i) => {
    const kind = classify(h);
    if (kind === 'optin') {
      cols.optIn.push(i);
      return;
    }
    if (kind === 'optout') {
      cols.optOut.push(i);
      return;
    }
    if (kind === 'consent') cols.consent.push(i);
    if (kind === 'consent' || kind === 'other' || kind === 'notes' || kind === 'source' || kind === 'date') cols.scan.push(i);
    if (kind !== 'consent' && kind !== 'other' && cols[kind] < 0) cols[kind] = i; // the first column of a kind is the one used
  });
  return cols;
}

const INVISIBLE = /[\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2069}\u{feff}]/gu;
const CONTROLS = /[\u{0}-\u{1f}\u{7f}]/gu;

/** A header as shown to the merchant: no hidden marks or line breaks, at most 40 characters. */
function headerLabel(h: string): string {
  const t = String(h ?? '').replace(INVISIBLE, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 39)}...` : t;
}

const YES_VALUES = new Set(['yes', 'y', 'true', '1', 'opted in', 'agreed', 'نعم', 'موافق', String.fromCodePoint(0x0661)]); // i18n-ignore

/** A "yes" cell (DF 3.7): yes y true 1 opted in agreed, Arabic yes / agreed. Anything else (no, blank, unknown) is not a yes. */
export function isYes(value: unknown): boolean {
  return YES_VALUES.has(String(value ?? '').normalize('NFKC').trim().toLowerCase());
}

// Values of an opt-out column that mean "not opted out". Anything else that is not empty (yes, true, 1, a date, "unsubscribed", unclear) marks the row.
const NOT_OPTED_OUT = new Set([
  'no', 'n', 'false', 'f', '0', 'none', 'null', 'nil', 'na', 'n/a', '-', '--', // i18n-ignore
  'لا', 'كلا', String.fromCodePoint(0x0660), String.fromCodePoint(0x06f0), // i18n-ignore
]);

function isOptOutMark(value: unknown): boolean {
  const v = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  return v !== '' && !NOT_OPTED_OUT.has(v);
}

// A whole cell that says the person opted out, in a column that is not named like an opt-out column ("Status: unsubscribed").
const OPT_OUT_WORDS = new Set([
  'unsubscribed', 'unsubscribe', 'opted out', 'opt out', 'optout', 'do not contact', 'don t contact', 'dont contact', 'do not call', 'do not message', // i18n-ignore
  'dnc', 'stop', 'stopped', 'blocked', 'blacklisted', // i18n-ignore
  'الغاء الاشتراك', 'ملغي الاشتراك', 'غير مشترك', 'محظور', 'لا تتصل', // i18n-ignore
]);

function isOptOutWord(value: unknown): boolean {
  const v = arabicLoose(norm(String(value ?? '')));
  return v !== '' && OPT_OUT_WORDS.has(v);
}

function optInOf(cells: string[], cols: Columns): OptIn {
  const at = (i: number): string => String(cells[i] ?? '');
  if (cols.optOut.some((i) => isOptOutMark(at(i)))) return 'no';
  if (cols.scan.some((i) => isOptOutWord(at(i)))) return 'no';
  if (cols.optIn.length > 0) return cols.optIn.every((i) => isYes(at(i))) ? 'yes' : 'no';
  return 'unset';
}

// ---------------------------------------------------------------------------------------------------------------------
// Optional columns: an unusable value is dropped so that an otherwise valid customer still imports (R6-07)

// The server's own e-mail check (shared/importEngine.js EMAIL_RE): a non-empty address that fails it makes the whole row an error there.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOf = (v: string): string => (EMAIL_RE.test(v) ? v : '');

// The values the server reads as a language (shared/localization/languageDetect.js); anything else is an error there.
const LANGUAGE_VALUES = new Map<string, 'ar' | 'en'>([
  ['ar', 'ar'], ['arabic', 'ar'], ['ara', 'ar'], ['ar-sa', 'ar'], ['ar_sa', 'ar'], ['arabe', 'ar'], // i18n-ignore
  ['عربي', 'ar'], ['عربى', 'ar'], ['العربية', 'ar'], ['العربيه', 'ar'], ['عربية', 'ar'], ['عربيه', 'ar'], // i18n-ignore
  ['en', 'en'], ['english', 'en'], ['eng', 'en'], ['en-us', 'en'], ['en_us', 'en'], ['en-gb', 'en'], ['en_gb', 'en'], // i18n-ignore
  ['انجليزي', 'en'], ['إنجليزي', 'en'], ['انجليزى', 'en'], ['الانجليزية', 'en'], ['الإنجليزية', 'en'], ['انجليزية', 'en'], ['إنجليزية', 'en'], // i18n-ignore
]);

/** 'ar' / 'en' for a language the server understands, '' for an empty or unknown value (the customer is added without a language). */
function languageOf(v: string): string {
  const key = v.trim().toLowerCase().replace(/\s+/g, ' ');
  const loose = key.replace(/[\u{622}\u{623}\u{625}]/gu, String.fromCodePoint(0x627)).replace(/\u{649}/gu, String.fromCodePoint(0x64a));
  return LANGUAGE_VALUES.get(key) ?? LANGUAGE_VALUES.get(loose) ?? '';
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables -> customers

const blank = (cells: string[]): boolean => cells.every((c) => String(c ?? '').trim() === '');
const clean = (v: unknown): string => String(v ?? '').trim();
const hasBreak = (v: string): boolean => /[\r\n]/.test(v);
/** One line of a record that could not be read, for the skipped-rows file: no line breaks, at most 200 characters. */
const flat = (v: string): string => {
  const t = v.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 199)}...` : t;
};
const lineCount = (v: string): number => v.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').length || 1;
/** How many lines of the file a parsed record took: 1 plus the line breaks inside its cells. */
const physicalLines = (cells: string[]): number => 1 + cells.reduce((n, c) => n + (String(c ?? '').match(/\r\n|\r|\n/g)?.length ?? 0), 0);

/** A parsed table (first row = header) -> rows to import, rows that cannot be, and what the file contains. */
export function parseCustomerTable(table: string[][], opts: ParseOptions = {}): ParsedCustomers {
  const [head, ...body] = table;
  if (!head) return { ...emptyParsed(), issue: 'no_rows' };
  const cols = classifyHeaders(head);
  const base: ParsedCustomers = {
    ...emptyParsed(),
    hasOptInColumn: cols.optIn.length > 0,
    hasLanguageColumn: cols.language >= 0,
    unknownConsentColumns: cols.consent.map((i) => headerLabel(head[i])),
    optOutColumns: cols.optOut.map((i) => headerLabel(head[i])),
  };
  const data = body.filter((r) => !blank(r));
  if (data.length === 0) return { ...base, issue: 'no_rows' };
  if (data.length > MAX_IMPORT_ROWS) return { ...base, issue: 'too_many' };
  if (cols.phone < 0) return { ...base, issue: 'no_phone_column' };
  if (cols.name < 0 && cols.first < 0) return { ...base, issue: 'no_name_column' };

  const rows: CustomerRow[] = [];
  const rejected: RejectedRow[] = [];
  let unreadable = 0;
  for (const cells of data) {
    const at = (i: number): string => (i >= 0 ? clean(cells[i]) : '');
    const name = cols.name >= 0 ? at(cols.name) : [at(cols.first), at(cols.last)].filter(Boolean).join(' ');
    const phone = at(cols.phone);
    const common = { name, phone, email: at(cols.email), notes: at(cols.notes), language: at(cols.language) };
    if (hasBreak(name) || hasBreak(phone)) {
      // a name or a number never holds a line break: a quote swallowed lines of the file into this row
      rejected.push({ name: flat(cells.join(', ')), phone: '', email: '', notes: '', language: '', reason: 'unreadable' });
      unreadable += physicalLines(cells);
      continue;
    }
    if (!name) {
      rejected.push({ ...common, reason: 'missing_name' });
      continue;
    }
    if (!phone) {
      rejected.push({ ...common, reason: 'missing_phone' });
      continue;
    }
    const number = normalizePhone(phone, opts.country);
    if (!number.ok) {
      rejected.push({ ...common, reason: number.reason === 'country_code_needed' ? 'country_code_needed' : 'invalid_phone' });
      continue;
    }
    rows.push({
      name, phone: number.withPlus, digits: number.e164Digits, email: emailOf(common.email), notes: common.notes, language: languageOf(common.language),
      optIn: optInOf(cells, cols), source: at(cols.source), date: at(cols.date),
    });
  }
  for (const line of opts.unreadable ?? []) {
    rejected.push({ name: flat(line), phone: '', email: '', notes: '', language: '', reason: 'unreadable' });
    unreadable += lineCount(line);
  }
  return { ...base, rows, rejected, unreadable };
}

/** Text of an uploaded `.csv` / `.txt` file. */
export function parseCustomerFileText(text: string, opts: ParseOptions = {}): ParsedCustomers {
  const { rows, unreadable } = parseCsvDetailed(text);
  return parseCustomerTable(rows, { ...opts, unreadable });
}

function pasteDelimiter(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  if (line.includes(ARABIC_SEMICOLON)) return ARABIC_SEMICOLON;
  if (line.includes(ARABIC_COMMA)) return ARABIC_COMMA;
  return ',';
}

const PHONE_LIKE = /^\+?[\d\u{660}-\u{669}\u{6F0}-\u{6F9}\s().-]{6,}$/u;
const TRAILING_PHONE = /^(.*?)\s+(\+?[\d\u{660}-\u{669}\u{6F0}-\u{6F9}][\d\u{660}-\u{669}\u{6F0}-\u{6F9}\s().-]{5,})$/u;

/**
 * Pasted lines: `name, phone` / `name; phone` / tab, with an OPTIONAL third value for the permission: yes (same words as a file's opt-in
 * column) is a yes, anything else that is not empty is a no, empty (or no third value) says nothing. Lines without a name or a usable
 * phone become "can't add" rows; a line whose quote is never closed is a line that could not be read.
 */
export function parsePasteText(text: string, opts: ParseOptions = {}): ParsedCustomers {
  const lines = String(text ?? '').split(/\r\n|\r|\n/).map((l) => stripBom(l)).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { ...emptyParsed(), issue: 'no_rows' };
  // A first line that is a header (Name, Phone) is not a customer.
  const firstParts = parseCsvText(lines[0], pasteDelimiter(lines[0]))[0] ?? [];
  const hasHeader = firstParts.length >= 2 && NAME_ALIASES.has(norm(firstParts[0])) && PHONE_ALIASES.has(norm(firstParts[1]));
  const body = hasHeader ? lines.slice(1) : lines;
  if (body.length === 0) return { ...emptyParsed(), issue: 'no_rows' };
  if (body.length > MAX_IMPORT_ROWS) return { ...emptyParsed(), issue: 'too_many' };
  const out = emptyParsed();
  for (const line of body) {
    const read = parseCsvDetailed(line, pasteDelimiter(line));
    if (read.unreadable.length > 0) {
      out.rejected.push({ name: flat(line), phone: '', email: '', notes: '', language: '', reason: 'unreadable' });
      out.unreadable++;
      continue;
    }
    const parts = (read.rows[0] ?? []).map(clean);
    let name = '';
    let phone = '';
    let optIn: OptIn = 'unset';
    if (parts.length >= 2) {
      name = parts[0];
      phone = parts[1];
      const third = parts[2] ?? '';
      if (third !== '') optIn = isYes(third) ? 'yes' : 'no';
    } else {
      const only = parts[0] ?? '';
      const m = TRAILING_PHONE.exec(only);
      if (m) {
        name = m[1].trim();
        phone = m[2].trim();
      } else if (PHONE_LIKE.test(only)) phone = only;
      else name = only;
    }
    const common = { name, phone, email: '', notes: '', language: '' };
    if (!name) {
      out.rejected.push({ ...common, reason: 'missing_name' });
      continue;
    }
    if (!phone) {
      out.rejected.push({ ...common, reason: 'missing_phone' });
      continue;
    }
    const number = normalizePhone(phone, opts.country);
    if (!number.ok) {
      out.rejected.push({ ...common, reason: number.reason === 'country_code_needed' ? 'country_code_needed' : 'invalid_phone' });
      continue;
    }
    out.rows.push({ ...common, phone: number.withPlus, digits: number.e164Digits, optIn, source: '', date: '' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The opt-in split (compliance, DF 3.7 / OD4)

export interface SplitResult {
  /** Rows of the job uploaded with marketingConsentAttested = true. */
  attested: CustomerRow[];
  /** Every other row: imported, no marketing consent. */
  plain: CustomerRow[];
  /** Rows kept out of the attested job only because another row of the same person is not a clear yes. */
  conflicting: number;
  /** Rows whose number already appeared earlier in the list. */
  repeated: number;
}

/**
 * Splits the rows into at most two import jobs (the engine only has a file-level consent flag):
 *  - the attested job exists ONLY when the merchant ticked the attestation (`attest === true`) AND chose to confirm: 'rows' = the rows
 *    that are a clear yes in the file, 'all' = those plus the rows nobody marked as no;
 *  - every other row goes to the plain job: imported, no marketing consent. A row marked no, or an unclear answer, is ALWAYS here;
 *  - the rows of one person (same last 9 digits) are decided together: unless every one of them is eligible, none goes to the attested
 *    job (a collision can only withhold consent, never grant it).
 * `attest` is never defaulted to true by any caller; with `attest === false` nothing can end up attested.
 */
export function splitByOptIn(rows: CustomerRow[], opts: { consent: ConsentMode; attest: boolean }): SplitResult {
  const attest = opts.attest === true && opts.consent !== 'none';
  const eligible = (r: CustomerRow): boolean => attest && (r.optIn === 'yes' || (opts.consent === 'all' && r.optIn === 'unset'));
  const groups = new Map<string, { size: number; ok: number }>();
  const seen = new Set<string>();
  let repeated = 0;
  for (const r of rows) {
    const key = phoneKey(r.digits);
    const g = groups.get(key) ?? { size: 0, ok: 0 };
    g.size++;
    if (eligible(r)) g.ok++;
    groups.set(key, g);
    if (seen.has(r.digits)) repeated++;
    else seen.add(r.digits);
  }
  const attested: CustomerRow[] = [];
  const plain: CustomerRow[] = [];
  let conflicting = 0;
  for (const r of rows) {
    const g = groups.get(phoneKey(r.digits)) ?? { size: 1, ok: 0 };
    if (g.ok > 0 && g.ok < g.size) conflicting++;
    if (eligible(r) && g.ok === g.size) attested.push(r);
    else plain.push(r);
  }
  return { attested, plain, conflicting, repeated };
}

/**
 * The Notes cell of a row: the merchant's notes plus "Opted in: <source>, <date>". The opt-in line is written ONLY for a row of the
 * attested job (a row added without permission never claims one) and only from the opt-in-named source / date columns.
 */
export function notesFor(row: CustomerRow, attested = false): string {
  const info = attested ? [row.source, row.date].filter(Boolean).join(', ') : '';
  return [row.notes, info ? `${NOTES_OPT_IN_PREFIX}${info}` : ''].filter(Boolean).join('; ');
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV out: the import job file, the template, the skipped-rows download

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/**
 * The file uploaded to POST /imports for one job: canonical headers the engine auto-maps (Name, Phone, Email, Notes[, Language]).
 * The Phone cell is "+<digits>": the engine keeps a number with a leading plus as it is, so it can never be read as a Saudi number.
 */
export function buildJobCsv(rows: CustomerRow[], withLanguage: boolean, attested = false): string {
  const lang = withLanguage && rows.some((r) => r.language);
  const header = ['Name', 'Phone', 'Email', 'Notes', ...(lang ? ['Language'] : [])];
  return toCsv(header, rows.map((r) => [r.name, r.phone, r.email, notesFor(r, attested), ...(lang ? [r.language] : [])]));
}

/**
 * The downloadable template (client-generated): the header row ONLY. A sample customer in the file would import as a real,
 * opted-in customer if it were left untouched (ruling 3), so no data row is ever written here. Language only for workspaces
 * with Arabic on (the engine maps it only then). The header cells are CSV data, not UI text.
 */
export function buildCustomerTemplateCsv(withLanguage: boolean): string {
  const header = ['Name', 'Phone', 'Opted in (yes/no)', 'Opt-in source', 'Opt-in date', 'Email', 'Notes', ...(withLanguage ? ['Language (en/ar)'] : [])]; // i18n-ignore
  return toCsv(header, []);
}

// A cell that starts with = + - @ tab or CR is a formula to a spreadsheet (R6-08). In the skipped-rows file such a cell gets a leading
// apostrophe, EXCEPT a phone number in the Phone column (a prefixed "+966..." would be read as a local number when the file comes back).
const FORMULA_START = /^[=+\-@\t\r]/;
const PHONE_SHAPE = /^\+?[\s().-]*[\d\u{660}-\u{669}\u{6F0}-\u{6F9}][\d\u{660}-\u{669}\u{6F0}-\u{6F9}\s().-]*$/u;

function guardCell(v: unknown, phoneColumn: boolean): string {
  const s = v === undefined || v === null ? '' : String(v);
  if (!FORMULA_START.test(s)) return s;
  if (phoneColumn && PHONE_SHAPE.test(s)) return s;
  return `'${s}`;
}

/**
 * One CSV for every skipped row: the engine's error reports (one per job: our header + Reason) and the rows rejected on this
 * side, with a single Reason column. `reasonOf` supplies the (localised) reason text of a client-side rejection. Formula guard:
 * guardCell on every cell (the import job files are NOT touched: toCsv is unchanged).
 */
export function mergeErrorReports(serverReports: string[], rejected: RejectedRow[], reasonOf: (r: RejectReason) => string): string {
  const REASON = 'Reason';
  const PHONE = 'Phone';
  const headers: string[] = [];
  const addHeader = (h: string): void => {
    if (h && h !== REASON && !headers.includes(h)) headers.push(h);
  };
  const parsed = serverReports.map((text) => parseCsvText(text, ','));
  for (const t of parsed) (t[0] ?? []).forEach(addHeader);
  for (const h of ['Name', 'Phone', 'Email', 'Notes']) addHeader(h);
  if (rejected.some((r) => r.language)) addHeader('Language');
  const out: string[][] = [];
  const line = (cells: unknown[]): string[] => [...cells.slice(0, headers.length).map((c, i) => guardCell(c, headers[i] === PHONE)), guardCell(cells[headers.length], false)];
  for (const t of parsed) {
    const [head, ...body] = t;
    if (!head) continue;
    const reasonAt = head.lastIndexOf(REASON);
    for (const cells of body) {
      out.push(line([...headers.map((h) => {
        const i = head.indexOf(h);
        return i >= 0 && i !== reasonAt ? cells[i] ?? '' : '';
      }), reasonAt >= 0 ? cells[reasonAt] ?? '' : '']));
    }
  }
  for (const r of rejected) {
    const byHeader: Record<string, string> = { Name: r.name, Phone: r.phone, Email: r.email, Notes: r.notes, Language: r.language };
    out.push(line([...headers.map((h) => byHeader[h] ?? ''), reasonOf(r.reason)]));
  }
  return toCsv([...headers, REASON].map((h) => guardCell(h, false)), out);
}

/** Text of a downloaded Blob (the engine's error report). */
export function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** Bytes of a chosen file (works where `Blob.arrayBuffer` is missing). */
export function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

/** The CSV as a File for POST /imports (UTF-8 with a BOM so the engine decodes Arabic text correctly). */
export function csvFile(text: string, name: string): File {
  return new File([BOM + text], name, { type: 'text/csv' });
}

/** Saves a Blob through a temporary link (the `downloadBlob` pattern of the full import page). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Saves CSV text (with a BOM so Excel opens Arabic text correctly). */
export function downloadCsv(text: string, filename: string): void {
  downloadBlob(new Blob([BOM + text], { type: 'text/csv;charset=utf-8' }), filename);
}
