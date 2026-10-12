// Pure core of the native-review workflow for the FRONTEND catalogues (spec §8):
// export every Arabic string to a spreadsheet-friendly CSV, validate and import the
// reviewer's edits back, and count review state per namespace. No disk access here —
// scripts/i18n-review.mjs does the I/O; tests feed in-memory file maps.
//
// Files (keys are "<ns>.<key>", ns = file name):
//   en/<ns>.json    { key: english }     never written
//   ar/<ns>.json    { key: arabic }      written (text edits; keys are never deleted)
//   meta/<ns>.json  { key: { status, reviewer, reviewedAt, needsLegalApproval? } }
//                   keys absent => draft (see src/app/i18n/README.md)
//
// Safety rules (the text ends up in the UI of Arabic merchants):
//  * Edited/machine text is never silently "reviewed": if the Arabic CHANGED and the
//    row does not explicitly say `reviewed`, the string becomes `draft`. `reviewed`
//    needs a reviewer name and a date; reviewed + changed text is accepted (the
//    reviewer's edit IS the review) and listed in the summary.
//  * Placeholders `{x}` identical to English, no invisible/bidi control characters,
//    no Arabic-Indic digits, no leading/trailing spaces, tanween as alef + fathatan.

export const COLUMNS = ['key', 'english', 'arabic', 'status', 'reviewer', 'reviewed_at', 'needs_legal', 'notes'];
const STATUSES = ['draft', 'reviewed'];
const BOM = '\u{FEFF}';

const INVISIBLES = /[\u{00AD}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/u;
const ARABIC_INDIC_DIGITS = /[\u{0660}-\u{0669}\u{06F0}-\u{06F9}]/u;
const REVERSED_TANWEEN = /\u{064B}\u{0627}/gu; // fathatan then alef -> alef then fathatan
const ALEF_FATHATAN = String.fromCodePoint(0x0627, 0x064b);
const PLACEHOLDER = /\{[^{}\s]+\}/g;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const placeholders = (text) => (String(text).match(PLACEHOLDER) || []).sort();
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- CSV (RFC 4180 + Excel quirks: BOM, CRLF, ; or tab delimiters) ------------------

function detectDelimiter(text) {
  const firstLine = text.split(/\r\n|\n|\r/)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseRows(input) {
  const text = String(input).replace(/^\u{FEFF}/u, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cellText = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cellText += '"'; i += 1; } else if (c === '"') quoted = false;
      else cellText += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cellText); cellText = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cellText); rows.push(row); row = []; cellText = '';
    } else cellText += c;
  }
  if (cellText !== '' || row.length) { row.push(cellText); rows.push(row); }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  return rows.filter((r) => r.some((c) => c !== ''));
}

// Cells a spreadsheet could read as a formula get a leading quote.
const neutralize = (v) => (/^[=+\-@]/.test(v) && !/^[+-]?\d/.test(v) ? `'${v}` : v);
const unneutralize = (v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
const quote = (v) => (/["\r\n,;\t]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function stringifyCsv(rows) {
  return `${BOM}${rows.map((r) => r.map((c) => quote(neutralize(c == null ? '' : String(c)))).join(',')).join('\r\n')}\r\n`;
}

function parseCsv(input) {
  const raw = parseRows(input);
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map((h) => h.trim().toLowerCase());
  const rows = raw.slice(1).map((cells, idx) => {
    const obj = { _line: idx + 2 };
    headers.forEach((h, k) => { if (h) obj[h] = cells[k] === undefined ? '' : cells[k]; });
    return obj;
  });
  return { headers, rows };
}

// ---- state ------------------------------------------------------------------------------

function readJson(files, name) {
  if (!has(files, name)) return {};
  const data = JSON.parse(files[name]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${name} is not a JSON object`);
  return data;
}

export function namespacesOf(files) {
  return Object.keys(files).filter((f) => f.startsWith('en/')).map((f) => f.slice(3)).sort();
}

// files: { 'en/<ns>': text, 'ar/<ns>': text, 'meta/<ns>': text } -> Map(key -> entry), ordered by (ns, key).
export function buildState(files) {
  const state = new Map();
  for (const ns of namespacesOf(files)) {
    const en = readJson(files, `en/${ns}`);
    const ar = readJson(files, `ar/${ns}`);
    const meta = readJson(files, `meta/${ns}`);
    for (const key of Object.keys(en).sort()) {
      const m = has(meta, key) && meta[key] ? meta[key] : {};
      const arabic = has(ar, key) && typeof ar[key] === 'string' ? ar[key] : '';
      state.set(`${ns}.${key}`, {
        key: `${ns}.${key}`,
        namespace: ns,
        bareKey: key,
        english: String(en[key]),
        arabic,
        status: arabic && m.status === 'reviewed' ? 'reviewed' : 'draft',
        reviewer: m.reviewer || null,
        reviewedAt: m.reviewedAt || null,
        needsLegal: !!m.needsLegalApproval,
        notes: typeof m.notes === 'string' ? m.notes : '',
      });
    }
  }
  return state;
}

const sortedEntries = (state) => Array.from(state.values()).sort((a, b) => compare(a.namespace, b.namespace) || compare(a.bareKey, b.bareKey));

// ---- summary ----------------------------------------------------------------------------

const emptyCounts = () => ({ total: 0, arabic: 0, reviewed: 0, draft: 0, missing: 0, needsLegal: 0 });

export function summarize(state) {
  const namespaces = {};
  const totals = emptyCounts();
  for (const e of sortedEntries(state)) {
    const c = namespaces[e.namespace] || (namespaces[e.namespace] = emptyCounts());
    for (const target of [c, totals]) {
      target.total += 1;
      if (!e.arabic) target.missing += 1;
      else if (e.status === 'reviewed') { target.arabic += 1; target.reviewed += 1; } else {
        target.arabic += 1; target.draft += 1;
        if (e.needsLegal) target.needsLegal += 1;
      }
    }
  }
  return { namespaces, totals };
}

// Stable text for review-summary.json: sorted keys, 2 spaces, trailing newline, no timestamps.
export function summaryJson(state) {
  return `${JSON.stringify(summarize(state), null, 2)}\n`;
}

// ---- export -----------------------------------------------------------------------------

export function exportCsv(state, { onlyUnreviewed = false, namespace = null } = {}) {
  const rows = [COLUMNS];
  for (const e of sortedEntries(state)) {
    if (namespace && e.namespace !== namespace) continue;
    if (onlyUnreviewed && e.status === 'reviewed') continue;
    rows.push([e.key, e.english, e.arabic, e.arabic ? e.status : 'draft', e.reviewer || '', e.reviewedAt || '', e.needsLegal ? 'yes' : '', e.notes]);
  }
  return { csv: stringifyCsv(rows), count: rows.length - 1 };
}

// ---- import -----------------------------------------------------------------------------

function toIso(value) {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return null;
  const d = new Date(/T/.test(s) ? s : `${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function textProblems(arabic, english) {
  const problems = [];
  if (INVISIBLES.test(arabic)) problems.push('contains invisible/bidi control characters');
  if (ARABIC_INDIC_DIGITS.test(arabic)) problems.push('contains Arabic-Indic digits (use 0-9)');
  if (arabic !== arabic.trim()) problems.push('has leading or trailing spaces');
  if (!sameList(placeholders(arabic), placeholders(english))) {
    problems.push(`placeholders differ from English (expected ${placeholders(english).join(' ') || 'none'})`);
  }
  if (english.length >= 12 && (arabic.length > english.length * 3 + 20 || arabic.length * 4 < english.length)) {
    problems.push('length is implausible compared with the English');
  }
  return problems;
}

const cell = (v) => unneutralize(v === undefined ? '' : v).replace(/\r\n?/g, '\n');

function decideRow(row, stored, opts) {
  const reasons = [];
  const notes = [];
  const rawArabic = cell(row.arabic);
  const arabic = rawArabic.replace(REVERSED_TANWEEN, ALEF_FATHATAN);
  if (arabic !== rawArabic) notes.push('tanween normalised to alef + fathatan');
  const statusCell = String(row.status || '').trim().toLowerCase();
  const english = cell(row.english);
  if (english && english !== stored.english) notes.push('English column differs from the source and was ignored');
  if (statusCell && !STATUSES.includes(statusCell)) reasons.push(`status must be draft or reviewed (got "${statusCell}")`);

  const changed = arabic !== stored.arabic;
  if (!arabic && stored.arabic) reasons.push('Arabic cell is empty (keys are never erased)');
  if (arabic && (changed || statusCell === 'reviewed')) reasons.push(...textProblems(arabic, stored.english));

  let status = stored.status;
  if (statusCell === 'reviewed') status = 'reviewed';
  else if (changed || statusCell === 'draft') status = 'draft';

  let reviewer = null;
  let reviewedAt = null;
  if (status === 'reviewed') {
    if (!arabic) reasons.push('cannot mark an empty Arabic string as reviewed');
    reviewer = String(row.reviewer || '').trim() || String(opts.reviewer || '').trim()
      || (!changed && stored.status === 'reviewed' ? stored.reviewer : null);
    if (!reviewer) reasons.push('reviewed needs a reviewer name (reviewer column or --reviewer)');
    const given = String(row.reviewed_at || '').trim();
    reviewedAt = given ? toIso(given) : (!changed && stored.status === 'reviewed' && stored.reviewedAt)
      || toIso(opts.today || new Date().toISOString().slice(0, 10));
    if (!reviewedAt) reasons.push('reviewed_at must be an ISO date (YYYY-MM-DD)');
    if (stored.needsLegal) notes.push("flagged needsLegalApproval: also needs the owner's lawyer");
    if (changed && stored.arabic) notes.push('reviewed with edited text (reviewer edit accepted)');
  }
  const next = { arabic, status, reviewer, reviewedAt };
  const unchanged = arabic === stored.arabic && status === stored.status
    && (reviewer || null) === (stored.reviewer || null) && (reviewedAt || null) === (stored.reviewedAt || null);
  return { reasons, notes, next, unchanged, textChanged: changed };
}

// csvText -> { results[], updates[], summary }. `updates` hold only accepted, really
// changing rows; strict:true empties them when ANY row is rejected (all-or-nothing).
export function planImport(csvText, state, opts = {}) {
  const { headers, rows } = parseCsv(csvText);
  for (const need of ['key', 'arabic']) {
    if (!headers.includes(need)) throw new Error(`CSV is missing the "${need}" column`);
  }
  const seen = new Set();
  const results = [];
  const updates = [];
  for (const row of rows) {
    const key = cell(row.key).trim();
    if (!key && !String(row.arabic || '').trim()) continue; // blank spreadsheet line
    const res = { key, line: row._line, outcome: 'rejected', reasons: [], notes: [] };
    results.push(res);
    if (!state.has(key)) { res.reasons.push('unknown key'); continue; }
    if (seen.has(key)) { res.reasons.push('duplicate key in the file'); continue; }
    seen.add(key);
    const d = decideRow(row, state.get(key), opts);
    res.reasons = d.reasons;
    res.notes = d.notes;
    if (d.reasons.length) continue;
    if (d.unchanged) { res.outcome = 'unchanged'; continue; }
    res.outcome = 'updated';
    res.reviewedWithEdit = d.textChanged && d.next.status === 'reviewed';
    updates.push({ key, ...d.next });
  }
  const rejected = results.filter((r) => r.outcome === 'rejected').length;
  const blocked = !!opts.strict && rejected > 0;
  return {
    results,
    updates: blocked ? [] : updates,
    summary: {
      updated: blocked ? 0 : updates.length,
      unchanged: results.filter((r) => r.outcome === 'unchanged').length,
      rejected,
      blockedByStrict: blocked ? updates.length : 0,
      reviewedWithEdits: results.filter((r) => r.reviewedWithEdit).map((r) => r.key),
    },
  };
}

// ---- apply ------------------------------------------------------------------------------

const toText = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// files + accepted updates -> { 'ar/<ns>': text, 'meta/<ns>': text } for changed files only.
// Existing key order is preserved; new keys are appended; `en` is never written.
export function applyUpdates(files, updates) {
  const parsed = {};
  const load = (name) => parsed[name] || (parsed[name] = readJson(files, name));
  for (const u of updates) {
    const dot = u.key.indexOf('.');
    const ns = u.key.slice(0, dot);
    const key = u.key.slice(dot + 1);
    if (dot < 0 || !has(files, `en/${ns}`) || !has(readJson(files, `en/${ns}`), key)) throw new Error(`unknown key ${u.key}`);
    load(`ar/${ns}`)[key] = u.arabic;
    const meta = load(`meta/${ns}`);
    const current = has(meta, key) && meta[key] ? meta[key] : null;
    if (u.status === 'reviewed') {
      meta[key] = { ...(current || {}), status: 'reviewed', reviewer: u.reviewer, reviewedAt: u.reviewedAt };
    } else if (current) {
      const { reviewer, reviewedAt, ...rest } = current;
      meta[key] = { ...rest, status: 'draft' };
    }
  }
  const out = {};
  for (const name of Object.keys(parsed)) out[name] = toText(parsed[name]);
  return out;
}
