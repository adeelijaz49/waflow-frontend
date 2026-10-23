// Contract check (task I4): the REAL answers of the sandboxed backend (checked-in copy in contract-fixtures/backend-samples.json,
// no secrets, fake ids only) go through every pure reader and the state service of the onboarding flow. Nothing may throw and
// every reader must reach the verdict the backend meant (landing page, strip variant, checklist row, approvals row, outcome).
// The matching compile-time check (every 2xx sample assigned to the type of the OnbApiService method) lives outside the repo.
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, type Observable } from 'rxjs';
import enOnb from '../../i18n/catalogs/en/onboarding.json';
import { I18nService } from '../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../i18n/i18n.types';
import { AuthService } from '../../shared/auth.service';
import { ONB_ERROR_TABLE, onbErrorAction, onbErrorCode, onbErrorText, onbErrorTone } from './onb-error';
import { OnbApiService } from './onb-api.service';
import { isLockAllowed, isSendRoute } from './onb-links';
import { OnbStateService, landingUrlOf } from './onb-state.service';
import {
  ONB_BACKEND_ERROR_CODES,
  ONB_STEP_KEYS,
  type OnbApprovalsResponse, type OnbConnectionSnapshot, type OnbState, type OnbTemplatesResponse,
} from './onb.types';
import samplesJson from './contract-fixtures/backend-samples.json';
import { checklistRows, currentStepNumber } from './setup/onb-checklist';
import {
  ApprovalsScreen, displayNameView, messagingTier, metaStatusOf, rowState, safeHttps, templateCounts, visibleTemplates, type TemplateRowView,
} from './setup/screens/approvals';
import {
  connectOutcome, connectRecovery, stateConnectionHint,
} from './setup/screens/connect';
import { approvedTemplateCount } from './setup/screens/done';
import { builderQueryParams, promotionPreconditionsMet, testOffered } from './setup/screens/promotion';
import { stepRedirect } from './setup/setup.routes';
import { computeStripVariant, stripActionFor, type OnbStripContext } from './shell/onb-shell';

vi.setConfig({ testTimeout: 30000 });

interface Sample { method: string; path: string; status: number; body: unknown }
const SAMPLES = samplesJson as unknown as Record<string, Sample>;
const names = Object.keys(SAMPLES);
const named = (re: RegExp): [string, Sample][] => names.filter((n) => re.test(n)).map((n) => [n, SAMPLES[n]]);
const bodyOf = <T>(n: string): T => SAMPLES[n].body as T;
const ok = (s: Sample): boolean => s.status >= 200 && s.status < 300;
const EN = enOnb as Record<string, string>;

const stateSamples = (): [string, OnbState][] =>
  names.filter((n) => ok(SAMPLES[n]) && /\/api\/onboarding\/(state|business)$/.test(SAMPLES[n].path)).map((n) => [n, SAMPLES[n].body as OnbState]);

const SETUP_LANDINGS = new Set([
  '/setup/billing', '/setup/business/name', '/setup/number', '/setup/number/paused', '/setup/connect', '/setup/approvals',
  '/setup/customers', '/setup/products', '/setup/promotion', '/setup',
]);

function stripCtx(s: OnbState, url: string): OnbStripContext {
  const sub = s.subscription?.state ?? 'none';
  return {
    enrolled: s.enrolled === true,
    takeover: s.enrolled === true && (sub === 'none' || sub === 'pending'),
    subState: sub,
    level: s.connection?.level ?? null,
    sendingPaused: s.sendingPaused ?? null,
    locked: s.enrolled === true && s.locked === true,
    finished: s.enrolled === true && s.view === 'done',
    url,
  };
}

describe('contract samples (checked-in copy of the backend answers)', () => {
  it('has a meaningful set of samples and holds no secret-like value', () => {
    expect(names.length).toBeGreaterThan(120);
    const text = JSON.stringify(samplesJson);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(text).not.toMatch(/v1:[A-Za-z0-9+/=]{8,}\./); // vault envelope
    expect(text).not.toMatch(/sk_(live|test)_|whsec_|EAA[A-Za-z0-9]{20,}/); // Stripe / Meta secrets
    expect(text.length).toBeLessThan(150_000); // tiny on purpose
  });

  describe('GET /state and PUT /business (every workspace of the seed)', () => {
    const all = stateSamples();
    it('there are states for billing, setup, done, past_due, cancelled (a finished setup) and not enrolled', () => {
      expect(all.length).toBeGreaterThanOrEqual(14);
      const kinds = new Set(all.map(([, s]) => (s.enrolled ? `${s.view}:${s.subscription?.state}` : 'legacy')));
      for (const k of ['legacy', 'billing:none', 'billing:pending', 'setup:active', 'done:active', 'setup:past_due', 'done:cancelled']) {
        expect(kinds.has(k), `missing kind ${k} in ${[...kinds].join(',')}`).toBe(true);
      }
    });

    it.each(all)('%s: landing url, checklist, strip variants and step guards never throw and agree with the state', (_n, s) => {
      const landing = landingUrlOf(s);
      if (!s.enrolled) {
        expect(landing).toBeNull();
        expect(computeStripVariant(stripCtx(s, '/dashboard'))).toBe('none');
        expect(stepRedirect(s, 'connect', '/setup/connect', landing)).toBeNull();
        return;
      }
      if (s.view === 'billing') {
        expect(landing).toBe('/setup/billing');
        expect(['none', 'pending']).toContain(s.subscription?.state);
        expect(computeStripVariant(stripCtx(s, '/dashboard'))).toBe(s.subscription?.state === 'pending' ? 'payPending' : 'pay');
      } else if (s.view === 'done') {
        expect(landing).toBeNull();
      } else {
        expect(SETUP_LANDINGS.has(landing as string), `landing ${landing}`).toBe(true);
      }
      // checklist
      const rows = checklistRows(s);
      expect(rows.map((r) => r.key)).toEqual([...ONB_STEP_KEYS]);
      const n = currentStepNumber(rows);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
      if (s.view === 'done') expect(rows.every((r) => r.status === 'done' || r.status === 'todo' || r.status === 'locked' || r.status === 'waiting' || r.status === 'needsYou' || r.status === 'paused' || r.status === 'checking' || r.status === 'current')).toBe(true);
      // steps 4 and 5 are never reachable before step 3 is done
      if (s.steps?.connect?.status !== 'done') {
        expect(rows.find((r) => r.key === 'approvals')?.reachable).toBe(false);
        expect(rows.find((r) => r.key === 'promotion')?.reachable).toBe(false);
      }
      // strip: every url, owner and member
      for (const url of ['/dashboard', '/promotions', '/settings', '/setup/connect', '/customers']) {
        const v = computeStripVariant(stripCtx(s, url));
        for (const isOwner of [true, false]) {
          const act = stripActionFor(v, isOwner, landing, s.sendingPaused?.code ?? null);
          if (act) expect(act.path ?? act.help ?? act.labelKey).toBeTruthy();
        }
      }
      // a send route while sending is paused shows the paused variant (past_due / cancelled / takeover come first); while the page
      // is veiled by the lock the lock message is the one that explains it
      if (s.sendingPaused && s.subscription?.state === 'active' && s.connection?.level !== 'reconnect_needed') {
        const expected = s.locked === true ? 'locked' : 'paused';
        for (const url of ['/promotions', '/customers', '/ai-mode', '/arabic']) {
          expect(isSendRoute(url), url).toBe(true);
          expect(computeStripVariant(stripCtx(s, url)), url).toBe(expected);
        }
      }
      // lock veil: a locked workspace is veiled on every route that is not allow-listed
      if (s.locked === true && s.subscription?.state === 'active' && !s.sendingPaused) {
        const v = computeStripVariant(stripCtx(s, '/customers'));
        if (!isLockAllowed('/customers')) expect(['locked', 'reconnect', 'pill', 'finish']).toContain(v);
      }
      // guards
      for (const step of ONB_STEP_KEYS) {
        const to = stepRedirect(s, step, `/setup/${step}`, landing);
        expect(to === null || typeof to === 'string').toBe(true);
        if (s.view === 'billing') expect(to).toBe('/setup/billing');
      }
    });

    it('past_due and cancelled merchants get the FULL state (steps, prompts), the strip variant says why', () => {
      for (const [n, s] of all.filter(([, st]) => st.enrolled && (st.subscription?.state === 'past_due' || st.subscription?.state === 'cancelled'))) {
        expect(s.steps, n).toBeTruthy();
        expect(s.subscription?.retry?.billingPortal, n).toBe(true);
        expect(computeStripVariant(stripCtx(s, '/dashboard')), n).toBe(s.subscription?.state === 'past_due' ? 'pastDue' : 'cancelled');
      }
    });

    it('OnbStateService fed with each sample exposes consistent signals (HTTP 200 body as the interceptor would deliver it)', () => {
      for (const [n, s] of all) {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('waflow_auth_token', 'token-' + n);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: OnbApiService, useValue: { getState: () => of(s) } }] });
        const svc = TestBed.inject(OnbStateService);
        svc.ensureLoaded();
        expect(svc.loaded(), n).toBe(true);
        expect(svc.enrolled(), n).toBe(s.enrolled === true);
        expect(svc.landingUrl(), n).toBe(landingUrlOf(s));
        expect(svc.takeover(), n).toBe(s.enrolled === true && (s.subscription?.state === 'none' || s.subscription?.state === 'pending'));
        expect(svc.finished(), n).toBe(s.enrolled === true && s.view === 'done');
        expect(svc.locked(), n).toBe(s.enrolled === true && s.locked === true);
        expect(typeof svc.unread(), n).toBe('number');
        expect(svc.hostNeeded(), n).toBe(s.enrolled === true && (svc.takeover() || !svc.finished() || svc.remindersPending()));
        expect(svc.level(), n).toBe(s.enrolled ? (s.connection?.level ?? null) : null);
      }
    });

    it('state.connection (level + cause) reads through stateConnectionHint without throwing', () => {
      for (const [n, s] of all) {
        const h = stateConnectionHint(s.connection);
        expect(['connected', 'waba_only', 'connecting', 'unknown'], n).toContain(h);
      }
    });

    it('first-promotion block of every state is readable by testOffered', () => {
      for (const [n, s] of all) {
        const r = testOffered(s.firstPromotion, false);
        expect(typeof r, n).toBe('boolean');
        if (s.enrolled && s.firstPromotion && s.firstPromotion.state === 'done') expect(r, n).toBe(false);
      }
    });
  });

  describe('connection, connect results and events', () => {
    it('GET /connection and POST /connection/refresh: status + level are read by connectOutcome', () => {
      for (const [n, s] of named(/-connection(-after-connect|-partial)?$|-connection-refresh$/)) {
        if (!ok(s)) continue;
        const snap = s.body as OnbConnectionSnapshot;
        const out = connectOutcome(snap);
        expect(['connected', 'waba_only', 'connecting', 'unknown'], n).toContain(out);
        if (snap.status === 'connected' || snap.status === 'needs_attention') expect(out, n).toBe('connected');
        if (snap.status === 'waba_only') expect(out, n).toBe('waba_only');
        if (snap.status === 'connecting') expect(out, n).toBe('connecting');
        if (snap.status === 'reconnect_required' || snap.status === 'not_connected' || snap.status === 'disconnected') expect(out, n).toBe('unknown');
      }
    });

    it('connect/complete replay and connect/resume: connected, masked number only', () => {
      for (const n of ['W3-connect-complete-replay', 'W3-connect-resume']) {
        if (!SAMPLES[n]) continue;
        const b = bodyOf<{ status?: string; level?: string; connection?: { numberMasked?: string; numberFull?: string }; nextStep?: string }>(n);
        expect(connectOutcome(b), n).toBe('connected');
        expect(b.nextStep, n).toBe('approvals');
        expect(String(b.connection?.numberMasked ?? ''), n).toMatch(/^\*+\d{4}$/);
        expect(b.connection?.numberFull, n).toBeUndefined();
      }
    });

    it('connect/event answers carry outcome, code, nextStep and copyKey; the copy key and code exist in the catalogue', () => {
      const evs = named(/-connect-event-/);
      expect(evs.length).toBe(3);
      for (const [n, s] of evs) {
        const b = s.body as { outcome?: string; code?: string; nextStep?: string | null; copyKey?: string };
        expect(typeof b.outcome, n).toBe('string');
        expect(ONB_BACKEND_ERROR_CODES as readonly string[], n).toContain(b.code);
        expect(EN['errors.' + b.code], n).toBeTruthy();
        expect(connectRecovery(String(b.code), true), n).toBeTruthy();
        expect(connectRecovery(String(b.code), false), n).toBeTruthy();
      }
    });

    it('connect/config samples: enabled shape, attempt id, reconnect block', () => {
      for (const [n, s] of named(/connect-config/)) {
        if (!ok(s)) continue;
        const b = s.body as { enabled?: boolean; appId?: string; attemptId?: string; expiresInSec?: number; reconnect?: { expectedWabaId: string | null } | null; sdkLocale?: string };
        expect(b.attemptId, n).toMatch(/^[a-f0-9]{16,64}$/);
        expect(typeof b.appId, n).toBe('string');
        expect(b.sdkLocale, n).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
        expect(b.expiresInSec, n).toBeGreaterThan(0);
      }
    });

    it('POST /connection/reconnect has the connect/config shape and names the expected WhatsApp account', () => {
      const b = bodyOf<{ attemptId?: string; appId?: string; reconnect?: { expectedWabaId: string | null } | null }>('W6-connection-reconnect');
      expect(b.attemptId).toMatch(/^[a-f0-9]{16,64}$/);
      expect(b.appId).toBeTruthy();
      expect(b.reconnect?.expectedWabaId).toBeTruthy();
      expect(bodyOf<{ reconnect: unknown }>('W6-connect-config').reconnect).toBeNull(); // the plain config of the same workspace
    });
  });

  describe('approvals and templates', () => {
    const approvals = named(/-approvals(-after-connect|-after-payment)?$/).filter(([, s]) => ok(s));
    it('has approval samples', () => expect(approvals.length).toBeGreaterThanOrEqual(5));

    it.each(approvals)('%s: five rows, every status a UI state, links https, name + tier readable', (_n, s) => {
      const b = s.body as OnbApprovalsResponse;
      expect(b.rows.map((r) => r.key)).toEqual(['verification', 'displayName', 'payment', 'messagingLimit', 'templates']);
      for (const r of b.rows) {
        expect(['done', 'waiting', 'needs'], `${r.key} ${r.status}`).toContain(rowState(r.status));
        expect(r.blocking).toBe(false);
        for (const u of Object.values(r.links ?? {})) expect(safeHttps(u), String(u)).toBeTruthy();
      }
      const dn = displayNameView(b.rows.find((r) => r.key === 'displayName'));
      expect(typeof dn.canEdit === 'boolean' || dn.canEdit === null).toBe(true);
      const tier = messagingTier(b.rows.find((r) => r.key === 'messagingLimit'));
      expect(tier === null || tier > 0).toBe(true);
    });

    it('the W5 name decision and tier are read from the sibling fields (rejection reason, 10 edits left, tier 250)', () => {
      const b = bodyOf<OnbApprovalsResponse>('W5-approvals');
      const dn = displayNameView(b.rows.find((r) => r.key === 'displayName'));
      expect(dn.value).toBe('E2E Mixed Shop Co');
      expect(dn.canEdit).toBe(true);
      expect(dn.editsRemaining).toBe(10);
      expect(dn.rejectionKey).toBe('NAME_NOT_CONSISTENT');
      expect(EN['approvals.name.reason.NAME_NOT_CONSISTENT']).toBeTruthy();
      expect(messagingTier(b.rows.find((r) => r.key === 'messagingLimit'))).toBe(250);
    });

    const templates = named(/-templates(-after-connect|-submit)?$/).filter(([, s]) => ok(s));
    it.each(templates)('%s: the internal test template is hidden, counts add up, every status is a Meta badge', (_n, s) => {
      const b = s.body as OnbTemplatesResponse;
      const rows = (b.templates ?? []) as TemplateRowView[];
      const vis = visibleTemplates(rows, b.capacity?.arabicRequested);
      expect(vis.some((r) => r.key === 'setup_test')).toBe(false);
      const c = templateCounts(vis);
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(approvedTemplateCount(rows)).toBe(vis.filter((r) => metaStatusOf(r.status) === 'APPROVED').length);
      for (const r of rows) expect(typeof metaStatusOf(r.status)).toBe('string');
      if (b.capacity && b.capacity.arabicRequested === false) {
        expect(vis.filter((r) => r.language === 'ar' && r.blockedReason).length).toBe(0);
      }
    });
  });

  describe('Step 5 and prompts', () => {
    it('first-promotion samples: preconditions and builder params read the real fields', () => {
      for (const [n, s] of named(/-first-promotion(-after-test|-no-template)?$/)) {
        if (!ok(s)) continue;
        const b = s.body as import('./onb.types').OnbFirstPromotion;
        expect(typeof promotionPreconditionsMet('connected', b), n).toBe('boolean');
        expect(promotionPreconditionsMet('reconnect_needed', b), n).toBe(false);
        const p = builderQueryParams(b.suggestion?.campaignType);
        expect(p['openCreate'], n).toBe('true');
        if (b.suggestion) expect(['store_wide_offer', 'product_promotion', 'loyalty_reminder'], n).toContain(b.suggestion.campaignType);
        expect(b.testRecipient === undefined || typeof b.testRecipient.needsPhone === 'boolean', n).toBe(true);
        if (b.testRecipient?.masked) expect(b.testRecipient.masked, n).toMatch(/^\*+\d{4}$/);
      }
    });

    it('the send policy of POST /first-promotion/state done under block is a 422 with the visible code', () => {
      const e = SAMPLES['W5-first-promotion-state-done'];
      expect(e.status).toBe(422);
      expect(JSON.stringify(e.body)).toContain('SENDING_NOT_AVAILABLE_YET');
    });
  });

  describe('every non-2xx body maps to a catalogue message and an action', () => {
    const errs = names.filter((n) => !ok(SAMPLES[n]) && SAMPLES[n].status !== 401).map((n) => [n, SAMPLES[n]] as [string, Sample]);
    it('there are error samples for 402, 403, 404, 409, 422, 429 and 503', () => {
      const codes = new Set(errs.map(([, s]) => s.status));
      for (const c of [402, 403, 404, 409, 422, 429, 503]) expect(codes.has(c), String(c)).toBe(true);
    });
    const i18n = { t: (k: string): string => `[${k}]` };
    it.each(errs)('%s', (_n, s) => {
      const body = s.body as { code?: string; error?: string };
      const err = new HttpErrorResponse({ status: s.status, error: body });
      const code = onbErrorCode(err);
      if (typeof body.code === 'string') {
        expect(code).toBe(body.code); // every backend code is known to the client
        expect(ONB_ERROR_TABLE[code]).toBeTruthy();
        expect(EN['errors.' + code] ?? EN['errors.ONB_GENERIC']).toBeTruthy();
      }
      expect(onbErrorText(i18n, err)).toMatch(/^\[onboarding\.errors\./);
      expect(onbErrorAction(code, { isOwner: true })).toBeTruthy();
      expect(onbErrorAction(code, { isOwner: false })).toBeTruthy();
      expect(['error', 'warn', 'info']).toContain(onbErrorTone(code));
    });

    it('SUBSCRIPTION_EXISTS (409) carries the subscription and is a goLanding info message', () => {
      const s = SAMPLES['W7-checkout-subscription-exists'];
      expect(s.status).toBe(409);
      const b = s.body as { code: string; subscription?: { state?: string } };
      expect(b.code).toBe('SUBSCRIPTION_EXISTS');
      expect(b.subscription?.state).toBe('past_due');
      expect(ONB_ERROR_TABLE['SUBSCRIPTION_EXISTS'].action).toBe('goLanding');
    });

    it('a 402 refusal of a step write carries nextStep billing and the retry flags of the state', () => {
      for (const n of ['W7-business-write-refused', 'W8-business-write-refused']) {
        const b = bodyOf<{ code: string; nextStep?: string; retry?: { billingPortal?: boolean; checkout?: boolean } }>(n);
        expect(['PAYMENT_PAST_DUE', 'SUBSCRIPTION_CANCELLED'], n).toContain(b.code);
        expect(b.nextStep, n).toBe('billing');
        expect(b.retry?.billingPortal, n).toBe(true);
      }
    });
  });

  describe('catalogue keys named by the backend exist in the English catalogue', () => {
    const found = new Map<string, string>();
    const walk = (v: unknown, where: string): void => {
      if (typeof v === 'string') {
        if (/^onboarding\.[A-Za-z0-9_.]+$/.test(v)) found.set(v, where);
        return;
      }
      if (Array.isArray(v)) v.forEach((x) => walk(x, where));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, where));
    };
    it('every onboarding.<key> string in any answer is a key (titleKey, bodyKey, valueKey, reasonKey, copyKey ...)', () => {
      for (const n of names) walk(SAMPLES[n].body, n);
      expect(found.size).toBeGreaterThan(15);
      const missing = [...found].filter(([k]) => EN[k.slice('onboarding.'.length)] === undefined);
      // keys the screens fill from a prefix (never rendered as a whole string) are listed here with the reason
      expect(missing.map(([k, w]) => `${k} (${w})`)).toEqual([]);
    });
  });

  describe('notifications, help context, billing, number path, prompts, preferences', () => {
    it('notification rows have the catalogue title/body and a safe in-app action path', () => {
      for (const [n, s] of named(/-notifications(-after)?$/)) {
        if (!ok(s)) continue;
        const b = s.body as { notifications?: { id: string; kind: string; titleKey: string; bodyKey: string; actionPath?: string; readAt: string | null }[]; unread?: number };
        expect(typeof b.unread, n).toBe('number');
        for (const r of b.notifications ?? []) {
          expect(r.id, n).toMatch(/^[a-f0-9]{24}$/);
          expect(EN[r.titleKey.replace(/^onboarding\./, '')], `${n} ${r.titleKey}`).toBeTruthy();
          expect(EN[r.bodyKey.replace(/^onboarding\./, '')], `${n} ${r.bodyKey}`).toBeTruthy();
          if (r.actionPath) expect(r.actionPath.startsWith('/') && !r.actionPath.startsWith('//'), n).toBe(true);
        }
      }
    });

    it('help-context answers have the fields of the sheet (nullable support channels)', () => {
      for (const [n, s] of named(/-help-context/)) {
        if (!ok(s)) continue;
        const b = s.body as { businessName?: string | null; step?: number | null; stepKey?: string | null; supportEmail?: string | null; supportWhatsapp?: string | null; prefilledText?: string | null };
        expect(typeof b.prefilledText === 'string' || b.prefilledText === null, n).toBe(true);
        expect(b.supportEmail === null || typeof b.supportEmail === 'string', n).toBe(true);
        expect(b.supportWhatsapp === null || typeof b.supportWhatsapp === 'string', n).toBe(true);
      }
    });

    it('checkout and billing-portal return https Stripe-hosted urls only; refresh carries the subscription', () => {
      for (const [n, s] of named(/^Wd+-(checkout|billing-portal)(-again)?$|-billing-refresh$/)) {
        if (!ok(s)) continue;
        const b = s.body as { url?: string; changed?: boolean; subscription?: { state?: string } };
        if (n.includes('refresh')) {
          expect(typeof b.changed, n).toBe('boolean');
          expect(b.subscription?.state, n).toBeTruthy();
        } else {
          expect(safeHttps(b.url), n).toBeTruthy();
        }
      }
    });

    it('number/path answers: nextStep is a known step, Path B pauses', () => {
      const known = ['business', 'number', 'connect', 'approvals', 'customers', 'products', 'promotion', null];
      for (const [n, s] of named(/-number-path-/)) {
        if (!ok(s)) continue;
        const b = s.body as { path?: string; nextStep?: string | null };
        expect(known, n).toContain(b.nextStep ?? null);
      }
      expect(bodyOf<{ path: string }>('W3-number-path-B').path).toBe('B');
    });

    it('prompt, preferences and support-request answers are readable', () => {
      for (const [n, s] of named(/-prompts-|-preferences$|-number-support-request$|-number-ready$/)) {
        if (!ok(s)) continue;
        expect(typeof s.body, n).toBe('object');
      }
      const p = bodyOf<{ state: string }>('W3-prompts-customers-skipped');
      expect(p.state).toBe('skipped');
    });
  });
});

// ---- the approvals SCREEN renders every approvals + templates answer of the backend (jsdom) ----
const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
@Injectable()
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
  override t(key: string, params?: TranslateParams): string {
    return params ? `[${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}]` : `[${key}]`;
  }
}
@Component({ template: '' }) class Blank {}

describe('ApprovalsScreen with the backend answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const cases = named(/-approvals(-after-connect|-after-payment)?$/).filter(([, s]) => ok(s));
  const templatesFor = (): TemplateRowView[] => ((SAMPLES['W5-templates']?.body as OnbTemplatesResponse).templates ?? []) as TemplateRowView[];

  it.each(cases)('%s renders five rows without an error and nothing says verified for the payment row', async (_n, s) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('waflow_auth_token', 'token-A');
    const session$ = new BehaviorSubject<unknown>({ role: 'owner', user: { name: 'Sara' } });
    const api = {
      getState: () => new Subject<OnbState>(),
      approvals: (): Observable<OnbApprovalsResponse> => of(s.body as OnbApprovalsResponse),
      templates: (): Observable<OnbTemplatesResponse> => of({ templates: templatesFor() as never, capacity: { arabicRequested: false } }),
      connectionRefresh: () => of({}), paymentConfirmed: () => of({}), displayName: () => of({}), templatesSubmit: () => of({}),
      templateResubmit: () => of({}), event: () => of({}), helpContext: () => of({}), preferences: () => of({}), promptDone: () => of({}),
      notifications: () => of([]),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'setup/customers', component: Blank }, { path: 'setup/products', component: Blank }, { path: 'setup/promotion', component: Blank }]),
        { provide: I18nService, useClass: FakeI18n },
        { provide: OnbApiService, useValue: api },
        { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      ],
    });
    const state = TestBed.inject(OnbStateService);
    state.state.set({ enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'approvals', steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } } });
    state.loaded.set(true);
    vi.spyOn(state, 'refresh').mockImplementation(() => undefined);
    await TestBed.inject(I18nService).init();
    const fixture: ComponentFixture<ApprovalsScreen> = TestBed.createComponent(ApprovalsScreen);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('li[data-key]').length).toBe(5);
    expect(el.textContent ?? '').not.toMatch(/undefined|\[object|NaN/);
    fixture.destroy();
  });
});
