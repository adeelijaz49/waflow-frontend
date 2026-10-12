import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import type { CatalogImportResult, CatalogItemRow, CatalogList, CatalogTranslation } from '../localization.types';
import { CatalogTab } from './catalog-tab';

const TR_DRAFT: CatalogTranslation = {
  name: 'قهوة عربية', description: 'قهوة محمصة', status: 'draft', source: 'merchant',
  reviewedBy: null, reviewedAt: null, updatedAt: '2026-10-01T10:00:00Z',
};
const ROW_MISSING: CatalogItemRow = {
  kind: 'product', refId: 'p1', name: 'Arabic Coffee', description: 'Roasted coffee', category: 'Drinks', active: true, translation: null,
};
const ROW_DRAFT: CatalogItemRow = {
  kind: 'service', refId: 's1', name: 'Delivery', description: '', category: '', active: true, translation: TR_DRAFT,
};

function list(items: CatalogItemRow[]): CatalogList {
  return { items, total: items.length, page: 1, limit: 25, counts: { missing: 1, draft: 1, reviewed: 0 } };
}
function importResult(dryRun: boolean): CatalogImportResult {
  return {
    dryRun, encoding: 'utf-8', truncated: false,
    summary: { rows: 2, updated: 1, unchanged: 0, unmatched: 1, invalid: 0 },
    rows: [{ line: 2, name: 'Arabic Coffee', outcome: 'updated' }, { line: 3, name: 'X', outcome: 'ambiguous' }],
  };
}

describe('CatalogTab', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let ui: LocUiService;
  let i18n: I18nService;
  let fixture: ComponentFixture<CatalogTab>;

  async function create(lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(CatalogTab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  async function openEditor(el: HTMLElement, index: number): Promise<HTMLElement> {
    el.querySelectorAll<HTMLButtonElement>('tbody .btn')[index].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return el.querySelector<HTMLElement>('app-catalog-item-editor')!;
  }

  function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    api = {
      listCatalogItems: vi.fn(() => of(list([ROW_MISSING, ROW_DRAFT]))),
      saveCatalogTranslation: vi.fn((_k: string, _id: string, body: { name: string; description?: string }) =>
        of({ ...TR_DRAFT, name: body.name, description: body.description ?? '' })),
      reviewCatalogTranslation: vi.fn((_k: string, _id: string, status: 'draft' | 'reviewed') =>
        of({ ...TR_DRAFT, status, reviewedBy: 'Reviewer', reviewedAt: '2026-10-02T10:00:00Z' })),
      exportCatalogCsv: vi.fn(() => of(new Blob(['x']))),
      importCatalogCsv: vi.fn((_f: File, dryRun: boolean) => of(importResult(dryRun))),
      aiSuggestProductTranslation: vi.fn(() => of({ name: 'قهوة عربية أصيلة', description: 'قهوة محمصة طازجة', draft: true, warnings: [] })),
      getSettings: vi.fn(() => of({ arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first' })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }] });
    ui = TestBed.inject(LocUiService);
  });

  afterEach(() => vi.useRealTimers());

  it('renders in English with status counts and no raw keys', async () => {
    const el = await create('en');
    expect(i18n.dir()).toBe('ltr');
    expect(el.textContent).toContain('Products & services in Arabic');
    expect(el.textContent).toContain('Arabic Coffee');
    expect(el.textContent).toContain('Missing Arabic');
    expect(el.textContent).not.toMatch(/catalog\.|status\.review/);
    expect(api['listCatalogItems']).toHaveBeenCalledWith({ kind: 'all', search: undefined, status: 'all', page: 1, limit: 25 });
  });

  it('renders in Arabic (rtl) with user text auto and Arabic names forced rtl', async () => {
    const el = await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('المنتجات والخدمات بالعربية');
    expect(el.textContent).not.toMatch(/catalog\.|status\.review/);
    expect(el.querySelector('.cat-name > [appUserText], .cat-name > .loc-user-text')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('[lang=ar]')?.getAttribute('dir')).toBe('rtl');
  });

  it('kind and status filters call the API', async () => {
    const el = await create();
    el.querySelectorAll<HTMLButtonElement>('.cat-seg button')[2].click();
    expect(api['listCatalogItems']).toHaveBeenLastCalledWith({ kind: 'service', search: undefined, status: 'all', page: 1, limit: 25 });
    el.querySelectorAll<HTMLButtonElement>('.cat-chip')[1].click();
    expect(api['listCatalogItems']).toHaveBeenLastCalledWith({ kind: 'service', search: undefined, status: 'missing', page: 1, limit: 25 });
  });

  it('debounces the search by 300 ms', async () => {
    const el = await create();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('.cat-search')!;
    api['listCatalogItems'].mockClear();
    type(input, 'قه');
    type(input, 'قهوة');
    vi.advanceTimersByTime(299);
    expect(api['listCatalogItems']).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(api['listCatalogItems']).toHaveBeenCalledTimes(1);
    expect(api['listCatalogItems']).toHaveBeenCalledWith({ kind: 'all', search: 'قهوة', status: 'all', page: 1, limit: 25 });
  });

  it('shows a localised error when the list fails', async () => {
    api['listCatalogItems'].mockReturnValue(throwError(() => ({ status: 0 })));
    const el = await create('ar');
    expect(el.querySelector('.loc-error')?.textContent).toContain(i18n.t('errors.network'));
  });

  it('editor saves the Arabic payload as a merchant draft', async () => {
    const el = await create();
    const ed = await openEditor(el, 0);
    const name = ed.querySelector<HTMLInputElement>('#cat-name-ar')!;
    expect(name.getAttribute('dir')).toBe('rtl');
    expect(name.getAttribute('lang')).toBe('ar');
    const save = () => Array.from(ed.querySelectorAll<HTMLButtonElement>('.modal-footer .btn'))[0];
    expect(save().disabled).toBe(true);
    type(name, 'قهوة عربية');
    type(ed.querySelector<HTMLTextAreaElement>('#cat-desc-ar')!, 'قهوة محمصة');
    expect(save().disabled).toBe(false);
    api['listCatalogItems'].mockClear();
    save().click();
    expect(api['saveCatalogTranslation']).toHaveBeenCalledWith('product', 'p1', { name: 'قهوة عربية', description: 'قهوة محمصة', source: 'merchant' });
    expect(api['listCatalogItems']).toHaveBeenCalled();
    expect(ui.toasts()[0].message).toBe('Saved as a draft.');
  });

  it('AI suggestion is never applied without clicking Use this draft, then saves as source ai', async () => {
    const el = await create();
    const ed = await openEditor(el, 0);
    ed.querySelectorAll<HTMLButtonElement>('.loc-row .btn')[0].click();
    fixture.detectChanges();
    expect(api['aiSuggestProductTranslation']).toHaveBeenCalledWith({ name: 'Arabic Coffee', description: 'Roasted coffee' });
    expect(ed.querySelector('.cat-draft')?.textContent).toContain('قهوة عربية أصيلة');
    expect(ed.querySelector<HTMLInputElement>('#cat-name-ar')!.value).toBe('');
    expect(api['saveCatalogTranslation']).not.toHaveBeenCalled();

    ed.querySelector<HTMLButtonElement>('.cat-draft .btn-primary')!.click();
    fixture.detectChanges();
    expect(ed.querySelector<HTMLInputElement>('#cat-name-ar')!.value).toBe('قهوة عربية أصيلة');
    expect(ed.querySelector('.cat-draft')).toBeNull();
    expect(api['saveCatalogTranslation']).not.toHaveBeenCalled();

    ed.querySelectorAll<HTMLButtonElement>('.modal-footer .btn')[0].click();
    expect(api['saveCatalogTranslation']).toHaveBeenCalledWith('product', 'p1', { name: 'قهوة عربية أصيلة', description: 'قهوة محمصة طازجة', source: 'ai' });
  });

  it('discarding an AI draft leaves the fields untouched', async () => {
    const el = await create();
    const ed = await openEditor(el, 0);
    ed.querySelectorAll<HTMLButtonElement>('.loc-row .btn')[0].click();
    fixture.detectChanges();
    ed.querySelectorAll<HTMLButtonElement>('.cat-draft .btn')[1].click();
    fixture.detectChanges();
    expect(ed.querySelector('.cat-draft')).toBeNull();
    expect(ed.querySelector<HTMLInputElement>('#cat-name-ar')!.value).toBe('');
  });

  it('shows a localised error when the AI suggestion fails', async () => {
    api['aiSuggestProductTranslation'].mockReturnValue(throwError(() => ({ status: 500 })));
    const el = await create();
    const ed = await openEditor(el, 0);
    ed.querySelectorAll<HTMLButtonElement>('.loc-row .btn')[0].click();
    fixture.detectChanges();
    expect(ed.querySelector('.loc-error')?.textContent).toContain(i18n.t('ai.failed'));
  });

  it('marking reviewed needs confirmation', async () => {
    const el = await create();
    const ed = await openEditor(el, 1);
    const btn = () => ed.querySelectorAll<HTMLButtonElement>('.modal-footer .btn')[1];
    expect(btn().textContent).toContain('Mark reviewed');
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    btn().click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api['reviewCatalogTranslation']).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    btn().click();
    await fixture.whenStable();
    expect(api['reviewCatalogTranslation']).toHaveBeenCalledWith('service', 's1', 'reviewed');
    fixture.detectChanges();
    expect(ed.textContent).toContain('Reviewer');
  });

  it('review is disabled while there are unsaved edits', async () => {
    const el = await create();
    const ed = await openEditor(el, 1);
    type(ed.querySelector<HTMLInputElement>('#cat-name-ar')!, 'توصيل');
    expect(ed.querySelectorAll<HTMLButtonElement>('.modal-footer .btn')[1].disabled).toBe(true);
  });

  it('shows a localised error when saving fails', async () => {
    api['saveCatalogTranslation'].mockReturnValue(throwError(() => ({ status: 400, error: { code: 'NOPE' } })));
    const el = await create('ar');
    const ed = await openEditor(el, 0);
    type(ed.querySelector<HTMLInputElement>('#cat-name-ar')!, 'قهوة');
    ed.querySelectorAll<HTMLButtonElement>('.modal-footer .btn')[0].click();
    fixture.detectChanges();
    expect(ed.querySelector('.loc-error')?.textContent).toContain(i18n.t('errors.generic'));
  });

  it('import: dry run first, apply only after confirmation', async () => {
    const el = await create();
    el.querySelector<HTMLButtonElement>('.card-header .btn-primary')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-catalog-import-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File(['kind,id,name_ar\nproduct,p1,قهوة'], 'x.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const footerBtns = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('.modal-footer .btn'));
    footerBtns()[0].click();
    expect(api['importCatalogCsv']).toHaveBeenCalledTimes(1);
    expect(api['importCatalogCsv']).toHaveBeenLastCalledWith(file, true);
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Nothing has been changed yet');
    expect(dialog.textContent).toContain('Ambiguous');

    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    const applyBtn = () => footerBtns().find((b) => b.textContent!.includes('Apply changes'))!;
    applyBtn().click();
    await fixture.whenStable();
    expect(api['importCatalogCsv']).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValue(true);
    api['listCatalogItems'].mockClear();
    applyBtn().click();
    await fixture.whenStable();
    expect(api['importCatalogCsv']).toHaveBeenLastCalledWith(file, false);
    expect(api['listCatalogItems']).toHaveBeenCalled();
  });

  it('import: shows a localised error for an unreadable file', async () => {
    api['importCatalogCsv'].mockReturnValue(throwError(() => ({ status: 400, error: { code: 'FILE_INVALID' } })));
    const el = await create('ar');
    el.querySelector<HTMLButtonElement>('.card-header .btn-primary')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-catalog-import-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.csv')] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')!.click();
    fixture.detectChanges();
    expect(dialog.querySelector('.loc-error')?.textContent).toContain(i18n.t('errors.FILE_INVALID'));
  });
});
