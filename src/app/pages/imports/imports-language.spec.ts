import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Imports } from './imports';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE_FIELDS = [
  { key: 'name', label: 'Name', required: true, type: 'string' },
  { key: 'phone', label: 'Phone', required: true, type: 'phone' },
  { key: 'email', label: 'Email', required: false, type: 'email' },
];
// What the backend appends for a FLAGGED workspace (D4): an extra optional field with a hint.
const FLAGGED_FIELDS = [...BASE_FIELDS, { key: 'language', label: 'Language', required: false, type: 'language', hint: 'ar, en, Arabic or English' }];
const RUN = { id: 'j1', status: 'completed', importedCount: 2, skippedDuplicateCount: 1, failedCount: 0, totalRows: 3 };

async function boot(opts: { fields: unknown[]; run: any; uiLang?: string; entityType?: string }) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  if (opts.uiLang) localStorage.setItem('waflow_ui_language', opts.uiLang);
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  if (opts.entityType) await TestBed.inject(Router).navigateByUrl(`/?entityType=${opts.entityType}`);
  const seen: string[] = [];
  const answer = () => {
    for (const req of http.match(() => true)) {
      const key = `${req.request.method} ${req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '')}`;
      seen.push(key);
      if (/\/api\/imports$/.test(key)) req.flush({ id: 'j1', headers: ['Name', 'Phone', 'Email', 'Lang'], fields: opts.fields, columnMapping: { name: 'Name', phone: 'Phone' } });
      else if (/\/imports\/j1\/mapping/.test(key)) req.flush({ summary: { totalRows: 3, clean: 2, duplicate: 1, error: 0, discrepancy: 0 }, preview: { clean: [{ rowIndex: 1, mapped: { name: 'A', phone: '1' } }], duplicate: [], error: [] }, discrepancies: [] });
      else if (/\/imports\/j1\/run/.test(key)) req.flush(opts.run);
      else req.flush([]);
    }
  };
  const fixture = TestBed.createComponent(Imports);
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
  const comp = fixture.componentInstance as any;
  comp.file = new File(['a'], 'a.csv');
  comp.upload();
  await settle();
  const step2 = fixture.nativeElement.cloneNode(true) as HTMLElement;
  comp.confirmMapping();
  await settle();
  comp.runImport();
  await settle();
  return { el: fixture.nativeElement as HTMLElement, step2, seen };
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Import wizard: language column hint and Arabic summary', () => {
  it('a response without hints or localization renders exactly the existing wizard (nothing new, no localization request)', async () => {
    const { el, step2, seen } = await boot({ fields: BASE_FIELDS, run: RUN });
    expect(step2.querySelectorAll('.mapping-row:not(.mapping-row-header)').length).toBe(3);
    expect(step2.querySelector('.mapping-row .text-muted')).toBeNull();
    expect(step2.textContent).not.toMatch(/ar, en, Arabic/);
    expect(el.querySelector('app-import-language-summary')).toBeNull();
    expect(text(el)).toContain('Imported 2. Updated 1 existing matches.');
    expect(seen.filter((s) => s.includes('/api/localization'))).toEqual([]);
    expect(seen.map((s) => s.replace(/^(\w+) .*?(\/api\/)/, '$1 $2'))).toEqual(['POST /api/imports', 'PATCH /api/imports/j1/mapping', 'POST /api/imports/j1/run']);
  });

  it('shows the server hint under the extra field in the mapping step, only on fields that carry one', async () => {
    const { step2 } = await boot({ fields: FLAGGED_FIELDS, run: RUN });
    const rows = Array.from(step2.querySelectorAll('.mapping-row:not(.mapping-row-header)'));
    expect(rows.length).toBe(4);
    expect(rows[3].textContent).toContain('Language');
    expect(rows[3].textContent).toContain('ar, en, Arabic or English');
    expect(rows[3].textContent).toContain('Optional');
    for (const r of rows.slice(0, 3)) expect(r.querySelector('.text-muted')).toBeNull();
  });

  it('shows the English Arabic-side summary under the success box when the run result carries it', async () => {
    const { el } = await boot({
      fields: FLAGGED_FIELDS,
      run: { ...RUN, localization: { languagesSet: 12, languagesProtected: 1, languagesFailed: 0, translationsSaved: 4, translationsUnchanged: 0, translationsFailed: 0 } },
    });
    expect(text(el)).toContain('Imported 2. Updated 1 existing matches.');
    expect(text(el)).toContain('Languages set: 12. Languages unchanged: 0.');
    expect(text(el)).not.toContain('Arabic texts saved as drafts'); // a customer import never reports Arabic texts
    expect(text(el)).toContain('Customers who chose their own language were left unchanged: 1.');
    expect(el.querySelector('.success-box')!.nextElementSibling!.tagName.toLowerCase()).toBe('app-import-language-summary');
  });

  it.each(['product', 'service'])('a %s import reports only the Arabic text counters', async (entityType) => {
    TestBed.resetTestingModule();
    const { el } = await boot({
      entityType,
      fields: FLAGGED_FIELDS,
      run: { ...RUN, localization: { languagesSet: 0, languagesProtected: 0, languagesFailed: 0, translationsSaved: 4, translationsUnchanged: 1, translationsFailed: 0 } },
    });
    expect(text(el)).toContain('Arabic texts saved as drafts: 4. Unchanged: 1.');
    expect(text(el)).not.toMatch(/Languages set|Languages unchanged/);
  });

  it('stays English when the stored language is Arabic', async () => {
    TestBed.resetTestingModule();
    const { el, step2 } = await boot({ fields: FLAGGED_FIELDS, run: { ...RUN, localization: { languagesSet: 1, translationsSaved: 0 } }, uiLang: 'ar' });
    expect(step2.textContent).not.toMatch(/\p{Script=Arabic}/u);
    expect(el.textContent).not.toMatch(/\p{Script=Arabic}/u);
    expect(text(el)).toContain('Languages set: 1.');
  });
});
