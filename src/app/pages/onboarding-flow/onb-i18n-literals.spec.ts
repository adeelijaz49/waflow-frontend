// The literals rule of the onboarding flow (DF 5.1): no user-visible string literal in non-spec TypeScript and no template
// text outside the i18n pipes, anywhere under src/app/pages/onboarding-flow. A static scan (no TestBed): a small TypeScript
// lexer (strings, template literals with nested expressions, comments, regex literals) plus a small template tokenizer.
//
// The ONE intentional exception is the English support-staff text of onb-help.ts (F0 report, section 7 item 8): the
// message the "Need help?" button pre-fills for WaFlow staff. It is allow-listed by exact text below, in that file only,
// so a new literal in the same file is still caught.
//
// Escape hatch (same as scripts/check-i18n.mjs): `// i18n-ignore` at the end of a TypeScript line, `<!-- i18n-ignore -->`
// right before a template text node.

interface NodeApi {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, enc: 'utf8'): string;
  existsSync(p: string): boolean;
}
const BACKSLASH = String.fromCharCode(92);
let fs: NodeApi | null = null;
let dir = '';

async function load(): Promise<boolean> {
  if (fs) return true;
  try {
    const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
    if (!proc) return false;
    // @ts-ignore node built-in, there is no @types/node in this project
    const nodeFs = (await import(/* @vite-ignore */ 'node:fs')) as unknown as NodeApi;
    // @ts-ignore node built-in, there is no @types/node in this project
    const path = (await import(/* @vite-ignore */ 'node:path')) as unknown as { join(...p: string[]): string; dirname(p: string): string };
    let d = proc.cwd();
    for (let i = 0; i < 6 && !nodeFs.existsSync(path.join(d, 'angular.json')); i++) d = path.dirname(d);
    d = d.split(BACKSLASH).join('/');
    if (!nodeFs.existsSync(`${d}/angular.json`)) return false;
    fs = nodeFs;
    dir = `${d}/src/app/pages/onboarding-flow`;
    return true;
  } catch {
    return false;
  }
}

function walk(root: string, out: string[] = []): string[] {
  for (const e of fs!.readdirSync(root, { withFileTypes: true })) {
    const p = `${root}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export interface Violation { file: string; line: number; kind: string; text: string }

/** Exact texts allowed in onb-help.ts (template literal expressions are written as `{}`). */
const HELP_ALLOWED: readonly string[] = [
  'Hi WaFlow, I need help with my setup.',
  'Business: {}',
  'Name: {}',
  'Step: {} of 5 ({})',
  'Last problem: {}',
  'Language: {}',
  'Page: {}',
  'WaFlow setup help',
];
const ALLOWED_WORDS = new Set(['waflow']);

// ---------------------------------------------------------------------------------------------------------------------
// What counts as "words a person reads"
// ---------------------------------------------------------------------------------------------------------------------

const LETTER = /\p{L}/u;
const TWO_LETTERS = /\p{L}{2}/u;
const ARABIC = /\p{Script=Arabic}/u;
/** A catalogue key or prefix: dotted, no spaces ('onboarding.step.', 'onboarding.errors.X'). */
const KEY_LIKE = /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+\.?$/;

/** Prose: two or more words, or Arabic letters. Class lists, selectors, routes, URLs, codes and CSS declarations are not prose. */
export function isProse(value: string): boolean {
  const s = value.replace(/\{\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (!TWO_LETTERS.test(s) && !ARABIC.test(s)) return false;
  if (ARABIC.test(s)) return true;
  if (/^(https?:|mailto:|tel:|data:|\/|#|\.|@)/.test(s)) return false;
  if (!/\s/.test(s)) return false;
  if (KEY_LIKE.test(s)) return false;
  const words = s.split(' ');
  if (words.some((w) => /^[.#[:>~+*]/.test(w))) return false; // CSS selector
  if (/^[\w-]+\s*:\s*[^\s]+(\s*;\s*[\w-]+\s*:\s*[^\s]+)*;?$/.test(s) && !/[A-Z]/.test(s[0] ?? '')) return false; // CSS declaration
  if (/\[[^\]]*\]/.test(s)) return false; // attribute selector
  if (/[=;{}<>]/.test(s)) return false; // code / markup / selector, not a sentence
  const real = words.filter((w) => TWO_LETTERS.test(w));
  if (real.length < 2) return false;
  // class lists: every word is a lowercase identifier and at least one has a - or _ or digit
  if (words.every((w) => /^[a-z0-9_-]+$/.test(w)) && words.some((w) => /[-_0-9]/.test(w))) return false;
  return true;
}

const TITLE_WORD = /^[A-Z][a-z]{2,}$/;
/** A single capitalised English word is visible text when it sits in a visible-text position ('Done'). */
function isVisibleWord(value: string): boolean {
  const s = value.trim();
  return (isProse(s) || TITLE_WORD.test(s)) && !ALLOWED_WORDS.has(s.toLowerCase());
}

const VISIBLE_PROPS = /^(error|errorMessage|errorText|message|msg|title|label|text|hint|placeholder|description|heading|caption|tooltip|subtitle|ariaLabel|warning|notice|summary)$/;
const VISIBLE_CALLS = /^(setTitle|say|announce|alert|toast|showToast|notify|snack|snackbar|success|warning|confirm)$/;

// ---------------------------------------------------------------------------------------------------------------------
// TypeScript lexer
// ---------------------------------------------------------------------------------------------------------------------

interface Tok { kind: 'str' | 'tpl' | 'template' | 'style'; value: string; line: number; before: string }

function findClose(src: string, from: number): number {
  let depth = 1;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"') {
      for (j++; j < src.length && src[j] !== c; j++) if (src[j] === BACKSLASH) j++;
    } else if (c === '`') {
      for (j++; j < src.length && src[j] !== '`'; j++) if (src[j] === BACKSLASH) j++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return src.length;
}

function lex(src: string, baseLine: number, out: Tok[], ignored: Set<number>): void {
  const n = src.length;
  let i = 0;
  let line = baseLine;
  let lastSig = '';
  let word = '';
  let lastWord = '';
  const regexAllowed = (): boolean => lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || ['return', 'typeof', 'case'].includes(lastWord);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (/[\w$]/.test(c)) {
      word += c;
      lastSig = c;
      i++;
      continue;
    }
    if (word) {
      lastWord = word;
      word = '';
    }
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      if (/i18n-ignore/.test(src.slice(i, j))) ignored.add(line);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      const seg = src.slice(i, j);
      if (/i18n-ignore/.test(seg)) ignored.add(line);
      line += (seg.match(/\n/g) ?? []).length;
      i = j;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === BACKSLASH ? 2 : 1;
      out.push({ kind: 'str', value: src.slice(i + 1, j), line, before: src.slice(Math.max(0, i - 80), i) });
      lastSig = c;
      i = j + 1;
    } else if (c === '`') {
      const before = src.slice(Math.max(0, i - 80), i);
      const startLine = line;
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === BACKSLASH) {
          value += src.slice(j, j + 2);
          j += 2;
        } else if (src[j] === '$' && src[j + 1] === '{') {
          const end = findClose(src, j + 2);
          const inner = src.slice(j + 2, end);
          lex(inner, line, out, ignored);
          line += (inner.match(/\n/g) ?? []).length;
          value += '{}';
          j = end + 1;
        } else {
          if (src[j] === '\n') line++;
          value += src[j];
          j++;
        }
      }
      const kind: Tok['kind'] = /\btemplate\s*:\s*$/.test(before) ? 'template' : /\bstyles\s*:\s*\[?\s*$/.test(before) ? 'style' : 'tpl';
      out.push({ kind, value, line: startLine, before });
      lastSig = '`';
      i = j + 1;
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === BACKSLASH) {
          j += 2;
          continue;
        }
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        j++;
      }
      i = j + 1;
      while (i < n && /[a-z]/.test(src[i])) i++;
      lastSig = ')';
    } else {
      if (!/\s/.test(c)) lastSig = c;
      i++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Template scanner (inline `template:` and .html), a port of scripts/check-i18n.mjs plus bound literals
// ---------------------------------------------------------------------------------------------------------------------

type TplTok = { type: 'comment' | 'tag' | 'text'; text: string; line: number };

function tokenize(html: string): TplTok[] {
  const tokens: TplTok[] = [];
  const n = html.length;
  let i = 0;
  let line = 1;
  const push = (type: TplTok['type'], text: string): void => {
    tokens.push({ type, text, line });
    line += (text.match(/\n/g) ?? []).length;
  };
  const tagStart = (k: number): boolean => html[k] === '<' && /[A-Za-z/!]/.test(html[k + 1] ?? '');
  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      push('comment', html.slice(i, stop));
      i = stop;
    } else if (tagStart(i)) {
      let j = i + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = html[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      push('tag', html.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < n && !tagStart(j) && !html.startsWith('<!--', j)) j++;
      push('text', html.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

const STATIC_ATTRS = new Set(['placeholder', 'title', 'alt', 'aria-label', 'aria-placeholder', 'aria-description', 'aria-valuetext', 'label']);
const BOUND_ATTR = /^\[(?:attr\.)?(placeholder|title|alt|aria-label|aria-placeholder|aria-description|aria-valuetext|label)\]$/;
const decodeEntities = (s: string): string => s.replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, ' ');

function stripNoise(text: string): string {
  return text
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/@let\s[^;]*;/g, ' ')
    .replace(/@(?:else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b[^{]*\{/g, ' ')
    .replace(/[{}]/g, ' ');
}

/** Literals of an expression that is rendered as-is (no pipe): comparisons, call arguments and indexes do not count. */
function rawLiterals(expr: string): string[] {
  if (/(^|[^|])\|(?!\|)\s*[A-Za-z]/.test(expr)) return []; // goes through a pipe (t, tp, locNumber, ...)
  const found: string[] = [];
  const re = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const before = expr.slice(0, m.index).trimEnd();
    if (/(===|!==|==|!=|\(|,|\[|\+)$/.test(before)) continue;
    if (/^\s*(\+|\))/.test(expr.slice(m.index + m[0].length))) continue; // concatenation / argument
    if (TWO_LETTERS.test(m[2]) && !/^(https?:|\/)/.test(m[2])) found.push(m[2]);
  }
  return found;
}

export function scanTemplate(html: string, file: string, lineOffset = 0): Violation[] {
  const out: Violation[] = [];
  let ignoreNext = false;
  let raw: string | null = null;
  for (const tok of tokenize(html)) {
    const ln = tok.line + lineOffset;
    if (tok.type === 'comment') {
      if (/i18n-ignore/.test(tok.text)) ignoreNext = true;
      continue;
    }
    if (tok.type === 'tag') {
      const open = tok.text.match(/^<\s*(script|style)\b/i);
      if (open) raw = open[1].toLowerCase();
      if (/^<\s*\/\s*(script|style)\b/i.test(tok.text)) raw = null;
      const attrRe = /([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(tok.text))) {
        const name = m[1];
        const value = m[2] ?? m[3] ?? '';
        if (STATIC_ATTRS.has(name.toLowerCase())) {
          if (value.includes('{{')) continue;
          if (LETTER.test(decodeEntities(value)) && !ALLOWED_WORDS.has(value.trim().toLowerCase())) out.push({ file, line: ln, kind: `attribute ${name}`, text: value.trim() });
        } else if (BOUND_ATTR.test(name)) {
          for (const lit of rawLiterals(value)) out.push({ file, line: ln, kind: `bound attribute ${name}`, text: lit });
        }
      }
      continue;
    }
    if (raw) continue;
    for (const m of tok.text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      for (const lit of rawLiterals(m[1])) out.push({ file, line: ln, kind: 'interpolated literal', text: lit });
    }
    const cleaned = decodeEntities(stripNoise(tok.text)).replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (ignoreNext) {
      ignoreNext = false;
      continue;
    }
    if (!LETTER.test(cleaned) || ALLOWED_WORDS.has(cleaned.toLowerCase())) continue;
    out.push({ file, line: ln, kind: 'template text', text: cleaned.length > 70 ? `${cleaned.slice(0, 67)}...` : cleaned });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// TypeScript scanner
// ---------------------------------------------------------------------------------------------------------------------

export function scanTs(src: string, file: string): Violation[] {
  const out: Violation[] = [];
  const toks: Tok[] = [];
  const ignored = new Set<number>();
  lex(src, 1, toks, ignored);
  const isHelp = /(^|\/)onb-help\.ts$/.test(file);
  for (const t of toks) {
    if (t.kind === 'template') {
      out.push(...scanTemplate(t.value, file, t.line - 1));
      continue;
    }
    if (t.kind === 'style' || ignored.has(t.line)) continue;
    const before = t.before.replace(/\s+/g, ' ');
    if (/(\bfrom|\bimport|\brequire\(|\bimport\()\s*$/.test(before)) continue;
    if (/(\bconsole\.\w+\(|\bnew \w*Error\(|\bthrow )\s*$/.test(before)) continue;
    const value = t.value;
    if (isHelp && HELP_ALLOWED.includes(value)) continue;
    const visible = LETTER.test(value);
    if (!visible) continue;
    const prop = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before)?.[1] ?? /(?<![=!<>])([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)?.[1];
    const callee = /([A-Za-z_$][\w$.]*)\s*\(\s*$/.exec(before)?.[1]?.split('.').pop();
    let kind: string | null = null;
    if (ARABIC.test(value)) kind = 'Arabic text literal';
    else if (isProse(value)) kind = 'prose literal';
    else if (prop && VISIBLE_PROPS.test(prop) && isVisibleWord(value) && !KEY_LIKE.test(value)) kind = `visible text in "${prop}"`;
    else if (callee && VISIBLE_CALLS.test(callee) && TWO_LETTERS.test(value) && !KEY_LIKE.test(value) && !/^[a-z_]+$/.test(value)) kind = `visible text passed to ${callee}()`;
    if (kind) out.push({ file, line: t.line, kind, text: value.length > 70 ? `${value.slice(0, 67)}...` : value });
  }
  return out;
}

export function scanFile(path: string, src: string): Violation[] {
  if (path.endsWith('.spec.ts')) return [];
  if (path.endsWith('.html')) return scanTemplate(src, path);
  if (path.endsWith('.ts')) return scanTs(src, path);
  return [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------------------------------------------------

const ts = (code: string, file = 'x/screen.ts'): Violation[] => scanTs(code, file);
const kinds = (v: Violation[]): string[] => v.map((x) => x.kind);

describe('literals scanner: it catches user-visible text in TypeScript', () => {
  it('flags prose assigned to the usual text fields, passed to announcers/toasts, or just written down', () => {
    expect(ts(`const x = { message: 'Something went wrong, try again.' };`)).toHaveLength(1);
    expect(ts(`class A { title = 'Your WhatsApp number'; }`)).toHaveLength(1);
    expect(ts("this.label.set('Send me a test');")).toHaveLength(1);
    expect(ts("const a = { placeholder: 'Type your name' };")).toHaveLength(1);
    expect(ts("this.toast.show('Saved your changes');")).toHaveLength(1);
    expect(ts("this.announcer.say('Message sent');")).toHaveLength(1);
    expect(ts("this.title.setTitle('MarketMe setup');")).toHaveLength(1);
    expect(ts('this.error.set(`We could not reach ${name} right now`);')).toHaveLength(1);
    expect(ts("return flag ? 'Yes please' : 'No thanks';")).toHaveLength(2);
  });

  it('flags a single capitalised word in a visible-text position, and any Arabic literal', () => {
    expect(ts("const o = { label: 'Done' };")).toHaveLength(1);
    expect(ts("const o = { text: 'Retry' };")).toHaveLength(1);
    expect(ts("const o = { x: 'مرحباً' };")).toHaveLength(1);
    expect(kinds(ts("const o = { x: 'مرحباً' };"))).toEqual(['Arabic text literal']);
  });

  it('flags text in an inline template and in a bound attribute or interpolation that skips the pipes', () => {
    const v = ts('@Component({ template: `\n<p>Hello there</p>\n<button placeholder="Name" [attr.aria-label]="\'Close this\'">{{ \'Open\' }}</button>` })\nclass A {}');
    expect(kinds(v).sort()).toEqual(['attribute placeholder', 'bound attribute [attr.aria-label]', 'interpolated literal', 'template text']);
    expect(v.find((x) => x.kind === 'template text')?.line).toBe(2);
  });

  it('keeps flagging inside nested template-literal expressions', () => {
    expect(ts('const a = `${ok ? "Everything is fine" : x}`;')).toHaveLength(1);
  });
});

describe('literals scanner: no false positives on code that is not text', () => {
  it('ignores class lists, routes, URLs, selectors, CSS, regexes, catalogue keys and analytics codes', () => {
    const code = `
      const a = 'onb-btn onb-btn-primary';
      const b = '/setup/business/name';
      const c = '/promotions?openCreate=true&campaignType=store_wide_offer';
      const d = 'https://business.facebook.com/settings/security';
      const e = 'main.main-content';
      const f = 'button, a[href]';
      const g = 'display: flex; gap: 8px';
      const h = /['"]\\s+(one|two)/.test(x) ? 'ONB_SDK_BLOCKED' : 'step_enter';
      const i = 'onboarding.promotion.first.title';
      const j = 'onboarding.step.';
      const k = 'ar-SA-u-nu-latn-ca-gregory';
      const l = { type: 'step_complete', step: 'approvals', campaignType: 'loyalty_reminder', category: 'General' };
      const m = 'X-Requested-With';
      const n = 'A3f9-ZZ';
      const o = { title: 'onboarding.step.business' };
      const p = this.i18n.t('onboarding.promotion.first.aiPrompt');
      const q = this.announcer.say('onboarding.done.title');
      const r = "waflow_auth_token";
      const s = ' ';
      const t = '\\n';
      this.title.setTitle(this.i18n.t('onboarding.title') + ' - ' + name);
      this.router.navigateByUrl('/setup/promotion');
      document.querySelector('.onb-sheet .onb-btn');
    `;
    expect(ts(code)).toEqual([]);
  });

  it('ignores imports, console output, error constructors, comments, styles, i18n-ignore lines and type positions', () => {
    const code = `
      import { A } from '../some path/with spaces';
      // This is a comment with several words
      /* and a block comment with several words */
      console.warn('Something odd happened here');
      throw new Error('Something odd happened here');
      type T = 'a' | 'b';
      const x = { message: 'Plain words here' }; // i18n-ignore
      @Component({ styles: [\`.a { color: red; }\`], template: \`<p>{{ 'onboarding.x' | t }}</p>\` })
      class C {}
    `;
    expect(ts(code)).toEqual([]);
  });

  it('does not take a regex literal or a division for a string', () => {
    expect(ts(`const a = /it's a "test"/g.test(x); const b = total / 2; const c = 'ok';`)).toEqual([]);
    expect(ts(`const d = x.replace(/[^a-z ]/gi, ''); const e = a / b + 'two words';`)).toHaveLength(1);
  });

  it('templates: comparisons, calls and piped expressions are fine, entities and control flow are not text', () => {
    const html = `
      @if (state.unread() > 0) {
        <span class="onb-count">{{ state.unread() }}</span>
      } @else if (a === 'b') {
        <span class="onb-alert-icon" aria-hidden="true">{{ tone() === 'info' ? 'i' : '!' }} &#10003; &#8505;</span>
      }
      <h1 onbFocus="onboarding.step.connect">{{ 'onboarding.title' | t }}</h1>
      <button [attr.aria-label]="'onboarding.bell.label' | t" [class.x]="mode() === 'billing'" (click)="go('/setup/done')">{{ ('onboarding.step.' + k) | t }}</button>
      <!-- i18n-ignore -->
      <span>WaFlow</span>
      <input placeholder="{{ 'onboarding.x' | t }}" [placeholder]="'onboarding.y' | t" autocomplete="tel" />
      <a routerLink="/setup/promotion/test" [queryParams]="{ edit: 1 }">{{ x | t: { n: 3 } }}</a>
    `;
    expect(scanTemplate(html, 'x.html')).toEqual([]);
  });

  it('templates: the i18n-ignore comment exempts exactly the next text node', () => {
    const v = scanTemplate('<!-- i18n-ignore -->\n<p>Skipped text</p><p>Counted text</p>', 'x.html');
    expect(v.map((x) => x.text)).toEqual(['Counted text']);
  });
});

describe('literals scanner: the onb-help.ts exception is exact', () => {
  const help = 'src/app/pages/onboarding-flow/onb-help.ts';
  it('allows the staff text lines there, and only there', () => {
    const code = "const a = ['Hi WaFlow, I need help with my setup.', `Business: ${b}`, `Step: ${n} of 5 (${k})`, 'WaFlow setup help'];";
    expect(scanTs(code, help)).toEqual([]);
    expect(scanTs(code, 'src/app/pages/onboarding-flow/other.ts').length).toBeGreaterThan(0);
  });

  it('still catches any other prose in onb-help.ts', () => {
    expect(scanTs("const a = ['Hi WaFlow, I need help with my setup.', 'Call us any time'];", help)).toHaveLength(1);
  });
});

describe('onboarding-flow source tree: no user-visible literals outside the catalogue', () => {
  let files: string[] = [];
  beforeAll(async () => {
    expect(await load()).toBe(true);
    files = walk(dir).filter((f) => (f.endsWith('.ts') && !f.endsWith('.spec.ts')) || f.endsWith('.html'));
  });

  it('scans the real tree (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(40);
    for (const name of ['onb-help.ts', 'promotion.ts', 'promotion-test.ts', 'done.ts', 'onb-setup-shell.html']) {
      expect(files.some((f) => f.endsWith(`/${name}`)), name).toBe(true);
    }
    expect(files.some((f) => f.endsWith('.spec.ts'))).toBe(false);
  });

  it('has no violations (non-spec .ts, inline templates and .html)', () => {
    const all: Violation[] = [];
    for (const f of files) all.push(...scanFile(f.slice(f.indexOf('src/app/')), fs!.readFileSync(f, 'utf8')));
    const report = all.map((v) => `${v.file}:${v.line} [${v.kind}] ${JSON.stringify(v.text)}`);
    expect(report, `user-visible literals found:\n${report.join('\n')}`).toEqual([]);
  });
});
