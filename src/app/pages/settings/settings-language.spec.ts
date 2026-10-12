import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = 'GET /api/localization/settings';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLAN = {
  selected: 12, eligible: 12, skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 },
  byLanguage: { ar: 4, en: 8 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'no_arabic_version', count: 4 }], blocked: [], warnings: [],
  canSend: true, needsAcknowledgement: true,
};

type Answer = Record<string, unknown>;

async function boot(settingsAnswer: Answer, uiLang?: string) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  if (uiLang) localStorage.setItem('waflow_ui_language', uiLang);
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const answer = () => {
    for (const req of http.match(() => true)) {
      const key = `${req.request.method} ${req.request.urlWithParams}`.replace(/^(GET|POST|PUT) .*?(\/api\/)/, '$1 $2');
      seen.push(key);
      if (key === SETTINGS) {
        const a = settingsAnswer as { __status?: number };
        if (a?.__status) req.flush({ error: 'x' }, { status: a.__status, statusText: 'err' });
        else req.flush(settingsAnswer);
      } else if (/consent-stats/.test(key)) req.flush({ eligibleForConsentRequest: 3, consented: 5, notYetConsented: 3, optedOut: 1, total: 9, recentEvents: [] });
      else if (/senders\/consent_request\/plan/.test(key)) req.flush(PLAN);
      else if (/whatsapp\/templates/.test(key)) req.flush({ templates: [] });
      else if (/settings\/loyalty|token-status/.test(key)) req.flush({});
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Settings);
  fixture.detectChanges();
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
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
  return { fixture, el: fixture.nativeElement as HTMLElement, seen };
}

describe('Settings screen: consent request language note', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
  ])('when %s', (_name, answer) => {
    it('makes no request beyond the existing ones plus the one cached settings call, and renders no note', async () => {
      const { el, seen } = await boot(answer);
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      expect(seen).toContain('GET /api/customers/consent-stats');
      expect(el.querySelector('app-sender-language-note')).toBeNull();
      expect(el.textContent).toContain('Send consent request to 3 customers');
      expect(el.textContent).not.toMatch(/promolang|flowlang|Each customer gets/);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { el } = await boot(answer, 'ar');
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });

  it('shows the note above the consent button for a flagged merchant with Arabic customers', async () => {
    const { el, seen } = await boot(settings({ arabicEnabled: true }));
    expect(seen).toContain('POST /api/localization/senders/consent_request/plan');
    expect(el.querySelector('app-sender-language-note')).not.toBeNull();
    expect(el.textContent).toContain('the Arabic opt-in message is not set up yet');
    expect(el.textContent).toContain('Send consent request to 3 customers'); // the existing button is unchanged
  });
});
