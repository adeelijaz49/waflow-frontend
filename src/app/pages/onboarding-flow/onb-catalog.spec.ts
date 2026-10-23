// Safety nets for the `onboarding` i18n namespace (DF-frontend.md 5.1, 8.3).
// Static checks only: no TestBed, no network.
import enAll from '../../i18n/catalogs/en/all';
import arAll from '../../i18n/catalogs/ar/all';
import enOnb from '../../i18n/catalogs/en/onboarding.json';
import arOnb from '../../i18n/catalogs/ar/onboarding.json';
import metaOnb from '../../i18n/catalogs/meta/onboarding.json';

type Table = Record<string, string>;
type MetaRec = { status?: string; needsLegalApproval?: boolean; reviewer?: string; reviewedAt?: string };

const EN: Table = enOnb as Table;
const AR: Table = arOnb as Table;
const META = metaOnb as Record<string, MetaRec>;

// Keys the design (DF 5.2) marks as consent / legal / payment sensitive.
const DESIGN_LEGAL_KEYS = [
  'connect.note',
  'billing.metaFees',
  'approvals.payment.body',
  'customers.optin.warning',
  'customers.attest',
  'customers.one.agreed',
  'promotion.first.blocked',
  'errors.SENDING_NOT_AVAILABLE_YET',
];

// Flattened key set of the namespaces that existed BEFORE `onboarding` was added
// (recorded from the pre-change barrels, 2026-10-15). Hash = FNV-1a 32 bit over the
// sorted "ns.key" list joined by LF. Changing an existing namespace's keys fails this.
const PRE_EXISTING = {
  en: { count: 1511, hash: 'c7cb9a36' },
  ar: { count: 1574, hash: '7d6ec910' },
};
const PRE_EXISTING_NAMESPACES = [
  'ai', 'aimode', 'campaigns', 'captions', 'catalog', 'common', 'customers', 'embedded', 'errors', 'flowlang',
  'flows', 'hub', 'inbox', 'preview', 'promolang', 'review', 'settings', 'status', 'templates',
];

const MAX_RAW_BYTES = 60 * 1024;
const BACKSLASH = String.fromCharCode(92);

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function placeholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) out.add(m[1]);
  return [...out].sort();
}

function preExistingKeys(barrel: Record<string, Table>): string[] {
  const keys: string[] = [];
  for (const [ns, table] of Object.entries(barrel)) {
    if (ns === 'onboarding') continue;
    for (const k of Object.keys(table)) keys.push(`${ns}.${k}`);
  }
  return keys.sort();
}

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const range = (from: number, to: number): string => `${cp(from)}-${cp(to)}`;
// Arabic-Indic and extended Arabic-Indic digits.
const EASTERN_DIGITS = new RegExp(`[${range(0x660, 0x669)}${range(0x6f0, 0x6f9)}]`);
// Zero-width, bidi marks/embeddings/isolates, BOM, soft hyphen.
const HIDDEN_CHARS = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}${cp(0xfeff)}${cp(0xad)}]`,
);
// The Arabic words for "campaign" / "campaigns" (banned in new copy: the area is Promotions).
const BANNED_AR = new RegExp(`${cp(0x62d, 0x645, 0x644)}(${cp(0x629)}|${cp(0x627, 0x62a)})`);
// "Promotions" in Arabic (the glossary term for the area).
const PROMOTIONS_AR = cp(0x627, 0x644, 0x639, 0x631, 0x648, 0x636, 0x20, 0x627, 0x644, 0x62a, 0x631, 0x648, 0x64a, 0x62c, 0x64a, 0x629);
const SAR_SIGN = new RegExp(`${cp(0x631)}${BACKSLASH}.${cp(0x633)}`);
const ARABIC_LETTER_THEN_QUESTION = new RegExp(`[${range(0x62a, 0x64a)}]${BACKSLASH}?`);

// --- static source scan (node built-ins; the spec runs under Node) ------------------------------
interface NodeApi {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, enc: 'utf8'): string;
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
}
let nodeFs: NodeApi | null = null;
let rootDir = '';
async function loadFs(): Promise<boolean> {
  if (nodeFs) return true;
  try {
    const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
    if (!proc) return false;
    // @ts-ignore node built-in, there is no @types/node in this project
    const fs = (await import(/* @vite-ignore */ 'node:fs')) as unknown as NodeApi;
    // @ts-ignore node built-in, there is no @types/node in this project
    const path = (await import(/* @vite-ignore */ 'node:path')) as unknown as { join(...p: string[]): string; dirname(p: string): string };
    let dir = proc.cwd();
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'angular.json'))) break;
      dir = path.dirname(dir);
    }
    rootDir = dir.split(BACKSLASH).join('/');
    if (!fs.existsSync(`${rootDir}/angular.json`)) return false;
    nodeFs = fs;
    return true;
  } catch {
    return false;
  }
}

function walk(fs: NodeApi, dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(fs, p, out);
    else if (/\.(ts|html)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('onboarding catalogue', () => {
  const enKeys = Object.keys(EN);
  const arKeys = Object.keys(AR);

  it('is not empty and every value is a non-empty string', () => {
    expect(enKeys.length).toBeGreaterThan(300);
    for (const t of [EN, AR]) {
      for (const [k, v] of Object.entries(t)) {
        expect(typeof v, k).toBe('string');
        expect(v.trim().length, k).toBeGreaterThan(0);
      }
    }
  });

  it('en and ar have exactly the same key set', () => {
    expect(arKeys.filter((k) => !(k in EN))).toEqual([]);
    expect(enKeys.filter((k) => !(k in AR))).toEqual([]);
    expect(arKeys.length).toBe(enKeys.length);
  });

  it('{param} placeholders are identical in en and ar for every key', () => {
    const bad = enKeys.filter((k) => k in AR && placeholders(EN[k]).join() !== placeholders(AR[k]).join());
    expect(bad).toEqual([]);
  });

  it('has no plural keys (count phrases use the "label: {n}" form)', () => {
    expect(enKeys.filter((k) => /_(zero|one|two|few|many|other)$/.test(k))).toEqual([]);
  });

  it('is registered in both barrels', () => {
    expect((enAll as Record<string, Table>)['onboarding']).toBe(EN);
    expect((arAll as Record<string, Table>)['onboarding']).toBe(AR);
  });

  it('has an error key for every backend and client code and a pair for every notification kind', () => {
    const kinds = [
      'payment_failed', 'subscription_active', 'subscription_cancelled', 'connected', 'reconnect_needed',
      'verification_changed', 'display_name_decided', 'messaging_limit_changed', 'template_approved',
      'template_rejected', 'pathb_reminder', 'sending_paused', 'account_alert', 'help_received', 'unknown',
    ];
    for (const kind of kinds) {
      expect(EN[`notify.${kind}.title`], kind).toBeTruthy();
      expect(EN[`notify.${kind}.body`], kind).toBeTruthy();
    }
    const codes = [
      'ONBOARDING_NOT_AVAILABLE', 'SUBSCRIPTION_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_PAST_DUE', 'SUBSCRIPTION_CANCELLED',
      'WHATSAPP_NOT_CONNECTED', 'WHATSAPP_RECONNECT_REQUIRED', 'SENDING_NOT_AVAILABLE_YET', 'OWNER_ONLY',
      'LEGAL_ACCEPTANCE_REQUIRED', 'VALIDATION_FAILED', 'STEP_PREREQUISITE', 'NUMBER_PERSONAL_WARNING_REQUIRED',
      'NUMBER_ALREADY_CONNECTED', 'RATE_LIMITED', 'CHECKOUT_NOT_CONFIGURED', 'PLAN_UNKNOWN', 'BILLING_PORTAL_UNAVAILABLE',
      'STRIPE_ERROR', 'SUBSCRIPTION_EXISTS', 'CONNECT_NOT_CONFIGURED', 'ENCRYPTION_NOT_CONFIGURED', 'CONNECT_IN_PROGRESS', 'CONNECT_ATTEMPT_INVALID',
      'CONNECT_CODE_INVALID_OR_EXPIRED', 'CONNECT_WABA_MISMATCH', 'CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT',
      'CONNECT_NUMBER_REGISTERED_ELSEWHERE', 'CONNECT_VERIFICATION_FAILED', 'CONNECT_CANCELLED', 'CONNECT_NO_FACEBOOK_ACCOUNT',
      'CONNECT_COEXISTENCE_UNAVAILABLE', 'CONNECT_REGISTER_RATE_LIMITED', 'CONNECT_PARTIAL', 'CONNECT_AMBIGUOUS_WABA',
      'META_UNREACHABLE', 'META_ERROR', 'META_TOKEN_REVOKED', 'META_PERMISSION_MISSING', 'META_RATE_LIMITED', 'META_NOT_CONFIGURED',
      'TEMPLATE_LIMIT_REACHED', 'TEMPLATE_REJECTED', 'TEST_RATE_LIMITED', 'TEST_NO_APPROVED_TEMPLATE', 'TEST_RECIPIENT_OPTED_OUT',
      'TEST_PHONE_INVALID', 'TEST_NUMBER_LIMIT', 'ONB_NETWORK', 'ONB_GENERIC', 'ONB_STATE_UNAVAILABLE', 'ONB_SDK_BLOCKED',
      'ONB_SDK_TIMEOUT', 'ONB_POPUP_BLOCKED', 'ONB_IN_APP_BROWSER', 'ONB_CODE_HANDOFF_SLOW', 'ONB_IMPORT_TOO_MANY',
      'ONB_IMPORT_BAD_FILE', 'ONB_IMPORT_NO_ROWS',
    ];
    for (const c of codes) {
      expect(EN[`errors.${c}`], c).toBeTruthy();
      expect(AR[`errors.${c}`], c).toBeTruthy();
    }
  });

  describe('Arabic and style rules', () => {
    it('uses no banned terms', () => {
      expect(arKeys.filter((k) => BANNED_AR.test(AR[k]))).toEqual([]);
      expect(enKeys.filter((k) => /campaign/i.test(EN[k]))).toEqual([]);
      for (const t of [EN, AR]) {
        expect(Object.keys(t).filter((k) => /\bWABA\b|Cloud API/i.test(t[k]))).toEqual([]);
        expect(Object.keys(t).filter((k) => /error code/i.test(t[k]))).toEqual([]);
      }
    });

    it('never writes WhatsApp, Instagram or Facebook in Latin letters in Arabic copy', () => {
      expect(arKeys.filter((k) => /WhatsApp|Instagram|Facebook/i.test(AR[k]))).toEqual([]);
    });

    it('uses Western digits only in Arabic', () => {
      expect(arKeys.filter((k) => EASTERN_DIGITS.test(AR[k]))).toEqual([]);
    });

    it('has no hidden or bidi control characters in any language', () => {
      for (const t of [EN, AR]) {
        expect(Object.keys(t).filter((k) => HIDDEN_CHARS.test(t[k]) || HIDDEN_CHARS.test(k))).toEqual([]);
      }
    });

    it('has no double spaces or edge whitespace', () => {
      for (const t of [EN, AR]) {
        expect(Object.keys(t).filter((k) => t[k] !== t[k].trim() || /\s{2,}/.test(t[k]))).toEqual([]);
      }
    });

    it('uses the Arabic question mark, not the Latin one, directly after Arabic letters', () => {
      expect(arKeys.filter((k) => ARABIC_LETTER_THEN_QUESTION.test(AR[k]))).toEqual([]);
    });

    it('uses the glossary term for Promotions in Arabic', () => {
      expect(arKeys.some((k) => AR[k].includes(PROMOTIONS_AR))).toBe(true);
    });

    it('keeps payment copy neutral: no price, currency or plan name, and the exact Meta fee line', () => {
      for (const t of [EN, AR]) {
        expect(Object.keys(t).filter((k) => /\b(SAR|USD|AUD|EUR)\b|\$/.test(t[k]) || SAR_SIGN.test(t[k]))).toEqual([]);
      }
      expect(EN['billing.metaFees']).toBe('WhatsApp message fees are charged by Meta to your own Meta account.');
    });
  });

  describe('honest copy: no "free" claims, no promise and no timeline for sending, no "unlock" once the app is unlocked', () => {
    // The Arabic words for "free of charge" and for "being freed / released" (a number that becomes available again), by code point.
    const AR_FREE = new RegExp(
      `${cp(0x645, 0x62c, 0x627, 0x646)}|${cp(0x628, 0x644, 0x627, 0x20, 0x645, 0x642, 0x627, 0x628, 0x644)}|${cp(0x62a, 0x62d, 0x631, 0x631)}|${cp(0x64a, 0x62a, 0x62d, 0x631, 0x631)}|${cp(0x628, 0x62f, 0x648, 0x646, 0x20, 0x631, 0x633, 0x648, 0x645)}`,
    );
    const EN_FREE = /\b(free|freely|complimentary|gratis)\b|no (extra )?(cost|charge|fee)|at no |for nothing/i;

    it('no key says "free" (English) or "free of charge / freed" (Arabic): messaging is paid to Meta and the copy never suggests otherwise', () => {
      expect(enKeys.filter((k) => EN_FREE.test(EN[k]))).toEqual([]);
      expect(arKeys.filter((k) => AR_FREE.test(AR[k]))).toEqual([]);
    });

    it('the Facebook account hint no longer says it is free to create', () => {
      expect(EN['errors.CONNECT_NO_FACEBOOK_ACCOUNT']).toBe('You need a Facebook account to use WhatsApp Business. Once you can log in, come back here.');
      expect(AR['errors.CONNECT_NO_FACEBOOK_ACCOUNT']).not.toMatch(AR_FREE);
    });

    const SENDING_KEYS = ['promotion.first.blocked', 'errors.SENDING_NOT_AVAILABLE_YET'];
    const PROMISE = /\b(soon|shortly|moment|ready|within|minutes?|hours?|days?|weeks?|tomorrow|today|will be|being switched|we'll tell|we will tell|notify)\b/i;

    it.each(SENDING_KEYS)('%s: says plainly that sending from the own number is not switched on for the account yet, promises nothing and names no time', (k) => {
      expect(EN[k]).toMatch(/not switched on for your account yet/);
      expect(EN[k]).not.toMatch(PROMISE);
      expect(EN[k]).toContain('Your Promotions are saved.');
      expect(AR[k]).not.toMatch(/\d/); // no number of minutes / days in either language
      expect(EN[k]).not.toMatch(/\d/);
    });

    it.each(SENDING_KEYS)('%s: points at "Need help?" (the label of the help button, in both languages) as the way to reach the team', (k) => {
      expect(EN[k]).toContain(EN['help.cta']);
      expect(AR[k]).toContain(AR['help.cta']);
      expect(EN[k]).toMatch(/reach our team/);
    });

    it.each(SENDING_KEYS)('%s stays flagged for legal review (draft + needsLegalApproval)', (k) => {
      expect(META[k]).toEqual({ status: 'draft', needsLegalApproval: true });
    });

    it('the strip says "to unlock" only in its locked wording; the unlocked line is neutral and carries the step and the total', () => {
      expect(EN['strip.finish']).toMatch(/unlock/i);
      expect(EN['home.locked']).toMatch(/locked/i);
      expect(EN['strip.finishUnlocked']).toBe('Finish setting up. Step {n} of {total}.');
      expect(EN['strip.finishUnlocked']).not.toMatch(/unlock|lock/i);
      expect(placeholders(EN['strip.finishUnlocked'])).toEqual(['n', 'total']);
      expect(placeholders(AR['strip.finishUnlocked'])).toEqual(['n', 'total']);
      expect(AR['strip.finishUnlocked']).toBeTruthy();
    });
  });

  describe('keys added in wave 3.5 (e-mail for updates, phone check, AI Mode hand-off)', () => {
    it.each([
      ['business.email.field', []],
      ['business.email.hint', []],
      ['business.email.placeholder', []],
      ['business.error.email', []],
      ['customers.reason.invalidPhone', ['max', 'min']],
      ['customers.one.phoneInvalid', ['example', 'max', 'min']],
      ['aiNext.cta', []],
      ['aiNext.customers', ['n']],
      ['aiNext.products', ['n']],
    ] as [string, string[]][])('%s exists in both languages with exactly the parameters %j', (key, params) => {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(AR[key], `ar ${key}`).toBeTruthy();
      expect(placeholders(EN[key])).toEqual(params);
      expect(placeholders(AR[key])).toEqual(params);
    });

    it('the AI Mode sentences name what was added with a count only (no name, phone or e-mail parameter) and say AI Mode the glossary way in Arabic', () => {
      for (const k of ['aiNext.customers', 'aiNext.products']) {
        expect(placeholders(EN[k])).toEqual(['n']);
        expect(EN[k]).toMatch(/What should I do next\?$/);
      }
      expect(AR['aiNext.cta']).toContain(cp(0x648, 0x636, 0x639, 0x20, 0x627, 0x644, 0x630, 0x643, 0x627, 0x621, 0x20, 0x627, 0x644, 0x627, 0x635, 0x637, 0x646, 0x627, 0x639, 0x64a));
    });

    it('the "Email for updates" copy is optional in tone, and the hint says customers never see it', () => {
      expect(EN['business.email.field']).toContain('(optional)');
      expect(EN['business.email.hint']).toMatch(/customers never see it/);
      expect(EN['business.error.email']).toMatch(/leave it empty/);
    });

    it('the phone messages state the limits through parameters (Western digits come from {min} and {max}, never typed into the Arabic text)', () => {
      expect(EN['customers.reason.invalidPhone']).toContain('{min} to {max} digits');
      expect(AR['customers.reason.invalidPhone']).not.toMatch(/\d/);
      expect(AR['customers.one.phoneInvalid']).not.toMatch(/\d/);
    });
  });

  describe('review metadata', () => {
    it('lists every design legal key with status draft and needsLegalApproval', () => {
      for (const k of DESIGN_LEGAL_KEYS) {
        expect(k in EN, `${k} exists`).toBe(true);
        expect(META[k]?.needsLegalApproval, k).toBe(true);
        expect(META[k]?.status, k).toBe('draft');
      }
    });

    it('only describes keys that exist and never marks an Arabic key reviewed', () => {
      for (const [k, rec] of Object.entries(META)) {
        expect(k in AR, `meta key ${k} exists`).toBe(true);
        expect(rec.status, k).toBe('draft');
        expect(rec.reviewer, k).toBeUndefined();
        expect(rec.reviewedAt, k).toBeUndefined();
        expect(rec.needsLegalApproval === undefined || rec.needsLegalApproval === true, k).toBe(true);
      }
    });
  });

  describe('the R6 review: legal flags, Arabic terminology, generic wording, new keys', () => {
    // consent, payment, legal, data-retention and Meta-policy claims (R6-11) that must be flagged for the owner's lawyer
    const R6_LEGAL_KEYS = [
      'customers.optin.title', 'customers.optin.unsure', 'number.personal.ack', 'number.personal.warning', 'number.personal.how', 'number.migrate.body',
      'approvals.payment.confirm', 'approvals.payment.confirmed', 'approvals.payment.cantSee', 'billing.manual', 'errors.CHECKOUT_NOT_CONFIGURED',
      'billing.pastDue.body', 'business.email.hint', 'connect.disconnect.body', 'connect.disconnect.impact.sending', 'connect.disconnect.impact.templates',
      'connect.disconnect.impact.number', 'strip.cancelled', 'billing.cancelled.body', 'errors.SUBSCRIPTION_CANCELLED', 'notify.subscription_cancelled.body',
      'number.bizapp.body', 'number.bizapp.c1', 'number.bizapp.c2', 'number.bizapp.c3', 'number.landline.body', 'done.sent', 'promotion.test.body',
    ];
    // consent wording added by the same review: the "not understood" column notices, the opt-out notice, the conflicting-rows line, the paste hint
    const NEW_CONSENT_KEYS = [
      'customers.optin.unknownBlocked', 'customers.optin.unknownIgnored', 'customers.optin.optOutFound', 'customers.preview.conflicting', 'customers.paste.hint',
    ];

    it.each([...R6_LEGAL_KEYS, ...NEW_CONSENT_KEYS])('%s is flagged for legal review as a draft', (k) => {
      expect(k in EN, `${k} exists in en`).toBe(true);
      expect(k in AR, `${k} exists in ar`).toBe(true);
      expect(META[k], k).toEqual({ status: 'draft', needsLegalApproval: true });
    });

    it('every legal flag of the first build is still there', () => {
      for (const k of [...DESIGN_LEGAL_KEYS, 'customers.optin.fileTitle', 'customers.optin.fileYes', 'customers.preview.noOptin', 'customers.result.noOptin', 'customers.result.ask']) {
        expect(META[k]?.needsLegalApproval, k).toBe(true);
      }
      expect(Object.keys(META).length).toBeGreaterThanOrEqual(50);
    });

    it('the Arabic copy of a Meta approval never uses the consent word (glossary D4: approval = الاعتماد, consent = الموافقة)', () => {
      const consent = cp(0x645, 0x648, 0x627, 0x641, 0x642, 0x629); // الموافقة without the article
      const approval = cp(0x627, 0x639, 0x62a, 0x645, 0x627, 0x62f); // اعتماد
      expect(AR['business.email.hint']).not.toContain(consent);
      expect(AR['business.email.hint']).toContain(approval);
      for (const k of arKeys.filter((x) => /^(approvals\.|billing\.|connect\.|notify\.(template|verification|display_name))/.test(x) && !/payment|attest/.test(x))) {
        expect(AR[k], k).not.toContain(consent);
      }
    });

    it('"Skip for now" keeps its "for now" in Arabic, and the display-name waiting sentence is no longer an ambiguous verb', () => {
      const temporarily = cp(0x645, 0x624, 0x642, 0x62a, 0x627, 0x64b); // مؤقتاً
      expect(AR['common.skip']).toContain(temporarily);
      expect(AR['common.skip']).not.toBe(cp(0x62a, 0x62e, 0x637, 0x651, 0x64e, 0x20, 0x627, 0x644, 0x622, 0x646)); // the old "تخطَّ الآن"
      const reviews = cp(0x645, 0x631, 0x627, 0x62c, 0x639, 0x629); // مراجعة (a review)
      expect(AR['approvals.name.waiting']).toContain(reviews);
      expect(AR['approvals.name.waiting']).not.toContain(cp(0x62a, 0x631, 0x627, 0x62c, 0x639, 0x20, 0x4d, 0x65)); // the old "تراجع Me.."
    });

    it('the "skipped" wording is generic (the reasons are in the download), not "invalid numbers"', () => {
      for (const k of ['customers.preview.bad', 'customers.result.line']) {
        expect(EN[k], k).not.toMatch(/invalid numbers/i);
        expect(AR[k], k).not.toContain(cp(0x623, 0x631, 0x642, 0x627, 0x645, 0x20, 0x63a, 0x64a, 0x631, 0x20, 0x635, 0x627, 0x644, 0x62d, 0x629)); // أرقام غير صالحة
      }
      expect(EN['customers.result.line']).toBe('{added} added, {skipped} could not be added');
      expect(EN['customers.preview.download']).toMatch(/reason/);
    });

    it.each([
      ['customers.phone.note', ['code', 'country']], ['customers.phone.noteOther', []], ['customers.upload.columns', []], ['customers.upload.columnsLang', []],
      ['customers.preview.unreadable', ['n']], ['customers.preview.repeated', ['n']], ['customers.preview.conflicting', ['n']],
      ['customers.reason.unreadable', []], ['customers.reason.countryCodeNeeded', []], ['customers.one.phoneCountryNeeded', ['example']],
      ['approvals.templates.suggests', []], ['approvals.templates.again', []], ['common.waitOver', []], ['errors.RATE_LIMITED_LONG', []],
      ['customers.optin.unknownBlocked', []], ['customers.optin.unknownIgnored', []], ['customers.optin.optOutFound', []],
    ] as [string, string[]][])('%s exists in both languages with exactly the parameters %j', (key, params) => {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(AR[key], `ar ${key}`).toBeTruthy();
      expect(placeholders(EN[key])).toEqual(params);
      expect(placeholders(AR[key])).toEqual(params);
    });

    it.each(['INVALID_FORMAT', 'ABUSIVE_CONTENT', 'INCORRECT_CATEGORY', 'SCAM', 'TAG_CONTENT_MISMATCH', 'generic'])(
      'a Meta rejection reason has plain-language copy in both languages: %s (never the raw code)', (code) => {
        const key = `approvals.templates.reason.${code}`;
        expect(EN[key], `en ${key}`).toBeTruthy();
        expect(AR[key], `ar ${key}`).toBeTruthy();
        expect(EN[key]).not.toContain(code);
        expect(EN[key]).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
      });

    it('the phone note keeps the plus sign out of the Arabic copy (it would flip sides in right-to-left text) and writes the code through the parameter', () => {
      expect(EN['customers.phone.note']).toBe('Numbers without a country code are treated as {country} (+{code}).');
      expect(AR['customers.phone.note']).not.toContain('+');
      expect(AR['customers.phone.noteOther']).not.toContain('+');
      expect(EN['customers.phone.noteOther']).toBe('Write every number with its country code, for example');
    });

    it('the opt-in notices tell the merchant how to fix the file (rename the column Opt-in, yes or no in every row) or to choose Not sure', () => {
      expect(EN['customers.optin.unknownBlocked']).toMatch(/rename that column Opt-in/);
      expect(EN['customers.optin.unknownBlocked']).toMatch(/yes or no in every row/);
      expect(EN['customers.optin.unknownBlocked']).toMatch(/Not sure/);
      expect(EN['customers.optin.unknownBlocked']).toMatch(/without permission/);
    });
  });

  describe('safety nets', () => {
    it('leaves the key set of every pre-existing namespace unchanged', () => {
      expect(Object.keys(enAll).filter((n) => n !== 'onboarding').sort()).toEqual(PRE_EXISTING_NAMESPACES);
      expect(Object.keys(arAll).filter((n) => n !== 'onboarding').sort()).toEqual(PRE_EXISTING_NAMESPACES);
      const en = preExistingKeys(enAll as Record<string, Table>);
      const ar = preExistingKeys(arAll as Record<string, Table>);
      expect({ count: en.length, hash: fnv1a(en.join('\n')) }).toEqual(PRE_EXISTING.en);
      expect({ count: ar.length, hash: fnv1a(ar.join('\n')) }).toEqual(PRE_EXISTING.ar);
    });

    it('keeps every catalogue file under the 60 KB raw gate', async () => {
      // Serialised size is a faithful proxy when the file system is not available.
      const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o, null, 2)).length;
      expect(bytes(EN)).toBeLessThan(MAX_RAW_BYTES);
      expect(bytes(AR)).toBeLessThan(MAX_RAW_BYTES);
      if (await loadFs()) {
        const base = `${rootDir}/src/app/i18n/catalogs`;
        for (const l of ['en', 'ar', 'meta']) {
          expect(nodeFs!.statSync(`${base}/${l}/onboarding.json`).size, l).toBeLessThan(MAX_RAW_BYTES);
        }
      }
    });

    it('every onboarding.* key referenced in onboarding-flow templates and TS exists (en and ar)', async () => {
      if (!(await loadFs())) return; // no file system: nothing to scan
      const files = walk(nodeFs!, `${rootDir}/src/app/pages/onboarding-flow`);
      const exact = new Map<string, string>();
      const prefixes = new Map<string, string>();
      // A quote or backtick directly before "onboarding." skips property paths like ws.onboarding.completed.
      const re = /['"`]onboarding\.([A-Za-z0-9_.]*)/g;
      for (const f of files) {
        const text = nodeFs!.readFileSync(f, 'utf8');
        for (const m of text.matchAll(re)) {
          const rest = m[1];
          if (rest === '' || rest.endsWith('.')) prefixes.set(rest, f);
          else exact.set(rest, f);
        }
      }
      const has = (t: Table, key: string) => key in t || `${key}_other` in t;
      const missing: string[] = [];
      for (const [key, file] of exact) {
        if (!has(EN, key)) missing.push(`en:${key} (${file})`);
        if (!has(AR, key)) missing.push(`ar:${key} (${file})`);
      }
      for (const [prefix, file] of prefixes) {
        if (!enKeys.some((k) => k.startsWith(prefix))) missing.push(`en prefix:${prefix} (${file})`);
        if (!arKeys.some((k) => k.startsWith(prefix))) missing.push(`ar prefix:${prefix} (${file})`);
      }
      expect(missing).toEqual([]);
    });
  });
});
