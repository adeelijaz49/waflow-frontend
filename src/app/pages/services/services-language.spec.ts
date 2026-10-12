import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { Services } from './services';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = 'GET /api/localization/settings';
const FIELDS = 'app-arabic-item-fields';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SERVICE = { _id: 'sv1', name: 'Haircut', description: 'Quick cut', category: 'Salon', duration: 30, basePrice: 15, pointsPrice: 0, images: [] };
const TR = { name: 'قميص أكسفورد', description: 'قطن', status: 'draft', source: 'merchant', reviewedBy: null, reviewedAt: null, updatedAt: '2026-10-01T00:00:00Z' };

// What the Services screen asks the backend (characterised from the code BEFORE the Arabic wiring).
const BASELINE_OPEN = ['GET /api/services', 'GET /api/settings/loyalty'];
// The exact bodies the existing save calls send today.
const CREATE_BODY = { name: 'Massage', description: 'Relax', category: '', duration: 45, basePrice: 30, pointsPrice: 0, images: [] };
const UPDATE_BODY = { name: 'Haircut plus', description: 'Quick cut', category: 'Salon', duration: 30, basePrice: 15, pointsPrice: 0, images: [] };

type Answer = Record<string, unknown>;
type Handler = (key: string, body: unknown) => { status?: number; body: any } | undefined;

async function boot(settingsAnswer: Answer, opts: { uiLang?: string; handler?: Handler } = {}) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  if (opts.uiLang) localStorage.setItem('waflow_ui_language', opts.uiLang);
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const dialog = TestBed.inject(DialogService);
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
      } else if (/^GET \/api\/services$/.test(key)) req.flush([SERVICE]);
      else if (/^POST \/api\/services$/.test(key)) req.flush({ _id: 'new1', ...(req.request.body as object) });
      else if (/^PUT \/api\/services\/sv1$/.test(key)) req.flush({ _id: 'pr1', ...(req.request.body as object) });
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Services);
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
  const el = fixture.nativeElement as HTMLElement;
  const type = async (c: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    c.value = value;
    c.dispatchEvent(new Event('input'));
    await settle();
  };
  return { fixture, comp: fixture.componentInstance as any, el, seen, bodies, settle, dialog, type };
}

const aif = (el: HTMLElement) => ({ name: el.querySelector<HTMLInputElement>(`${FIELDS} input`)!, desc: el.querySelector<HTMLTextAreaElement>(`${FIELDS} textarea`)! });
const writes = (seen: string[]) => seen.filter((s) => /^(POST|PUT|PATCH|DELETE)/.test(s));

describe('Services screen: Arabic name and description', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
    ['the merchant is not enabled (402)', { __status: 402 }],
    ['arabicEnabled is not literally true', settings({ arabicEnabled: 1 })],
  ])('when %s', (_name, answer) => {
    it('opens exactly as before: one settings call extra, no new control, save bodies unchanged', async () => {
      const { comp, el, seen, bodies, settle } = await boot(answer);
      expect(seen.filter((s) => s !== SETTINGS).sort()).toEqual(BASELINE_OPEN);
      comp.openAddService();
      await settle();
      expect(el.querySelector(FIELDS)).toBeNull();
      expect(el.textContent).not.toMatch(/Arabic name and description/);
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      comp.saveService();
      await settle();
      comp.openEditService(SERVICE, new Event('click'));
      await settle();
      expect(el.querySelector(FIELDS)).toBeNull();
      comp.serviceForm.name = 'Haircut plus';
      comp.saveService();
      await settle();
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      expect(bodies['POST /api/services']).toEqual(CREATE_BODY);
      expect(bodies['PUT /api/services/sv1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['POST /api/services', 'PUT /api/services/sv1']);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(answer, { uiLang: 'ar' });
      comp.openAddService();
      await settle();
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });

  describe('when the merchant is flagged', () => {
    const flagged = () => settings({ arabicEnabled: true });

    it('shows the section under Description in the add and edit forms; only the edit form asks for the stored translation', async () => {
      const { comp, el, seen, settle } = await boot(flagged(), { handler: (key) => (/catalog\/service\/sv1\/translation$/.test(key) ? { body: { translation: TR } } : undefined) });
      comp.openAddService();
      await settle();
      const section = el.querySelector(FIELDS)!;
      expect(section).not.toBeNull();
      expect(section.previousElementSibling!.querySelector('textarea')).not.toBeNull(); // right after the Description group
      expect(seen.filter((s) => s.includes('/api/localization/catalog'))).toEqual([]);
      comp.showServiceModal = false;
      comp.openEditService(SERVICE, new Event('click'));
      await settle();
      expect(seen.filter((s) => s.includes('/api/localization')).sort()).toEqual(['GET /api/localization/catalog/service/sv1/translation', SETTINGS]);
      expect(aif(el).name.value).toBe('قميص أكسفورد');
    });

    it('creating a service: the service POST body is exactly the existing one, then ONE translation PUT with the new id', async () => {
      const { comp, el, seen, bodies, settle, type } = await boot(flagged());
      comp.openAddService();
      await settle();
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      await settle();
      await type(aif(el).name, 'قميص جديد');
      await type(aif(el).desc, 'ناعم');
      comp.saveService();
      await settle();
      expect(bodies['POST /api/services']).toEqual(CREATE_BODY);
      expect(bodies['PUT /api/localization/catalog/service/new1/translation']).toEqual({ name: 'قميص جديد', description: 'ناعم', source: 'merchant' });
      expect(writes(seen)).toEqual(['POST /api/services', 'PUT /api/localization/catalog/service/new1/translation']);
      expect(comp.showServiceModal).toBe(false);
      expect(seen.filter((s) => s.includes('/api/localization')).sort()).toEqual([SETTINGS, 'PUT /api/localization/catalog/service/new1/translation']);
    });

    it('typing nothing in the Arabic fields adds no request at all to the save', async () => {
      const { comp, seen, bodies, settle } = await boot(flagged());
      comp.openAddService();
      await settle();
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      comp.saveService();
      await settle();
      expect(bodies['POST /api/services']).toEqual(CREATE_BODY);
      expect(writes(seen)).toEqual(['POST /api/services']);
      expect(seen.filter((s) => s.includes('/api/localization'))).toEqual([SETTINGS]);
    });

    it('editing an existing service and leaving the Arabic text alone: the service PUT is unchanged and no translation PUT is made', async () => {
      const { comp, seen, bodies, settle } = await boot(flagged(), { handler: (key) => (/catalog\/service\/sv1\/translation$/.test(key) ? { body: { translation: TR } } : undefined) });
      comp.openEditService(SERVICE, new Event('click'));
      await settle();
      comp.serviceForm.name = 'Haircut plus';
      comp.saveService();
      await settle();
      expect(bodies['PUT /api/services/sv1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['PUT /api/services/sv1']);
    });

    it('a failing Arabic save never blocks or alters the service save: it is saved, the modal closes, the list reloads, only a warning shows', async () => {
      const { comp, seen, bodies, settle, type, el, dialog } = await boot(flagged(), {
        handler: (key) => (/^PUT \/api\/localization\/catalog\/service\//.test(key) ? { status: 500, body: { error: 'boom' } } : undefined),
      });
      comp.openAddService();
      await settle();
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      await type(aif(el).name, 'قميص جديد');
      const listCalls = () => seen.filter((s) => s === 'GET /api/services').length;
      const before = listCalls();
      comp.saveService();
      await settle();
      expect(bodies['POST /api/services']).toEqual(CREATE_BODY);
      expect(comp.showServiceModal).toBe(false);
      expect(comp.savingService).toBe(false);
      expect(listCalls()).toBe(before + 1);
      expect(dialog.state?.type).toBe('warning');
      expect(dialog.state?.message).toBe('The service was saved, but the Arabic text was not. Open the service again to retry.');
    });

    it('a description without an Arabic name saves the service and only warns', async () => {
      const { comp, seen, settle, type, el, dialog } = await boot(flagged());
      comp.openAddService();
      await settle();
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      await type(aif(el).desc, 'وصف فقط');
      comp.saveService();
      await settle();
      expect(writes(seen)).toEqual(['POST /api/services']);
      expect(dialog.state?.message).toBe('Add an Arabic name too. A description cannot be saved on its own.');
    });

    it('a failing service save does not touch the Arabic side at all', async () => {
      const { comp, seen, settle, type, el } = await boot(flagged(), { handler: (key) => (key === 'POST /api/services' ? { status: 400, body: { error: 'bad' } } : undefined) });
      comp.openAddService();
      await settle();
      comp.serviceForm = { ...comp.serviceForm, name: 'Massage', description: 'Relax', duration: 45, basePrice: 30 };
      await type(aif(el).name, 'اسم');
      comp.saveService();
      await settle();
      expect(comp.showServiceModal).toBe(true);
      expect(writes(seen)).toEqual(['POST /api/services']);
    });

    it('a 404 on the translation lookup hides the section; the form and its save keep working', async () => {
      const { comp, el, seen, bodies, settle } = await boot(flagged(), { handler: (key) => (/catalog\/service\/sv1\/translation$/.test(key) ? { status: 404, body: {} } : undefined) });
      comp.openEditService(SERVICE, new Event('click'));
      await settle();
      expect(el.querySelector(`${FIELDS} input`)).toBeNull();
      comp.serviceForm.name = 'Haircut plus';
      comp.saveService();
      await settle();
      expect(bodies['PUT /api/services/sv1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['PUT /api/services/sv1']);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(flagged(), { uiLang: 'ar' });
      comp.openAddService();
      await settle();
      expect(el.querySelector(FIELDS)!.textContent).toContain('Arabic name and description (optional)');
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });
});
