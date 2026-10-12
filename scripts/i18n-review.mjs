#!/usr/bin/env node
// Native-review CLI for the FRONTEND Arabic catalogues (spec §8): export every Arabic
// string to a CSV the owner's partner reviews in a spreadsheet, import it back, and
// refresh the review counts the hub's Review tab reads.
//
//   node scripts/i18n-review.mjs export --out review.csv [--only-unreviewed] [--namespace hub]
//   node scripts/i18n-review.mjs import --in review.csv [--dry-run] [--strict] [--reviewer "Name"]
//   node scripts/i18n-review.mjs summary [--write]
//
// Reads/writes src/app/i18n/catalogs/{en,ar,meta}/<ns>.json; only ar/ and meta/ are
// ever written. All logic is in scripts/lib/i18n-review-core.mjs; this file is I/O only.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState, exportCsv, planImport, applyUpdates, summarize, summaryJson } from './lib/i18n-review-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGS = join(ROOT, 'src', 'app', 'i18n', 'catalogs');
const SUMMARY_FILE = join(ROOT, 'src', 'app', 'i18n', 'review-summary.json');
const FLAGS = new Set(['only-unreviewed', 'dry-run', 'strict', 'write']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const name = a.slice(2);
    if (FLAGS.has(name)) args[name] = true;
    else { args[name] = argv[i + 1]; i += 1; }
  }
  return args;
}

function readFiles() {
  const files = {};
  for (const f of readdirSync(join(CATALOGS, 'en')).filter((n) => n.endsWith('.json'))) {
    const ns = f.slice(0, -'.json'.length);
    for (const dir of ['en', 'ar', 'meta']) {
      const p = join(CATALOGS, dir, f);
      if (existsSync(p)) files[`${dir}/${ns}`] = readFileSync(p, 'utf8');
    }
  }
  return files;
}

function need(args, name) {
  if (!args[name]) { console.error(`Missing --${name}`); process.exit(2); }
  return args[name];
}

function runExport(args) {
  const { csv, count } = exportCsv(buildState(readFiles()), { onlyUnreviewed: !!args['only-unreviewed'], namespace: args.namespace || null });
  writeFileSync(resolve(need(args, 'out')), csv, 'utf8');
  console.log(`Exported ${count} string(s) to ${args.out}`);
  return 0;
}

function decodeCsv(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1256').decode(buffer); }
}

function runImport(args) {
  const files = readFiles();
  const plan = planImport(decodeCsv(readFileSync(resolve(need(args, 'in')))), buildState(files), { reviewer: args.reviewer, strict: !!args.strict });
  for (const r of plan.results) {
    if (r.outcome === 'rejected') console.error(`REJECTED line ${r.line} ${r.key || '(no key)'}: ${r.reasons.join('; ')}`);
    else if (r.notes.length) console.log(`note ${r.key}: ${r.notes.join('; ')}`);
  }
  const s = plan.summary;
  console.log(`updated ${s.updated}, unchanged ${s.unchanged}, rejected ${s.rejected}${s.blockedByStrict ? ` (strict: ${s.blockedByStrict} valid row(s) not applied)` : ''}`);
  if (s.reviewedWithEdits.length) console.log(`reviewed with edited text: ${s.reviewedWithEdits.join(', ')}`);
  if (args['dry-run']) {
    console.log('dry run: nothing written');
  } else if (plan.updates.length) {
    const written = applyUpdates(files, plan.updates);
    let count = 0;
    for (const [name, text] of Object.entries(written)) {
      if (files[name] === text) continue;
      writeFileSync(join(CATALOGS, `${name}.json`), text, 'utf8');
      count += 1;
    }
    console.log(`wrote ${count} file(s)`);
  }
  return s.rejected ? 1 : 0;
}

function runSummary(args) {
  const state = buildState(readFiles());
  const { totals, namespaces } = summarize(state);
  for (const [ns, c] of Object.entries(namespaces)) console.log(`${ns.padEnd(12)} total ${c.total}  arabic ${c.arabic}  reviewed ${c.reviewed}  draft ${c.draft}  missing ${c.missing}  needsLegal ${c.needsLegal}`);
  console.log(`TOTAL        total ${totals.total}  arabic ${totals.arabic}  reviewed ${totals.reviewed}  draft ${totals.draft}  missing ${totals.missing}  needsLegal ${totals.needsLegal}`);
  if (args.write) {
    const text = summaryJson(state);
    if (!existsSync(SUMMARY_FILE) || readFileSync(SUMMARY_FILE, 'utf8') !== text) writeFileSync(SUMMARY_FILE, text, 'utf8');
    console.log('review-summary.json up to date');
  }
  return 0;
}

const commands = { export: runExport, import: runImport, summary: runSummary };
const args = parseArgs(process.argv.slice(2));
const run = commands[args._[0]];
if (!run) {
  console.error('Usage: i18n-review.mjs export|import|summary (see the header of this file)');
  process.exit(2);
}
try {
  process.exitCode = run(args);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 2;
}
