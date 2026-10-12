import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ConversationFlowViewer } from '../../shared/conversation-flow-viewer/conversation-flow-viewer';
import { DialogService } from '../../shared/dialog.service';
import { Promotions } from './promotions';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

// What the merchant's Promotions screen asks the backend on opening, characterised from the code BEFORE the
// Arabic wiring: the promotions list, product categories, products, services and campaign insights.
const BASELINE_INIT_REQUESTS = [
  'GET /api/insights?surface=campaigns',
  'GET /api/products/categories',
  'GET /api/products?limit=500',
  'GET /api/promotions',
  'GET /api/services',
];
const SETTINGS = 'GET /api/localization/settings';
const NEW_ELEMENTS = 'app-promotion-language-panel, app-flow-language-panel, app-sender-language-note, app-node-language-strip';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROMO = { _id: 'p1', name: 'Eid sale', status: 'active', sentCount: 0, customerType: 'cash', entryNodeId: null };

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
      const key = `${req.request.method} ${req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/')}`;
      const normalised = key.replace(/^(GET|POST) .*?(\/api\/)/, '$1 $2');
      seen.push(normalised);
      if (normalised === SETTINGS) {
        const a = settingsAnswer as { __status?: number };
        if (a?.__status) req.flush({ error: 'x' }, { status: a.__status, statusText: 'err' });
        else req.flush(settingsAnswer);
      } else if (/\/products\?/.test(normalised)) req.flush({ products: [], total: 0 });
      else if (/message-nodes\/n1/.test(normalised)) req.flush({ _id: 'n1', bodyText: 'Hi there', buttons: [], templateStatus: 'approved' });
      else if (/localization\/flows\/owners\//.test(normalised)) req.flush({ ownerType: 'promotion', ownerId: 'p1', messageSource: 'promotion', nodes: [] });
      else if (/send-plan/.test(normalised)) req.flush({ byLanguage: { ar: 0, en: 0 } });
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Promotions);
  fixture.detectChanges();
  const settle = async (ms = 0) => {
    if (ms) await sleep(ms);
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
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, seen, http, settle };
}

describe('Promotions screen: Arabic wiring', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
    ['the settings call is unauthorised-like (404)', { __status: 404 }],
    ['arabicEnabled is not literally true', settings({ arabicEnabled: 'true' })],
  ])('when %s', (_name, answer) => {
    it('makes no request beyond the existing ones plus the one cached settings call', async () => {
      const { comp, seen, settle } = await boot(answer);
      comp.openCampaign(PROMO);
      await settle();
      const nonSettings = seen.filter((s) => s !== SETTINGS);
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      for (const r of BASELINE_INIT_REQUESTS) expect(nonSettings).toContain(r);
      expect(nonSettings.every((s) => !s.includes('localization'))).toBe(true);
    });

    it('renders no new element and keeps every existing control of the campaign panel', async () => {
      const { comp, el, fixture, settle } = await boot(answer);
      comp.openCampaign(PROMO);
      comp.selectedCustomerIds.add('c1');
      await settle();
      fixture.detectChanges();
      expect(el.querySelector(NEW_ELEMENTS)).toBeNull();
      expect(el.querySelector('.campaign-panel')).not.toBeNull();
      expect(el.textContent).toContain('Show Test Message');
      expect(el.textContent).toContain('Send WhatsApp to 1 Customers');
      expect(el.textContent).not.toMatch(/promolang|flowlang|Each customer gets their own language/);
    });

    it('opens the create/edit modal without the language panel or strips', async () => {
      const { comp, el, fixture, settle } = await boot(answer);
      comp.openViewEdit({ ...PROMO, entryNodeId: { _id: 'n1', templateStatus: 'approved' } });
      comp.editorViewMode = 'conversation';
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-conversation-flow-viewer')).not.toBeNull(); // the existing viewer is there
      expect(el.querySelector(NEW_ELEMENTS)).toBeNull();
      const viewer = fixture.debugElement.query(By.directive(ConversationFlowViewer)).componentInstance as ConversationFlowViewer;
      expect(viewer.languageOwnerId).toBeNull();
    });

    it('asks for confirmation with exactly today\'s text', async () => {
      const { comp, settle } = await boot(answer);
      const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(false);
      comp.openCampaign(PROMO);
      comp.selectedCustomerIds.add('c1');
      comp.selectedCustomerIds.add('c2');
      await settle();
      await comp.sendCampaign();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0]).toBe('Send WhatsApp promotion to 2 customers?');
    });

    it('keeps the English UI even if the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(answer, 'ar');
      comp.openCampaign(PROMO);
      await settle();
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
      expect(el.querySelector('[dir="rtl"]')).toBeNull();
    });
  });

  describe('selection (TrackedSet)', () => {
    it('is still a Set the page and template use unchanged', async () => {
      const { comp } = await boot(settings());
      comp.selectedCustomerIds.add('a');
      comp.selectedCustomerIds.add('b');
      comp.toggleCustomer?.({ _id: 'a' });
      expect(comp.selectedCustomerIds.size).toBe(1);
      expect(comp.selectedCustomerIds.has('b')).toBe(true);
      comp.clearAll();
      expect(comp.selectedCustomerIds.size).toBe(0);
    });
  });

  describe('when the merchant is flagged', () => {
    it('shows the language panel and asks for a plan for the selected customers', async () => {
      const { comp, el, fixture, seen, settle } = await boot(settings({ arabicEnabled: true }));
      comp.openCampaign(PROMO);
      comp.selectedCustomerIds.add('c1');
      comp.selectedCustomerIds.add('c2');
      await settle();
      expect(el.querySelector('app-promotion-language-panel')).not.toBeNull();
      await settle(500);
      fixture.detectChanges();
      expect(seen).toContain('POST /api/localization/promotions/p1/send-plan');
      // the existing controls are all still there, in the same panel
      expect(el.textContent).toContain('Show Test Message');
      expect(el.textContent).toContain('Send WhatsApp to 2 Customers');
    });

    it('adds the language panel under the conversation view, hands the viewer the owner id and reloads on save', async () => {
      const { comp, el, fixture, seen, settle } = await boot(settings({ arabicEnabled: true }));
      comp.openViewEdit({ ...PROMO, entryNodeId: { _id: 'n1', templateStatus: 'approved' } });
      comp.editorViewMode = 'conversation';
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-flow-language-panel')).not.toBeNull();
      const viewer = fixture.debugElement.query(By.directive(ConversationFlowViewer)).componentInstance as ConversationFlowViewer;
      expect(viewer.languageOwnerId).toBe('p1');
      expect(seen.filter((s) => s === 'GET /api/localization/flows/owners/promotion/p1/tree').length).toBe(1);
      comp.existingEntryNode = { ...comp.existingEntryNode, templateStatus: 'pending' }; // what a save / submit / refresh does
      await settle();
      expect(seen.filter((s) => s === 'GET /api/localization/flows/owners/promotion/p1/tree').length).toBe(2);
    });

    it('adds the loyalty note only for flagged merchants (modal)', async () => {
      const { comp, el, fixture, settle } = await boot(settings({ arabicEnabled: true }));
      comp.showLoyaltyModal = true;
      await settle();
      fixture.detectChanges();
      expect(el.querySelector('app-sender-language-note')).not.toBeNull();
    });
  });
});
