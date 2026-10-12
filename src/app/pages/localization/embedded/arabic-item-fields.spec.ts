import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { DialogService } from '../../../shared/dialog.service';
import type { CatalogKind, CatalogTranslation, CatalogTranslationLookup } from '../localization.types';
import { ArabicItemFields } from './arabic-item-fields';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const tr = (over: Partial<CatalogTranslation> = {}): CatalogTranslation => ({
  name: 'قميص أكسفورد', description: 'قطن ١٠٠٪', status: 'draft', source: 'merchant', reviewedBy: null, reviewedAt: null, updatedAt: '2026-10-01T00:00:00Z', ...over,
});

@Component({
  imports: [ArabicItemFields],
  template: `<app-arabic-item-fields [kind]="kind()" [refId]="refId()" />`,
})
class Host {
  kind = signal<CatalogKind>('product');
  refId = signal<string | null>(null);
  fields = viewChild.required(ArabicItemFields);
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
}

async function setup(api: Record<string, unknown>, init: { kind?: CatalogKind; refId?: string | null; uiLang?: 'ar' } = {}) {
  localStorage.clear();
  if (init.uiLang) localStorage.setItem('waflow_ui_language', init.uiLang);
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
  await TestBed.inject(I18nService).init();
  const dialog = TestBed.inject(DialogService);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.kind.set(init.kind ?? 'product');
  fixture.componentInstance.refId.set(init.refId ?? null);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const name = () => el.querySelector<HTMLInputElement>('input')!;
  const desc = () => el.querySelector<HTMLTextAreaElement>('textarea')!;
  const type = async (c: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    c.value = value;
    c.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  return { fixture, el, dialog, name, desc, type, fields: () => fixture.componentInstance.fields() };
}

const lookup = (translation: CatalogTranslation | null): CatalogTranslationLookup => ({ translation });

describe('ArabicItemFields', () => {
  it('for a new item shows empty RTL inputs with counters and makes no request', async () => {
    const api = { getCatalogTranslation: vi.fn(), saveCatalogTranslation: vi.fn() };
    const { el, name, desc, type } = await setup(api);
    expect(api.getCatalogTranslation).not.toHaveBeenCalled();
    expect(text(el)).toContain('Arabic name and description (optional)');
    expect(text(el)).toContain('Arabic name');
    expect(text(el)).toContain('Arabic description');
    expect(text(el)).toContain('0 / 200');
    expect(text(el)).toContain('0 / 2000');
    for (const c of [name(), desc()]) {
      expect(c.getAttribute('dir')).toBe('rtl');
      expect(c.getAttribute('lang')).toBe('ar');
    }
    expect(name().getAttribute('maxlength')).toBe('200');
    expect(desc().getAttribute('maxlength')).toBe('2000');
    expect(text(el)).not.toMatch(/embedded\.|catalog\.|status\./);
    await type(name(), 'قميص');
    expect(text(el)).toContain('4 / 200');
    expect(api.saveCatalogTranslation).not.toHaveBeenCalled(); // typing alone never saves
  });

  it('for an existing item loads the translation with one GET and shows its review status', async () => {
    const getCatalogTranslation = vi.fn(() => of(lookup(tr())));
    const { el, name, desc } = await setup({ getCatalogTranslation }, { kind: 'service', refId: 's1' });
    expect(getCatalogTranslation).toHaveBeenCalledTimes(1);
    expect(getCatalogTranslation).toHaveBeenCalledWith('service', 's1');
    expect(name().value).toBe('قميص أكسفورد');
    expect(desc().value).toBe('قطن ١٠٠٪');
    expect(text(el)).toContain('Draft');
    expect(text(el)).toContain('Not shown to customers yet.');
    expect(Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/arabic/catalog');
  });

  it('shows the reviewed badge for a reviewed translation', async () => {
    const { el } = await setup({ getCatalogTranslation: vi.fn(() => of(lookup(tr({ status: 'reviewed' })))) }, { refId: 'p1' });
    expect(text(el)).toContain('Reviewed');
    expect(text(el)).not.toContain('Not shown to customers yet.');
  });

  it('an existing item without a translation starts empty', async () => {
    const { name, desc, fields, dialog } = await setup({ getCatalogTranslation: vi.fn(() => of(lookup(null))), saveCatalogTranslation: vi.fn() }, { refId: 'p1' });
    expect(name().value).toBe('');
    expect(desc().value).toBe('');
    expect(await fields().commit('p1')).toBe(true);
    expect(dialog.state).toBeNull();
  });

  describe('commit()', () => {
    it('does nothing when nothing was typed (pristine new item)', async () => {
      const api = { getCatalogTranslation: vi.fn(), saveCatalogTranslation: vi.fn() };
      const { fields } = await setup(api);
      expect(await fields().commit('new1')).toBe(true);
      expect(api.saveCatalogTranslation).not.toHaveBeenCalled();
    });

    it('does nothing when an existing translation was left unchanged', async () => {
      const api = { getCatalogTranslation: vi.fn(() => of(lookup(tr()))), saveCatalogTranslation: vi.fn() };
      const { fields } = await setup(api, { refId: 'p1' });
      expect(await fields().commit('p1')).toBe(true);
      expect(api.saveCatalogTranslation).not.toHaveBeenCalled();
    });

    it('saves a new draft with ONE PUT (trimmed, source merchant) once the item has an id', async () => {
      const saveCatalogTranslation = vi.fn(() => of(tr()));
      const { fields, name, desc, type, dialog } = await setup({ getCatalogTranslation: vi.fn(), saveCatalogTranslation }, { kind: 'product' });
      await type(name(), '  قميص قطني  ');
      await type(desc(), 'مقاس ٤٢ - 100% قطن 👕 ');
      expect(await fields().commit('new1')).toBe(true);
      expect(saveCatalogTranslation).toHaveBeenCalledTimes(1);
      expect(saveCatalogTranslation).toHaveBeenCalledWith('product', 'new1', { name: 'قميص قطني', description: 'مقاس ٤٢ - 100% قطن 👕', source: 'merchant' });
      expect(dialog.state).toBeNull();
    });

    it('saves an edited existing translation with the item kind of the form', async () => {
      const saveCatalogTranslation = vi.fn(() => of(tr()));
      const { fields, name, type } = await setup({ getCatalogTranslation: vi.fn(() => of(lookup(tr()))), saveCatalogTranslation }, { kind: 'service', refId: 's1' });
      await type(name(), 'حلاقة');
      expect(await fields().commit('s1')).toBe(true);
      expect(saveCatalogTranslation).toHaveBeenCalledWith('service', 's1', { name: 'حلاقة', description: 'قطن ١٠٠٪', source: 'merchant' });
    });

    it('a description without a name is NOT saved: warns and returns false', async () => {
      const saveCatalogTranslation = vi.fn();
      const { fields, desc, type, dialog } = await setup({ getCatalogTranslation: vi.fn(), saveCatalogTranslation });
      await type(desc(), 'وصف فقط');
      expect(await fields().commit('new1')).toBe(false);
      expect(saveCatalogTranslation).not.toHaveBeenCalled();
      expect(dialog.state?.type).toBe('warning');
      expect(dialog.state?.message).toBe('Add an Arabic name too. A description cannot be saved on its own.');
    });

    it('clearing the name of a stored translation never deletes it and never warns', async () => {
      const saveCatalogTranslation = vi.fn();
      const { fields, name, type, dialog } = await setup({ getCatalogTranslation: vi.fn(() => of(lookup(tr({ description: '' })))), saveCatalogTranslation }, { refId: 'p1' });
      await type(name(), '');
      expect(await fields().commit('p1')).toBe(true);
      expect(saveCatalogTranslation).not.toHaveBeenCalled();
      expect(dialog.state).toBeNull();
    });

    it.each([['product', 'The product was saved, but the Arabic text was not. Open the product again to retry.'], ['service', 'The service was saved, but the Arabic text was not. Open the service again to retry.']] as const)(
      'a failing PUT only shows a warning (%s) and never throws',
      async (kind, message) => {
        const saveCatalogTranslation = vi.fn(() => throwError(() => ({ status: 500, error: { error: 'x' } })));
        const { fields, name, type, dialog } = await setup({ getCatalogTranslation: vi.fn(), saveCatalogTranslation }, { kind });
        await type(name(), 'اسم');
        await expect(fields().commit('id1')).resolves.toBe(false);
        expect(dialog.state?.type).toBe('warning');
        expect(dialog.state?.message).toBe(message);
      },
    );

    it('does nothing without an item id (the main save returned none)', async () => {
      const saveCatalogTranslation = vi.fn();
      const { fields, name, type } = await setup({ getCatalogTranslation: vi.fn(), saveCatalogTranslation });
      await type(name(), 'اسم');
      expect(await fields().commit(null)).toBe(true);
      expect(await fields().commit(undefined)).toBe(true);
      expect(saveCatalogTranslation).not.toHaveBeenCalled();
    });

    it('still saves when the host closes its modal (destroys the component) right after calling it', async () => {
      const saveCatalogTranslation = vi.fn(() => of(tr()));
      const { fixture, fields, name, type } = await setup({ getCatalogTranslation: vi.fn(), saveCatalogTranslation });
      await type(name(), 'اسم');
      const pending = fields().commit('id1');
      fixture.destroy();
      await pending;
      expect(saveCatalogTranslation).toHaveBeenCalledTimes(1);
    });

    it('does not save while the stored translation is still loading (it could overwrite it)', async () => {
      const pendingLoad = new Subject<CatalogTranslationLookup>();
      const saveCatalogTranslation = vi.fn();
      const { fields, el } = await setup({ getCatalogTranslation: vi.fn(() => pendingLoad), saveCatalogTranslation }, { refId: 'p1' });
      expect(text(el)).toContain('Loading...');
      expect(await fields().commit('p1')).toBe(true);
      expect(saveCatalogTranslation).not.toHaveBeenCalled();
    });
  });

  it.each([[402], [404]])('hides itself when the lookup answers %s and never saves', async (status) => {
    const saveCatalogTranslation = vi.fn();
    const { el, fields } = await setup({ getCatalogTranslation: vi.fn(() => throwError(() => ({ status }))), saveCatalogTranslation }, { refId: 'p1' });
    expect(text(el)).toBe('');
    expect(el.querySelector('input')).toBeNull();
    expect(await fields().commit('p1')).toBe(true);
    expect(saveCatalogTranslation).not.toHaveBeenCalled();
  });

  it('shows an inline retry on other lookup errors, with no inputs, and recovers on retry', async () => {
    const getCatalogTranslation = vi.fn().mockReturnValueOnce(throwError(() => ({ status: 500 }))).mockReturnValue(of(lookup(tr())));
    const saveCatalogTranslation = vi.fn();
    const { fixture, el, fields, name } = await setup({ getCatalogTranslation, saveCatalogTranslation }, { refId: 'p1' });
    expect(text(el)).toContain("We couldn't load the Arabic text.");
    expect(el.querySelector('input')).toBeNull();
    expect(await fields().commit('p1')).toBe(true);
    expect(saveCatalogTranslation).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('button')!.click();
    await settle(fixture);
    expect(getCatalogTranslation).toHaveBeenCalledTimes(2);
    expect(name().value).toBe('قميص أكسفورد');
  });

  it('stays English when the stored UI language is Arabic (labels are English; only the inputs are Arabic)', async () => {
    const { el } = await setup({ getCatalogTranslation: vi.fn(() => of(lookup(tr()))) }, { refId: 'p1', uiLang: 'ar' });
    expect(text(el)).toContain('Arabic name and description (optional)');
    expect(text(el)).not.toMatch(/\p{Script=Arabic}/u);
  });
});
