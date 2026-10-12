import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import type { CustomerLanguageList, CustomerLanguageRow, LanguageImportResult } from '../localization.types';
import { CustomersTab } from './customers-tab';

const ROW_UNKNOWN: CustomerLanguageRow = {
  id: 'c1', name: 'سارة العتيبي', phone: '+966501234567', language: 'unknown', languageSource: null,
  effectiveLanguage: 'ar', marketingConsent: true, optedOut: false,
};
const ROW_EN: CustomerLanguageRow = {
  id: 'c2', name: 'John Smith', phone: '+14155550123', language: 'en', languageSource: 'merchant_set',
  effectiveLanguage: 'en', marketingConsent: false, optedOut: false,
};

function list(items: CustomerLanguageRow[]): CustomerLanguageList {
  return { items, total: items.length, page: 1, limit: 50, counts: { en: 1, ar: 0, unknown: 1, total: 2 } };
}

function importResult(dryRun: boolean): LanguageImportResult {
  return {
    dryRun, encoding: 'utf-8', delimiter: ',', truncated: false,
    summary: { rows: 2, updated: 1, unchanged: 0, unmatched: 1, invalid: 0, duplicate: 0, protected: 0 },
    rows: [
      { line: 2, phone: '+966501234567', language: 'ar', outcome: 'updated' },
      { line: 3, phone: '+966500000000', language: 'en', outcome: 'unmatched' },
    ],
  };
}

describe('CustomersTab', () => {
  let api: {
    listCustomers: ReturnType<typeof vi.fn>;
    setCustomerLanguage: ReturnType<typeof vi.fn>;
    bulkSetCustomerLanguage: ReturnType<typeof vi.fn>;
    importCustomerLanguages: ReturnType<typeof vi.fn>;
    languageTemplateCsv: ReturnType<typeof vi.fn>;
    exportCustomerLanguagesCsv: ReturnType<typeof vi.fn>;
    getSettings: ReturnType<typeof vi.fn>;
  };
  let ui: LocUiService;
  let i18n: I18nService;
  let fixture: ComponentFixture<CustomersTab>;

  async function create(lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(CustomersTab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    api = {
      listCustomers: vi.fn(() => of(list([ROW_UNKNOWN, ROW_EN]))),
      setCustomerLanguage: vi.fn((id: string, language: 'en' | 'ar' | 'unknown') =>
        of({ ...ROW_UNKNOWN, id, language, languageSource: 'merchant_set' as const })),
      bulkSetCustomerLanguage: vi.fn(() => of({ updated: 2 })),
      importCustomerLanguages: vi.fn((_f: File, dryRun: boolean) => of(importResult(dryRun))),
      languageTemplateCsv: vi.fn(() => of(new Blob(['phone,language']))),
      exportCustomerLanguagesCsv: vi.fn(() => of(new Blob(['x']))),
      getSettings: vi.fn(() => of({ arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first' })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }] });
    ui = TestBed.inject(LocUiService);
  });

  afterEach(() => vi.useRealTimers());

  it('renders in English with the customers and no raw keys', async () => {
    const el = await create('en');
    expect(i18n.dir()).toBe('ltr');
    expect(el.textContent).toContain('Customer languages');
    expect(el.textContent).toContain('John Smith');
    expect(el.textContent).toContain('Will receive: Arabic (default)');
    expect(el.textContent).not.toMatch(/customers\.|status\./);
    expect(api.listCustomers).toHaveBeenCalledWith({ language: 'all', search: undefined, page: 1, limit: 50 });
  });

  it('renders in Arabic (rtl), keeping the phone as an LTR island and user text auto', async () => {
    const el = await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('لغات العملاء');
    expect(el.textContent).not.toMatch(/customers\.|status\./);
    expect(el.querySelector('[appPhone], [appphone]')?.getAttribute('dir') ?? 'ltr').toBe('ltr');
    expect(el.querySelector('.cust-name bdi')?.textContent).toBeTruthy();
    expect(el.querySelector('.cust-name')?.getAttribute('dir')).toBeNull();
  });

  it('filter chips call the API with the chosen language', async () => {
    const el = await create();
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.cust-chip'));
    chips[2].click();
    expect(api.listCustomers).toHaveBeenLastCalledWith({ language: 'ar', search: undefined, page: 1, limit: 50 });
    fixture.detectChanges();
    expect(el.querySelectorAll<HTMLButtonElement>('.cust-chip')[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('debounces the search by 300 ms', async () => {
    const el = await create();
    vi.useFakeTimers();
    const input = el.querySelector<HTMLInputElement>('.cust-search')!;
    api.listCustomers.mockClear();
    input.value = 'سا';
    input.dispatchEvent(new Event('input'));
    input.value = 'سار';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(299);
    expect(api.listCustomers).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(api.listCustomers).toHaveBeenCalledTimes(1);
    expect(api.listCustomers).toHaveBeenCalledWith({ language: 'all', search: 'سار', page: 1, limit: 50 });
  });

  it('changing the inline language saves it immediately', async () => {
    const el = await create();
    const select = el.querySelector<HTMLSelectElement>('.cust-select')!;
    select.value = 'ar';
    select.dispatchEvent(new Event('change'));
    expect(api.setCustomerLanguage).toHaveBeenCalledWith('c1', 'ar');
    fixture.detectChanges();
    expect(el.textContent).toContain('Saved');
  });

  it('shows a localised toast and reverts the select when saving fails', async () => {
    api.setCustomerLanguage.mockReturnValue(throwError(() => ({ status: 500, error: { code: 'NOPE' } })));
    const el = await create();
    const select = el.querySelector<HTMLSelectElement>('.cust-select')!;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    expect(select.value).toBe('unknown');
    expect(ui.toasts()[0].message).toBe(i18n.t('errors.generic'));
  });

  it('bulk change needs confirmation before calling the API', async () => {
    const el = await create();
    el.querySelector<HTMLInputElement>('thead input[type=checkbox]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.cust-bulk')).toBeTruthy();

    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    el.querySelectorAll<HTMLButtonElement>('.cust-bulk .btn')[1].click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.bulkSetCustomerLanguage).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    api.listCustomers.mockClear();
    el.querySelectorAll<HTMLButtonElement>('.cust-bulk .btn')[1].click();
    await fixture.whenStable();
    expect(api.bulkSetCustomerLanguage).toHaveBeenCalledWith(['c1', 'c2'], 'ar');
    expect(api.listCustomers).toHaveBeenCalled();
    expect(ui.toasts()[0].message).toBe('2 customers updated.');
  });

  it('shows a localised error when the list fails', async () => {
    api.listCustomers.mockReturnValue(throwError(() => ({ status: 0 })));
    const el = await create('ar');
    expect(el.querySelector('.loc-error')?.textContent).toContain(i18n.t('errors.network'));
  });

  it('import: dry run first, apply only after confirmation', async () => {
    const el = await create();
    el.querySelector<HTMLButtonElement>('.card-header .btn-primary')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-customers-import-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.getAttribute('accept')).toBe('.csv,.txt');
    const file = new File(['phone,language\n+966501234567,ar'], 'x.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const footerBtns = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('.modal-footer .btn'));
    footerBtns()[0].click(); // Check file
    expect(api.importCustomerLanguages).toHaveBeenCalledTimes(1);
    expect(api.importCustomerLanguages).toHaveBeenLastCalledWith(file, true);
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Nothing has been changed yet');
    expect(dialog.textContent).toContain('Not found');

    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    const applyBtn = () => footerBtns().find((b) => b.textContent!.includes('Apply changes'))!;
    applyBtn().click();
    await fixture.whenStable();
    expect(api.importCustomerLanguages).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValue(true);
    api.listCustomers.mockClear();
    applyBtn().click();
    await fixture.whenStable();
    expect(api.importCustomerLanguages).toHaveBeenLastCalledWith(file, false);
    expect(api.listCustomers).toHaveBeenCalled();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('The languages were updated');
  });

  it('import: shows a localised error for an unreadable file', async () => {
    api.importCustomerLanguages.mockReturnValue(throwError(() => ({ status: 400, error: { code: 'FILE_INVALID' } })));
    const el = await create('ar');
    el.querySelector<HTMLButtonElement>('.card-header .btn-primary')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-customers-import-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.csv')] });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    dialog.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')!.click();
    fixture.detectChanges();
    expect(dialog.querySelector('.loc-error')?.textContent).toContain(i18n.t('errors.FILE_INVALID'));
  });
});
