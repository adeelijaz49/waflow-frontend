#!/usr/bin/env node
// Fails the build when NEW code contains hard-coded user-facing text (spec
// Phase 0: "No hard-coded text in components or templates ... Add a check that
// fails the build on new hard-coded strings").
//
// Scope: only the folders listed in scripts/i18n-check.config.json (the
// localisation foundation and the new localisation pages). Existing English-only
// screens are deliberately out of scope until the gated Phase 5.
//
// What it flags
//   * .html templates (and inline `template:` in .ts): text nodes containing
//     letters that are not interpolations / Angular control flow, and literal
//     placeholder|title|alt|aria-label attributes.
//   * .ts: string-literal first arguments of dialog.error/success/confirm/info/
//     warning(...) and alert(...).
// Escape hatch: put <!-- i18n-ignore --> immediately before a text node, or
// add `// i18n-ignore` at the end of a TypeScript line.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-check.config.json'), 'utf8'));
const ALLOWED_WORDS = new Set((CONFIG.allowedWords || ['WaFlow']).map((w) => w.toLowerCase()));
const ATTRS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-placeholder', 'aria-description']);
const HAS_LETTER = /\p{L}/u;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (statSync(dir).isFile()) { out.push(dir); return out; }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name === 'node_modules' || name === 'catalogs') continue; walk(p, out); } else out.push(p);
  }
  return out;
}

function decodeEntities(s) {
  return s.replace(/&(nbsp|amp|lt|gt|quot|apos|times|hellip|middot|bull|rarr|larr|mdash|ndash|check|#\d+|#x[0-9a-f]+);/gi, ' ');
}

// Remove Angular syntax that is not text: {{ }} interpolation, @if/@for/... blocks, @let.
function stripAngularNoise(text) {
  return text
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/@let\s[^;]*;/g, ' ')
    .replace(/@(?:else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b[^{]*\{/g, ' ')
    .replace(/[{}]/g, ' ');
}

// Minimal HTML tokenizer that respects quotes inside tags (so `a > b` in a
// binding does not end the tag) and keeps line numbers.
function tokenize(html) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = html.length;
  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      const text = html.slice(i, stop);
      tokens.push({ type: 'comment', text, line });
      line += (text.match(/\n/g) || []).length;
      i = stop;
    } else if (html[i] === '<' && /[A-Za-z/!]/.test(html[i + 1] || '')) {
      let j = i + 1;
      let quote = null;
      while (j < n) {
        const c = html[j];
        if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
        j += 1;
      }
      const text = html.slice(i, j + 1);
      tokens.push({ type: 'tag', text, line });
      line += (text.match(/\n/g) || []).length;
      i = j + 1;
    } else {
      let j = i;
      while (j < n && !(html[j] === '<' && /[A-Za-z/!]/.test(html[j + 1] || ''))) j += 1;
      const text = html.slice(i, j);
      tokens.push({ type: 'text', text, line });
      line += (text.match(/\n/g) || []).length;
      i = j;
    }
  }
  return tokens;
}

function scanHtml(html, file, lineOffset = 0) {
  const issues = [];
  const tokens = tokenize(html);
  let ignoreNext = false;
  let rawTextTag = null; // inside <script>/<style>
  for (const tok of tokens) {
    const ln = tok.line + lineOffset;
    if (tok.type === 'comment') { if (/i18n-ignore/.test(tok.text)) ignoreNext = true; continue; }
    if (tok.type === 'tag') {
      const open = tok.text.match(/^<\s*(script|style)\b/i);
      const close = tok.text.match(/^<\s*\/\s*(script|style)\b/i);
      if (open) rawTextTag = open[1].toLowerCase();
      if (close) rawTextTag = null;
      const attrRe = /([^\s=<>"'/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m;
      while ((m = attrRe.exec(tok.text))) {
        const name = m[1];
        const value = m[3] !== undefined ? m[3] : m[4];
        if (!ATTRS.has(name.toLowerCase())) continue; // [placeholder], attr.title, (click) etc. never match
        if (value.includes('{{')) continue;
        if (HAS_LETTER.test(decodeEntities(value)) && !ALLOWED_WORDS.has(value.trim().toLowerCase())) {
          issues.push({ file, line: ln, kind: `attribute ${name}`, text: value.trim() });
        }
      }
      continue;
    }
    if (rawTextTag) continue;
    const cleaned = decodeEntities(stripAngularNoise(tok.text)).replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (ignoreNext) { ignoreNext = false; continue; }
    if (!HAS_LETTER.test(cleaned)) continue;
    if (ALLOWED_WORDS.has(cleaned.toLowerCase())) continue;
    issues.push({ file, line: ln, kind: 'text', text: cleaned.length > 70 ? `${cleaned.slice(0, 67)}...` : cleaned });
  }
  return issues;
}

function stripTsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function scanTs(src, file) {
  const issues = [];
  const lines = src.split('\n');
  // Inline templates
  const tplRe = /template\s*:\s*`([\s\S]*?)`/g;
  let m;
  while ((m = tplRe.exec(src))) {
    const startLine = src.slice(0, m.index).split('\n').length - 1;
    issues.push(...scanHtml(m[1], file, startLine));
  }
  const code = stripTsComments(src);
  const callRe = /\b(?:(?:this\.)?dialog\.(?:error|success|confirm|info|warn|warning)|(?:window\.)?alert)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  while ((m = callRe.exec(code))) {
    const text = m[2];
    const ln = code.slice(0, m.index).split('\n').length;
    if (/i18n-ignore/.test(lines[ln - 1] || '')) continue;
    if (m[1] === '`' && text.includes('${')) continue; // dynamic: assume built from t() output
    if (HAS_LETTER.test(text)) issues.push({ file, line: ln, kind: 'string literal', text: text.length > 70 ? `${text.slice(0, 67)}...` : text });
  }
  return issues;
}

function main() {
  const json = process.argv.includes('--json');
  const files = [];
  const dirIdx = process.argv.indexOf('--dir');
  if (dirIdx !== -1) files.push(...walk(resolve(process.argv[dirIdx + 1])));
  else for (const dir of CONFIG.include || []) files.push(...walk(join(ROOT, dir)));
  const all = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('.html')) all.push(...scanHtml(src, rel));
    else if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) all.push(...scanTs(src, rel));
  }
  if (json) { console.log(JSON.stringify({ scanned: files.length, issues: all }, null, 2)); process.exit(all.length ? 1 : 0); }
  if (all.length) {
    console.error(`\ni18n check FAILED: ${all.length} hard-coded user-facing string(s) in ${new Set(all.map((i) => i.file)).size} file(s):\n`);
    for (const i of all) console.error(`  ${i.file}:${i.line}  [${i.kind}]  ${JSON.stringify(i.text)}`);
    console.error('\nMove the text into src/app/i18n/catalogs/{en,ar}/<namespace>.json and use the t pipe / I18nService.t(). See scripts/check-i18n.mjs for the escape hatch.\n');
    process.exit(1);
  }
  console.log(`i18n check passed (${files.length} files scanned in: ${(CONFIG.include || []).join(', ') || 'no folders configured'})`);
}

main();
