import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { AuthService } from '../../shared/auth.service';
import { of } from 'rxjs';
import { Products } from './products';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = 'GET /api/localization/settings';
const FIELDS = 'app-arabic-item-fields';
const settings = (over: Record<string, unknown> = {}) => ({ arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first', ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRODUCT = { _id: 'pr1', name: 'Classic Oxford Shirt', description: 'Cotton', category: "Men's Clothing", basePrice: 25, images: ['a.png'], variants: [{ size: 'M', color: 'Blue', stock: 4, sku: 'S1' }] };
const TR = { name: 'قميص أكسفورد', description: 'قطن', status: 'draft', source: 'merchant', reviewedBy: null, reviewedAt: null, updatedAt: '2026-10-01T00:00:00Z' };

// What the Products screen asks the backend (characterised from the code BEFORE the Arabic wiring).
const BASELINE_OPEN = ['GET /api/products/categories', 'GET /api/products?page=1&limit=50', 'GET /api/settings/loyalty'];
// The exact bodies the existing save calls send today.
const CREATE_BODY = { name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9, images: [], variants: [] };
const UPDATE_BODY = { name: 'Renamed shirt', description: 'Cotton', category: "Men's Clothing", basePrice: 25, images: ['a.png'], variants: [{ size: 'M', color: 'Blue', stock: 4, sku: 'S1' }] };

type Answer = Record<string, unknown>;
type Handler = (key: string, body: unknown) => { status?: number; body: any } | undefined;

async function boot(settingsAnswer: Answer, opts: { uiLang?: string; handler?: Handler } = {}) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  if (opts.uiLang) localStorage.setItem('waflow_ui_language', opts.uiLang);
  // SettingsService (behind the currency pipe) watches the signed-in session so it can reset when the workspace changes. The real AuthService
  // would add its own GET /api/auth/me here (the app shell makes that call once at start-up, not this screen), so the screen is given a
  // signed-in session stub and the request list below stays exactly as characterised.
  const authStub = { isLoggedIn: true, token: 'token-A', session: of(null), sessionSnapshot: null };
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: authStub }] });
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
      } else if (/^GET \/api\/products\/categories/.test(key)) req.flush(['Footwear']);
      else if (/^GET \/api\/products\?/.test(key)) req.flush({ products: [PRODUCT], total: 1, pages: 1 });
      else if (/^POST \/api\/products$/.test(key)) req.flush({ _id: 'new1', ...(req.request.body as object) });
      else if (/^PUT \/api\/products\/pr1$/.test(key)) req.flush({ _id: 'pr1', ...(req.request.body as object) });
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Products);
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

describe('Products screen: Arabic name and description', () => {
  describe.each([
    ['the merchant is not flagged', settings()],
    ['the settings call fails (500)', { __status: 500 }],
    ['the merchant is not enabled (402)', { __status: 402 }],
    ['arabicEnabled is not literally true', settings({ arabicEnabled: 1 })],
  ])('when %s', (_name, answer) => {
    it('opens exactly as before: one settings call extra, no new control, save bodies unchanged', async () => {
      const { comp, el, seen, bodies, settle } = await boot(answer);
      expect(seen.filter((s) => s !== SETTINGS).sort()).toEqual(BASELINE_OPEN);
      comp.openAdd();
      await settle();
      expect(el.querySelector(FIELDS)).toBeNull();
      expect(el.textContent).not.toMatch(/Arabic name and description/);
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      comp.save();
      await settle();
      comp.openEdit(PRODUCT);
      await settle();
      expect(el.querySelector(FIELDS)).toBeNull();
      comp.form.name = 'Renamed shirt';
      comp.save();
      await settle();
      expect(seen.filter((s) => s === SETTINGS).length).toBe(1);
      expect(seen.filter((s) => s.includes('/api/localization')).length).toBe(1);
      expect(bodies['POST /api/products']).toEqual(CREATE_BODY);
      expect(bodies['PUT /api/products/pr1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['POST /api/products', 'PUT /api/products/pr1']);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(answer, { uiLang: 'ar' });
      comp.openAdd();
      await settle();
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });

  describe('when the merchant is flagged', () => {
    const flagged = () => settings({ arabicEnabled: true });

    it('shows the section under Description in the add and edit forms; only the edit form asks for the stored translation', async () => {
      const { comp, el, seen, settle } = await boot(flagged(), { handler: (key) => (/catalog\/product\/pr1\/translation$/.test(key) ? { body: { translation: TR } } : undefined) });
      comp.openAdd();
      await settle();
      const section = el.querySelector(FIELDS)!;
      expect(section).not.toBeNull();
      expect(section.previousElementSibling!.querySelector('textarea')).not.toBeNull(); // right after the Description group
      expect(seen.filter((s) => s.includes('/api/localization/catalog'))).toEqual([]);
      comp.showModal = false;
      comp.openEdit(PRODUCT);
      await settle();
      expect(seen.filter((s) => s.includes('/api/localization')).sort()).toEqual(['GET /api/localization/catalog/product/pr1/translation', SETTINGS]);
      expect(aif(el).name.value).toBe('قميص أكسفورد');
    });

    it('creating a product: the product POST body is exactly the existing one, then ONE translation PUT with the new id', async () => {
      const { comp, el, seen, bodies, settle, type } = await boot(flagged());
      comp.openAdd();
      await settle();
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      await settle();
      await type(aif(el).name, 'قميص جديد');
      await type(aif(el).desc, 'ناعم');
      comp.save();
      await settle();
      expect(bodies['POST /api/products']).toEqual(CREATE_BODY);
      expect(bodies['PUT /api/localization/catalog/product/new1/translation']).toEqual({ name: 'قميص جديد', description: 'ناعم', source: 'merchant' });
      expect(writes(seen)).toEqual(['POST /api/products', 'PUT /api/localization/catalog/product/new1/translation']);
      expect(comp.showModal).toBe(false);
      expect(seen.filter((s) => s.includes('/api/localization')).sort()).toEqual([SETTINGS, 'PUT /api/localization/catalog/product/new1/translation']);
    });

    it('typing nothing in the Arabic fields adds no request at all to the save', async () => {
      const { comp, seen, bodies, settle } = await boot(flagged());
      comp.openAdd();
      await settle();
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      comp.save();
      await settle();
      expect(bodies['POST /api/products']).toEqual(CREATE_BODY);
      expect(writes(seen)).toEqual(['POST /api/products']);
      expect(seen.filter((s) => s.includes('/api/localization'))).toEqual([SETTINGS]);
    });

    it('editing an existing product and leaving the Arabic text alone: the product PUT is unchanged and no translation PUT is made', async () => {
      const { comp, seen, bodies, settle } = await boot(flagged(), { handler: (key) => (/catalog\/product\/pr1\/translation$/.test(key) ? { body: { translation: TR } } : undefined) });
      comp.openEdit(PRODUCT);
      await settle();
      comp.form.name = 'Renamed shirt';
      comp.save();
      await settle();
      expect(bodies['PUT /api/products/pr1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['PUT /api/products/pr1']);
    });

    it('a failing Arabic save never blocks or alters the product save: it is saved, the modal closes, the list reloads, only a warning shows', async () => {
      const { comp, seen, bodies, settle, type, el, dialog } = await boot(flagged(), {
        handler: (key) => (/^PUT \/api\/localization\/catalog\/product\//.test(key) ? { status: 500, body: { error: 'boom' } } : undefined),
      });
      comp.openAdd();
      await settle();
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      await type(aif(el).name, 'قميص جديد');
      const listCalls = () => seen.filter((s) => s === 'GET /api/products?page=1&limit=50').length;
      const before = listCalls();
      comp.save();
      await settle();
      expect(bodies['POST /api/products']).toEqual(CREATE_BODY);
      expect(comp.showModal).toBe(false);
      expect(comp.saving).toBe(false);
      expect(listCalls()).toBe(before + 1);
      expect(dialog.state?.type).toBe('warning');
      expect(dialog.state?.message).toBe('The product was saved, but the Arabic text was not. Open the product again to retry.');
    });

    it('a description without an Arabic name saves the product and only warns', async () => {
      const { comp, seen, settle, type, el, dialog } = await boot(flagged());
      comp.openAdd();
      await settle();
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      await type(aif(el).desc, 'وصف فقط');
      comp.save();
      await settle();
      expect(writes(seen)).toEqual(['POST /api/products']);
      expect(dialog.state?.message).toBe('Add an Arabic name too. A description cannot be saved on its own.');
    });

    it('a failing product save does not touch the Arabic side at all', async () => {
      const { comp, seen, settle, type, el } = await boot(flagged(), { handler: (key) => (key === 'POST /api/products' ? { status: 400, body: { error: 'bad' } } : undefined) });
      comp.openAdd();
      await settle();
      comp.form = { ...comp.form, name: 'New tee', description: 'Soft', category: 'Footwear', basePrice: 9 };
      await type(aif(el).name, 'اسم');
      comp.save();
      await settle();
      expect(comp.showModal).toBe(true);
      expect(writes(seen)).toEqual(['POST /api/products']);
    });

    it('a 404 on the translation lookup hides the section; the form and its save keep working', async () => {
      const { comp, el, seen, bodies, settle } = await boot(flagged(), { handler: (key) => (/catalog\/product\/pr1\/translation$/.test(key) ? { status: 404, body: {} } : undefined) });
      comp.openEdit(PRODUCT);
      await settle();
      expect(el.querySelector(`${FIELDS} input`)).toBeNull();
      comp.form.name = 'Renamed shirt';
      comp.save();
      await settle();
      expect(bodies['PUT /api/products/pr1']).toEqual(UPDATE_BODY);
      expect(writes(seen)).toEqual(['PUT /api/products/pr1']);
    });

    it('stays English when the stored language is Arabic', async () => {
      TestBed.resetTestingModule();
      const { comp, el, settle } = await boot(flagged(), { uiLang: 'ar' });
      comp.openAdd();
      await settle();
      expect(el.querySelector(FIELDS)!.textContent).toContain('Arabic name and description (optional)');
      expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    });
  });
});
