import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Flows } from './flows';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = 'GET /api/localization/settings';
const NEW_ELEMENTS = 'app-flow-language-chip, app-flow-language-panel';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FLOWS = [
  { _id: 'f1', name: 'Win back', triggerType: 'inactive_customer', status: 'active', promotionId: 'p1' },
  { _id: 'f2', name: 'Points', triggerType: 'post_purchase_points', status: 'paused', promotionId: null },
];
const TREES = {
  items: [
    { flowId: 'f1', flowName: 'Win back', triggerType: 'inactive_customer', status: 'active', promotionId: 'p1', promotionName: 'Eid', messageSource: 'promotion', nodes: [] },
    { flowId: 'f2', flowName: 'Points', triggerType: 'post_purchase_points', status: 'paused', promotionId: null, promotionName: null, messageSource: 'default_template', nodes: [] },
  ],
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
      } else if (/localization\/flows\/tree/.test(key)) req.flush(TREES);
      else if (/localization\/flows\/owners\/flow\/f1\/tree/.test(key)) req.flush({ ownerType: 'flow', ownerId: 'f1', messageSource: 'promotion', nodes: [] });
      else if (/\/api\/flows(\?|$)/.test(key)) req.flush(FLOWS);
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Flows);
  fixture.detectChanges();
  const settle = async (ms = 0) => {
    if (ms) await sleep(ms);
    for (let i = 0; i < 6; i++) {
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
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, seen, settle };
}

describe('Flows screen: Arabic wiring', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
    ['the settings call returns 402', { __status: 402 }],
  ])('when %s', (_name, answer) => {
    it('makes no request beyond the existing ones plus the one cached settings call', async () => {
      const { comp, seen, settle } = await boot(answer);
      comp.openDetail(FLOWS[0]);
      await settle();
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      expect(seen).toContain('GET /api/flows');
      expect(seen).toContain('GET /api/promotions');
    });

    it('renders the flow cards and detail panel exactly with the existing elements, no chip and no matrix', async () => {
      const { comp, el, fixture, settle } = await boot(answer);
      comp.openDetail(FLOWS[0]);
      await settle();
      fixture.detectChanges();
      expect(el.querySelectorAll('.flow-card').length).toBe(2);
      expect(el.querySelectorAll('.flow-actions').length).toBe(2);
      expect(el.textContent).toContain('Enrolled Customers');
      expect(el.querySelector(NEW_ELEMENTS)).toBeNull();
      expect(el.textContent).not.toMatch(/promolang|flowlang|Arabic/);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { el, settle } = await boot(answer, 'ar');
      await settle();
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });

  describe('when the merchant is flagged', () => {
    it('shows one language line per flow card from ONE tree request and the matrix in the detail panel', async () => {
      const { comp, el, fixture, seen, settle } = await boot(settings({ arabicEnabled: true }));
      await settle();
      expect(el.querySelectorAll('app-flow-language-chip').length).toBe(2);
      expect(seen.filter((s) => s === 'GET /api/localization/flows/tree').length).toBe(1);
      expect(el.textContent).toContain('Arabic: English only (fixed message)');
      comp.openDetail(FLOWS[0]);
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-flow-language-panel')).not.toBeNull();
      expect(seen).toContain('GET /api/localization/flows/owners/flow/f1/tree');
      // the existing controls are untouched
      expect(el.querySelectorAll('.flow-actions').length).toBe(2);
      expect(el.textContent).toContain('Enrolled Customers');
    });

    it('degrades to the plain screen when the tree endpoints are unavailable', async () => {
      localStorage.clear();
      TestBed.resetTestingModule();
      localStorage.setItem('waflow_auth_token', 'token-A');
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(Flows);
      fixture.detectChanges();
      for (let i = 0; i < 4; i++) {
        for (const req of http.match(() => true)) {
          if (req.request.url.endsWith('/localization/settings')) req.flush(settings({ arabicEnabled: true }));
          else if (req.request.url.includes('/localization/flows')) req.flush({ code: 'ARABIC_NOT_ENABLED' }, { status: 402, statusText: 'x' });
          else if (req.request.url.endsWith('/api/flows')) req.flush(FLOWS);
          else req.flush([]);
        }
        fixture.componentRef.changeDetectorRef.markForCheck();
        fixture.detectChanges();
        await fixture.whenStable();
        await sleep(0);
      }
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.flow-card').length).toBe(2);
      expect(el.querySelector('.flc')).toBeNull();
    });
  });
});
