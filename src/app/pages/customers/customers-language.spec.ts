import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../shared/auth.service';
import { Customers } from './customers';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = 'GET /api/localization/settings';
const FIELD = 'app-customer-language-field';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CUSTOMER = { _id: 'c1', firstname: 'Aisha', lastname: 'Khan', phone: '966500000001', totalSpent: 100, loyaltyPoints: 30, marketingConsent: true, optedOut: false };
const DETAIL = { ...CUSTOMER, orders: [] };
const LANG_ROW = { id: 'c1', name: 'Aisha Khan', phone: '+966500000001', language: 'unknown', languageSource: null, effectiveLanguage: 'en', marketingConsent: true, optedOut: false };

// What the Customers screen asks the backend on opening and on viewing a profile, characterised from the
// code BEFORE the Arabic wiring.
const BASELINE_REQUESTS = ['GET /api/customers/c1', 'GET /api/customers?page=1&limit=50', 'GET /api/insights?surface=customers', 'GET /api/settings/loyalty'];

type Answer = Record<string, unknown>;
type Handler = (key: string, body: unknown) => { status?: number; body: any } | undefined;

async function boot(settingsAnswer: Answer, opts: { uiLang?: string; handler?: Handler } = {}) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  if (opts.uiLang) localStorage.setItem('waflow_ui_language', opts.uiLang);
  // SettingsService (behind the currency pipe) now watches the signed-in session so it can reset when the workspace changes.
  // The real AuthService would add its own GET /api/auth/me here (the app shell makes that call once at start-up, not the
  // Customers screen), so the screen is given a signed-in session stub and the request list below stays exactly as characterised.
  const authStub = { isLoggedIn: true, token: 'token-A', session: of(null), sessionSnapshot: null };
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: authStub }] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const bodies: Record<string, unknown> = {};
  const answer = () => {
    for (const req of http.match(() => true)) {
      const key = `${req.request.method} ${req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '')}`;
      seen.push(key);
      bodies[key] = req.request.body;
      const custom = opts.handler?.(key, req.request.body);
      if (custom) req.flush(custom.body, custom.status ? { status: custom.status, statusText: 'err' } : {});
      else if (key === SETTINGS) {
        const a = settingsAnswer as { __status?: number };
        if (a?.__status) req.flush({ error: 'x' }, { status: a.__status, statusText: 'err' });
        else req.flush(settingsAnswer);
      } else if (/^GET \/api\/customers\?/.test(key)) req.flush({ customers: [CUSTOMER], total: 1, pages: 1 });
      else if (/^GET \/api\/customers\/c1$/.test(key)) req.flush(DETAIL);
      else if (/localization\/customers\/c1\/language$/.test(key)) req.flush(LANG_ROW);
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Customers);
  fixture.detectChanges();
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      answer();
      fixture.componentRef.changeDetectorRef.markForCheck(); // zoneless test bed: plain-field state changes need a dirty mark
      fixture.detectChanges();
      await fixture.whenStable();
      await sleep(0);
    }
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  await settle();
  const comp = fixture.componentInstance;
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, comp, el, seen, bodies, settle };
}

describe('Customers screen: customer language field', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
    ['the merchant is not enabled (402)', { __status: 402 }],
    ['arabicEnabled is not literally true', settings({ arabicEnabled: 'yes' })],
  ])('when %s', (_name, answer) => {
    it('makes no request beyond the existing ones plus the one cached settings call, and renders no new control', async () => {
      const { comp, el, seen, settle } = await boot(answer);
      comp.viewDetail(CUSTOMER);
      await settle();
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      expect(seen.filter((s) => s !== SETTINGS).sort()).toEqual(BASELINE_REQUESTS);
      expect(el.querySelector(FIELD)).toBeNull();
      expect(el.querySelectorAll('.customer-meta .meta-item').length).toBe(4); // Phone, Total Spent, Loyalty Points, Marketing Consent
      expect(el.textContent).toContain('Aisha Khan');
      expect(el.textContent).not.toMatch(/Message language|embedded\./);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(answer, { uiLang: 'ar' });
      comp.viewDetail(CUSTOMER);
      await settle();
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });

  describe('when the merchant is flagged', () => {
    it('adds the language row at the end of the profile meta list and loads it with one GET', async () => {
      const { comp, el, seen, settle } = await boot(settings({ arabicEnabled: true }));
      expect(el.querySelector(FIELD)).toBeNull(); // no profile open yet: nothing new in the list
      comp.viewDetail(CUSTOMER);
      await settle();
      const field = el.querySelector(FIELD);
      expect(field).not.toBeNull();
      expect(field!.parentElement!.classList.contains('customer-meta')).toBe(true);
      expect(field!.previousElementSibling!.classList.contains('meta-item')).toBe(true);
      // the field's own text comes from a catalogue that loads on its own schedule (slow on a busy machine): wait for it, not a fixed number of ticks
      for (let i = 0; i < 80 && !(field!.textContent || '').includes('Message language'); i++) { await sleep(25); await settle(); }
      expect(field!.textContent).toContain('Message language');
      expect(seen.filter((s) => s.includes('/api/localization')).sort()).toEqual(['GET /api/localization/customers/c1/language', SETTINGS]);
      expect(el.querySelectorAll('.customer-meta .meta-item').length).toBe(4); // the existing four rows are untouched
    });

    it('changing the language calls only the documented PUT, with the language and nothing else', async () => {
      const { comp, el, seen, bodies, settle } = await boot(settings({ arabicEnabled: true }), {
        handler: (key) => (key === 'PUT /api/localization/customers/c1/language' ? { body: { ...LANG_ROW, language: 'ar', languageSource: 'merchant_set', effectiveLanguage: 'ar' } } : undefined),
      });
      comp.viewDetail(CUSTOMER);
      await settle();
      const select = el.querySelector<HTMLSelectElement>(`${FIELD} select`)!;
      select.value = 'ar';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(bodies['PUT /api/localization/customers/c1/language']).toEqual({ language: 'ar' });
      expect(seen.filter((s) => /^(PUT|POST|PATCH|DELETE)/.test(s))).toEqual(['PUT /api/localization/customers/c1/language']);
      expect(el.querySelector(FIELD)!.textContent).toContain('Set by you');
      expect(comp.selectedCustomer.firstname).toBe('Aisha'); // the profile data itself is not touched
    });

    it('a failing language lookup (404) hides the row and leaves the rest of the profile intact', async () => {
      const { comp, el, settle } = await boot(settings({ arabicEnabled: true }), {
        handler: (key) => (/localization\/customers\/c1\/language$/.test(key) ? { status: 404, body: { error: 'x' } } : undefined),
      });
      comp.viewDetail(CUSTOMER);
      await settle();
      expect(el.querySelector(`${FIELD} select`)).toBeNull();
      expect(el.querySelectorAll('.customer-meta .meta-item').length).toBe(4);
      expect(el.textContent).toContain('Aisha Khan');
      expect(el.querySelector('.detail-tabs')).not.toBeNull();
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(settings({ arabicEnabled: true }), { uiLang: 'ar' });
      comp.viewDetail(CUSTOMER);
      await settle();
      expect(el.querySelector(FIELD)!.textContent).toContain('Message language');
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });
});
