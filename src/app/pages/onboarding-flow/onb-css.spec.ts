// Style and hygiene rules of the onboarding-flow directory (DF 5.2, 7.3, 8.3): logical CSS only, every selector
// prefixed, small stylesheets, and no hidden / bidi characters in any source file. Static scan: no TestBed.

interface NodeApi {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, enc: 'utf8'): string;
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
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

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Rule preludes (selector lists) outside @keyframes; @media blocks are entered.
function selectors(css: string): string[] {
  const text = stripComments(css);
  const out: string[] = [];
  let i = 0;
  const readBlock = (start: number): number => {
    let depth = 0;
    for (let j = start; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) return j + 1;
    }
    return text.length;
  };
  const scan = (from: number, to: number): void => {
    let k = from;
    while (k < to) {
      const open = text.indexOf('{', k);
      if (open < 0 || open >= to) return;
      const prelude = text.slice(k, open).trim();
      const end = readBlock(open);
      if (prelude.startsWith('@keyframes')) {
        k = end;
      } else if (prelude.startsWith('@')) {
        scan(open + 1, end - 1);
        k = end;
      } else {
        for (const s of prelude.split(',')) if (s.trim()) out.push(s.trim());
        k = end;
      }
    }
  };
  scan(i, text.length);
  i = text.length;
  return out;
}

const PHYSICAL = [
  /(^|[;{\s])(left|right)\s*:/,
  /(^|[;{\s])margin-(left|right)\s*:/,
  /(^|[;{\s])padding-(left|right)\s*:/,
  /(^|[;{\s])border-(left|right)(-[a-z]+)?\s*:/,
  /(^|[;{\s])border-(top|bottom)-(left|right)-radius\s*:/,
  /text-align\s*:\s*(left|right)/,
  /(^|[;{\s])float\s*:/,
];

describe('onboarding-flow stylesheets', () => {
  let files: string[] = [];
  beforeAll(async () => {
    expect(await load()).toBe(true);
    files = walk(dir).filter((f) => f.endsWith('.css'));
  });

  it('finds the five stylesheets', () => {
    const names = files.map((f) => f.slice(f.lastIndexOf('/') + 1)).sort();
    for (const n of ['onb-base.css', 'onb-parts.css', 'onb-shell.css', 'onb-setup-shell.css']) expect(names).toContain(n);
  });

  it('uses logical properties only (no left/right, margin-left, padding-right, border-left, text-align left|right, float)', () => {
    for (const f of files) {
      const css = stripComments(fs!.readFileSync(f, 'utf8'));
      for (const re of PHYSICAL) expect(css, `${f} matches ${re}`).not.toMatch(re);
    }
  });

  it('every selector of onb-shell.css starts with body.onb- or .onb- (nothing can match for a non-enrolled merchant)', () => {
    const f = files.find((x) => x.endsWith('/shell/onb-shell.css'))!;
    const list = selectors(fs!.readFileSync(f, 'utf8'));
    expect(list.length).toBeGreaterThan(10);
    for (const s of list) expect(s, s).toMatch(/^(body\.onb-|\.onb-)/);
  });

  it('every selector of every onboarding stylesheet is scoped under the onb- prefix', () => {
    for (const f of files) {
      for (const s of selectors(fs!.readFileSync(f, 'utf8'))) expect(s, `${f}: ${s}`).toMatch(/^(body\.onb-|\.onb)/);
    }
  });

  it('each stylesheet stays well under the 4 kB component style budget (the strip under 3 kB)', () => {
    for (const f of files) {
      const size = fs!.statSync(f).size;
      expect(size, f).toBeLessThan(4000);
      if (f.endsWith('/onb-shell.css')) expect(size, f).toBeLessThan(3000);
    }
  });

  it('phones (under 600 px): the strip hides only its long explanation, VISUALLY (clip pattern, never display: none), so screen readers keep it', () => {
    const css = stripComments(fs!.readFileSync(files.find((x) => x.endsWith('/onb-shell.css'))!, 'utf8'));
    const media = /@media\s*\(max-width:\s*599px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(media, 'a (max-width: 599px) block exists').not.toBeNull();
    const block = media![1];
    expect(block).toContain('.onb-shell-more');
    expect(block).toContain('clip-path: inset(50%)');
    expect(block).toMatch(/position:\s*absolute/);
    expect(block).not.toMatch(/display\s*:\s*none/);
    expect(block).not.toMatch(/visibility\s*:\s*hidden/);
    expect(block).not.toMatch(/opacity\s*:\s*0\b/);
    // the title, the button and the tools are never hidden at that width: only the one class is
    const hiddenSelectors = selectors(`@media (max-width: 599px) {${block}\n}`);
    expect(hiddenSelectors.filter((s) => s !== '.onb-shell')).toEqual(['.onb-shell-more']);
  });

  it('the strip button beats the full-width primary button rule (two classes), so it is a compact button beside the message', () => {
    const strip = stripComments(fs!.readFileSync(files.find((x) => x.endsWith('/onb-shell.css'))!, 'utf8'));
    const base = stripComments(fs!.readFileSync(files.find((x) => x.endsWith('/onb-base.css'))!, 'utf8'));
    expect(base).toMatch(/\.onb-btn-primary\s*\{[^}]*inline-size:\s*100%/); // the rule the strip button has to win against
    expect(strip).toMatch(/\.onb-shell \.onb-shell-btn\s*\{[^}]*inline-size:\s*auto/);
    expect(strip).not.toMatch(/(^|\n)\.onb-shell-btn\s*\{/); // one class would lose to onb-base.css, which is loaded after it
  });

  it('the veil and the lock glyph rules exist exactly as designed', () => {
    const css = stripComments(fs!.readFileSync(files.find((x) => x.endsWith('/onb-shell.css'))!, 'utf8'));
    expect(css).toContain('body.onb-veil main.main-content > :not(.onb-shell-host)');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('body.onb-locked .sidebar-nav a.nav-item:not([href="/dashboard"]):not([href="/support"])::after');
    expect(css).toContain(`content: "${BACKSLASH}1F512" / ""`);
  });
});

describe('onboarding-flow sources: no hidden or bidi characters', () => {
  it('has no control, zero-width, bidi or BOM characters in any source file', async () => {
    expect(await load()).toBe(true);
    const bad: string[] = [];
    for (const f of walk(dir).filter((p) => /\.(ts|html|css)$/.test(p))) {
      const text = fs!.readFileSync(f, 'utf8');
      for (const ch of text) {
        const c = ch.codePointAt(0)!;
        const control = c < 32 && c !== 9 && c !== 10 && c !== 13;
        const hidden = c === 0x7f || c === 0xfeff || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xad;
        if (control || hidden) bad.push(`${f.slice(dir.length)} U+${c.toString(16)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('new source files use LF line endings only', async () => {
    expect(await load()).toBe(true);
    const crlf = walk(dir)
      .filter((p) => /\.(ts|html|css)$/.test(p))
      .filter((p) => fs!.readFileSync(p, 'utf8').includes(String.fromCharCode(13)));
    expect(crlf.map((p) => p.slice(dir.length))).toEqual([]);
  });
});
