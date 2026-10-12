// Run with: node --test scripts/i18n-review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildState, exportCsv, planImport, applyUpdates, summarize, summaryJson, parseRows, stringifyCsv, COLUMNS } from './lib/i18n-review-core.mjs';

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const cp = (...codes) => String.fromCodePoint(...codes);
const FILES = () => ({
  'en/hub': json({ title: 'Hello {name}, welcome', save: 'Save changes now', extra: 'Not translated yet' }),
  'ar/hub': json({ title: 'مرحباً {name}، أهلاً بك', save: 'حفظ التغييرات الآن' }),
  'meta/hub': json({ save: { status: 'reviewed', reviewer: 'Sara', reviewedAt: '2026-01-02T00:00:00.000Z' }, title: { status: 'draft', needsLegalApproval: true } }),
  'en/aa': json({ one: 'Please confirm the action' }),
  'ar/aa': json({}),
  'meta/aa': json({}),
});
const state = () => buildState(FILES());
const csvOf = (rows) => stringifyCsv([['key', 'english', 'arabic', 'status', 'reviewer', 'reviewed_at'], ...rows]);
const plan = (rows, opts) => planImport(csvOf(rows), state(), { today: '2026-05-05', ...opts });
const rejectReason = (arabic, key = 'hub.save', status = 'reviewed') => {
  const p = plan([[key, '', arabic, status, 'Huda', '']]);
  return p.results[0].reasons.join(' | ');
};

test('export: BOM, CRLF, columns, deterministic order, missing = draft', () => {
  const { csv, count } = exportCsv(state());
  assert.ok(csv.startsWith('\u{FEFF}') && csv.includes('\r\n'));
  assert.equal(count, 4);
  const rows = parseRows(csv);
  assert.deepEqual(rows[0], COLUMNS);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['aa.one', 'hub.extra', 'hub.save', 'hub.title']);
  assert.equal(rows.find((r) => r[0] === 'hub.extra')[3], 'draft');
  assert.equal(rows.find((r) => r[0] === 'hub.title')[6], 'yes');
  assert.equal(exportCsv(state()).csv, csv);
});

test('export: Arabic round-trips byte-exact; filters work; formulas neutralised', () => {
  const rows = parseRows(exportCsv(state()).csv);
  assert.equal(rows.find((r) => r[0] === 'hub.title')[2], 'مرحباً {name}، أهلاً بك');
  assert.deepEqual(parseRows(exportCsv(state(), { onlyUnreviewed: true }).csv).slice(1).map((r) => r[0]), ['aa.one', 'hub.extra', 'hub.title']);
  assert.equal(parseRows(exportCsv(state(), { namespace: 'aa' }).csv).length, 2);
  const s = buildState({ 'en/x': json({ k: '=1+1 is text' }), 'ar/x': json({ k: '=نص عربي طويل هنا' }), 'meta/x': json({}) });
  const { csv } = exportCsv(s);
  assert.ok(csv.includes("'="));
  assert.equal(planImport(csv, s).summary.unchanged, 1);
});

test('an untouched export re-imports with no changes', () => {
  const p = planImport(exportCsv(state()).csv, state());
  assert.deepEqual([p.summary.updated, p.summary.rejected, p.summary.unchanged], [0, 0, 4]);
});

test('semicolon + BOM files (Arabic-locale Excel) parse', () => {
  const csv = '\u{FEFF}key;english;arabic;status;reviewer;reviewed_at\r\naa.one;;يرجى تأكيد الإجراء;reviewed;Huda;\r\n';
  const p = planImport(csv, state(), { today: '2026-05-05' });
  assert.equal(p.updates[0].reviewer, 'Huda');
});

test('state machine: changed text => draft; reviewed+unchanged => status only; reviewed+changed => accepted and listed', () => {
  let p = plan([['hub.save', '', 'احفظ التغييرات الآن', '', '', '']]);
  assert.deepEqual(p.updates, [{ key: 'hub.save', arabic: 'احفظ التغييرات الآن', status: 'draft', reviewer: null, reviewedAt: null }]);
  p = plan([['hub.title', '', 'مرحباً {name}، أهلاً بك', 'Reviewed', 'Huda', '']]);
  assert.deepEqual(p.updates, [{ key: 'hub.title', arabic: 'مرحباً {name}، أهلاً بك', status: 'reviewed', reviewer: 'Huda', reviewedAt: '2026-05-05T00:00:00.000Z' }]);
  assert.deepEqual(p.summary.reviewedWithEdits, []);
  p = plan([['hub.title', '', 'أهلاً {name}، تفضل بالدخول', 'reviewed', 'Huda', '2026-04-01']]);
  assert.equal(p.updates[0].status, 'reviewed');
  assert.deepEqual(p.summary.reviewedWithEdits, ['hub.title']);
  assert.equal(plan([['hub.save', '', 'حفظ التغييرات الآن', 'reviewed', '', '']]).summary.unchanged, 1);
  assert.equal(plan([['hub.save', '', 'حفظ التغييرات الآن', '', '', '']]).summary.unchanged, 1);
  assert.equal(plan([['hub.save', '', 'حفظ التغييرات الآن', 'draft', '', '']]).updates[0].status, 'draft');
});

test('reviewer: column, --reviewer, or rejected; bad dates rejected', () => {
  assert.equal(plan([['aa.one', '', 'يرجى تأكيد الإجراء', 'reviewed', '', '']], { reviewer: 'Nour' }).updates[0].reviewer, 'Nour');
  assert.match(plan([['aa.one', '', 'يرجى تأكيد الإجراء', 'reviewed', '', '']]).results[0].reasons.join(), /reviewer name/);
  assert.match(plan([['aa.one', '', 'يرجى تأكيد الإجراء', 'reviewed', 'Huda', '12/05/2026']]).results[0].reasons.join(), /ISO date/);
});

test('validation: placeholders, invisibles, digits, spaces, length, empty, status, unknown/duplicate keys', () => {
  assert.match(rejectReason('مرحباً', 'hub.title'), /placeholders differ/);
  assert.match(rejectReason('مرحباً {nom}، أهلاً', 'hub.title'), /placeholders differ/);
  assert.equal(rejectReason('أهلاً بك يا {name}', 'hub.title'), '');
  for (const code of [0x200f, 0x200e, 0x202b, 0x2067, 0x200b, 0xfeff, 0xad]) {
    assert.match(rejectReason(`حفظ ${cp(code)}التغييرات الآن`), /invisible/);
  }
  assert.match(rejectReason(`حفظ التغييرات ${cp(0x0661)}`), /Arabic-Indic/);
  assert.match(rejectReason(`حفظ التغييرات ${cp(0x06f2)}`), /Arabic-Indic/);
  assert.match(rejectReason(' حفظ التغييرات الآن'), /leading or trailing/);
  assert.match(rejectReason('ح'), /length/);
  assert.match(rejectReason('', 'hub.extra'), /empty/);
  assert.match(rejectReason('', 'hub.save', 'draft'), /never erased/);
  assert.match(rejectReason('حفظ التغييرات الآن', 'hub.save', 'approved'), /draft or reviewed/);
  assert.match(rejectReason('نص', 'nope.key'), /unknown key/);
  assert.match(rejectReason('نص', '__proto__'), /unknown key/);
  const p = plan([['aa.one', '', 'يرجى تأكيد الإجراء الآن', '', '', ''], ['aa.one', '', 'يرجى تأكيد الإجراء', '', '', '']]);
  assert.match(p.results[1].reasons.join(), /duplicate/);
});

test('tanween: alef+fathatan canonicalised and noted; blank lines skipped; English edits ignored', () => {
  const wanted = 'شكراً جزيلاً لك على الزيارة';
  const reversed = wanted.split(cp(0x0627, 0x064b)).join(cp(0x064b, 0x0627));
  const p = plan([['hub.extra', 'Other English', reversed, '', '', ''], ['', '', '', '', '', '']]);
  assert.equal(p.results.length, 1);
  assert.equal(p.updates[0].arabic, wanted);
  assert.match(p.results[0].notes.join(), /tanween/);
  assert.match(p.results[0].notes.join(), /English/);
});

test('missing columns throw', () => {
  assert.throws(() => planImport('a,b\n1,2\n', state()), /key/);
});

test('strict is all-or-nothing', () => {
  const rows = [['aa.one', '', 'يرجى تأكيد الإجراء', 'reviewed', 'Huda', ''], ['nope.key', '', 'x', '', '', '']];
  assert.equal(plan(rows).summary.updated, 1);
  const s = plan(rows, { strict: true });
  assert.deepEqual(s.updates, []);
  assert.equal(s.summary.blockedByStrict, 1);
});

test('applyUpdates: ordering/format stable, en untouched, new keys appended, meta handled', () => {
  const files = FILES();
  const out = applyUpdates(files, [
    { key: 'hub.extra', arabic: 'لم تتم الترجمة بعد', status: 'draft', reviewer: null, reviewedAt: null },
    { key: 'hub.title', arabic: 'مرحباً {name}، أهلاً بك', status: 'reviewed', reviewer: 'Huda', reviewedAt: '2026-05-05T00:00:00.000Z' },
    { key: 'hub.save', arabic: 'احفظ التغييرات الآن', status: 'draft', reviewer: null, reviewedAt: null },
  ]);
  assert.deepEqual(Object.keys(out).sort(), ['ar/hub', 'meta/hub']);
  assert.deepEqual(Object.keys(JSON.parse(out['ar/hub'])), ['title', 'save', 'extra']);
  assert.ok(out['ar/hub'].endsWith('}\n') && out['ar/hub'].includes('\n  "title": '));
  const meta = JSON.parse(out['meta/hub']);
  assert.deepEqual(meta.title, { status: 'reviewed', reviewer: 'Huda', reviewedAt: '2026-05-05T00:00:00.000Z', needsLegalApproval: true });
  assert.deepEqual(meta.save, { status: 'draft' });
  assert.equal('extra' in meta, false);
  assert.equal(out['en/hub'], undefined);
  assert.throws(() => applyUpdates(FILES(), [{ key: 'hub.nope', arabic: 'x', status: 'draft' }]), /unknown key/);
  assert.deepEqual(applyUpdates(FILES(), []), {});
});

test('summary counts and stable JSON', () => {
  const s = summarize(state());
  assert.deepEqual(s.namespaces.hub, { total: 3, arabic: 2, reviewed: 1, draft: 1, missing: 1, needsLegal: 1 });
  assert.deepEqual(s.namespaces.aa, { total: 1, arabic: 0, reviewed: 0, draft: 0, missing: 1, needsLegal: 0 });
  assert.deepEqual(s.totals, { total: 4, arabic: 2, reviewed: 1, draft: 1, missing: 2, needsLegal: 1 });
  assert.equal(summaryJson(state()), summaryJson(state()));
  assert.deepEqual(Object.keys(JSON.parse(summaryJson(state())).namespaces), ['aa', 'hub']);
});

test('real catalogues: every ar key exists in en and placeholders match (read-only)', () => {
  const root = new URL('../src/app/i18n/catalogs/', import.meta.url);
  const files = {};
  for (const f of readdirSync(root.pathname.replace(/^\/([A-Za-z]:)/, '$1') + 'en').filter((n) => n.endsWith('.json'))) {
    const ns = f.slice(0, -5);
    for (const d of ['en', 'ar', 'meta']) files[`${d}/${ns}`] = readFileSync(new URL(`${d}/${f}`, root), 'utf8');
  }
  const s = buildState(files);
  assert.ok(s.size > 0);
  const { totals } = summarize(s);
  assert.equal(totals.total, totals.arabic + totals.missing);
});

test('CLI end to end on a temp copy: export, import dry-run writes nothing, import writes ar+meta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-review-'));
  const out = join(dir, 'r.csv');
  const run = (...a) => spawnSync(process.execPath, [new URL('./i18n-review.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...a], { encoding: 'utf8' });
  const exported = run('export', '--out', out, '--namespace', 'common');
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(readFileSync(out).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  const dry = run('import', '--in', out, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run/);
  writeFileSync(join(dir, 'bad.csv'), 'key,arabic\nnope.key,x\n');
  assert.equal(run('import', '--in', join(dir, 'bad.csv'), '--dry-run').status, 1);
});
