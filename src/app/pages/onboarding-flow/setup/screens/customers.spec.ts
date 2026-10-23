import { Component, Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { ApiService } from '../../../../services/api.service';
import { LocalizationFlagService } from '../../../../services/localization-flag.service';
import { AuthService } from '../../../../shared/auth.service';
import { LocUiService } from '../../../localization/shared/loc-ui.service';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import { blobToText, parseCsvText, parseCustomerFileText, parsePasteText, readFileBytes } from '../../customers/csv';
import { PHONE_MAX_DIGITS, PHONE_MIN_DIGITS } from '../../customers/phone';
import { OnbApiService } from '../../onb-api.service';
import { OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type { OnbState } from '../../onb.types';
import { CustomersMethodScreen } from './customers-method';
import { CustomersOneScreen } from './customers-one';
import { CustomersOptinScreen } from './customers-optin';
import { CustomersPasteScreen } from './customers-paste';
import { CustomersPreviewScreen } from './customers-preview';
import { CustomersResultScreen } from './customers-result';
import { CustomersUploadScreen } from './customers-upload';
import { OnbTestChoice } from './promotion';

vi.setConfig({ testTimeout: 30000 });

const BOM = String.fromCodePoint(0xfeff);
const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
// The text of a key shows its params, so the specs can assert the numbers a screen passes to the catalogue.
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
  override t(key: string, params?: TranslateParams): string {
    return params ? `[${key} ${JSON.stringify(params)}]` : `[${key}]`;
  }
}
@Component({ template: '' }) class Blank {}

type Fn = ReturnType<typeof vi.fn>;
interface JobRec { id: string; entity: string; attested: boolean; file: File }
interface Summary { totalRows?: number; clean?: number; duplicate?: number; error?: number; discrepancy?: number }
interface Rig {
  state: OnbStateService;
  flow: CustomersFlowService;
  router: Router;
  nav: Fn;
  api: Record<string, Fn>;
  onb: Record<string, Fn>;
  jobs: JobRec[];
  help: OnbHelpService;
  toasts: LocUiService;
  arabic: ReturnType<typeof signal<boolean>>;
}

const stateOf = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'customers',
  steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' }, approvals: { status: 'waiting' } },
  prompts: { customers: { state: 'pending' }, products: { state: 'pending' } }, ...over,
});

function rig(opts: { summaries?: Summary[]; runs?: Record<string, unknown>[]; discrepancies?: number[][]; mapping?: Record<string, string>; arabic?: boolean; country?: string } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const jobs: JobRec[] = [];
  const session$ = new BehaviorSubject<unknown>({ role: 'owner', user: { name: 'Sara', phone: '', email: '' }, workspace: { name: 'W' } });
  const arabic = signal(opts.arabic === true);
  const api: Record<string, Fn> = {
    uploadImport: vi.fn((entity: string, file: File, attested: boolean) => {
      const id = `job${jobs.length + 1}`;
      jobs.push({ id, entity, attested, file });
      return of({
        id, entityType: entity, columnMapping: opts.mapping ?? { name: 'Name', phone: 'Phone', email: 'Email', notes: 'Notes' },
        fields: [{ key: 'name', required: true }, { key: 'phone', required: true }, { key: 'email' }, { key: 'notes' }],
      });
    }),
    updateImportMapping: vi.fn((id: string) => {
      const i = jobs.findIndex((j) => j.id === id);
      const s = opts.summaries?.[i] ?? {};
      const summary = { totalRows: 1, clean: 1, duplicate: 0, error: 0, discrepancy: 0, ...s };
      return of({ id, status: 'ready', summary, preview: {}, discrepancies: (opts.discrepancies?.[i] ?? []).map((rowIndex) => ({ rowIndex })) });
    }),
    runImport: vi.fn((id: string) => {
      const i = jobs.findIndex((j) => j.id === id);
      return of({ id, status: 'completed', importedCount: 1, skippedDuplicateCount: 0, failedCount: 0, ...(opts.runs?.[i] ?? {}) });
    }),
    downloadImportErrorReport: vi.fn(() => of(new Blob(['Name,Phone,Email,Notes,Reason\nBad,12,,,Phone is not a valid phone number']))),
    createCustomer: vi.fn(() => of({ _id: 'c1' })),
  };
  const onb: Record<string, Fn> = {
    getState: vi.fn(() => new Subject<OnbState>()),
    promptDone: vi.fn(() => of({})),
    event: vi.fn(() => of({})),
    helpContext: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: onb },
      { provide: ApiService, useValue: api },
      { provide: LocalizationFlagService, useValue: { arabicEnabled: arabic } },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  state.state.set(stateOf(opts.country ? { business: { country: opts.country } } : {}));
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigateByUrl') as unknown as Fn;
  return {
    state, flow: TestBed.inject(CustomersFlowService), router, nav, api, onb, jobs, help: TestBed.inject(OnbHelpService),
    toasts: TestBed.inject(LocUiService), arabic,
  };
}

async function mount<T>(cls: Type<T>): Promise<{ f: ComponentFixture<T>; el: HTMLElement }> {
  await TestBed.inject(I18nService).init();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const f = TestBed.createComponent(cls);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement };
}

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const click = (f: ComponentFixture<unknown>, el: HTMLElement, sel: string): void => {
  const b = el.querySelector<HTMLElement>(sel);
  if (!b) throw new Error(`no element ${sel}`);
  b.click();
  f.detectChanges();
};
const settle = async (f: ComponentFixture<unknown>): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 15));
    f.detectChanges();
  }
};
function chooseFile(f: ComponentFixture<unknown>, el: HTMLElement, sel: string, file: File): void {
  const input = el.querySelector<HTMLInputElement>(sel)!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  f.detectChanges();
}
const csvFileOf = (text: string, name = 'list.csv'): File => new File([text], name, { type: 'text/csv' });
const urlsOf = (nav: Fn): string[] => nav.mock.calls.map((c) => String(c[0]));
const lastUrl = (nav: Fn): string => urlsOf(nav)[urlsOf(nav).length - 1];
const fileText = (j: JobRec): Promise<string> => blobToText(j.file);
/** A valid 10-digit number per index (the generated 5,000 row lists must not trip the phone check). */
const tenDigits = (i: number): string => `0500${String(i).padStart(6, '0')}`;
const REASON_INVALID = `[onboarding.customers.reason.invalidPhone {"min":${PHONE_MIN_DIGITS},"max":${PHONE_MAX_DIGITS}}]`;
const ARABIC_DIGITS_PHONE = String.fromCodePoint(0x660, 0x665, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667);
const setClipboard = (writeText: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
};

const NO_COLUMN = 'Name,Phone\nSara Ahmed,0501234567\nOmar Ali,0559876543\nLina Nasser,0561112222\n';
const WITH_COLUMN =
  'Name,Phone,Opted in (yes/no),Opt-in source,Opt-in date\n' +
  'Sara Ahmed,0501234567,yes,In store form,2026-09-01\n' +
  'Omar Ali,0559876543,no,,\n' +
  'Lina Nasser,0561112222,yes,Web form,2026-09-02\n';

/** Puts a parsed list and the merchant's answer straight into the flow (the screens before it are tested separately). */
function seed(r: Rig, csv: string, consent: 'rows' | 'all' | 'none', attest: boolean): void {
  r.flow.setParsed(parseCustomerFileText(csv), 'list.csv');
  r.flow.setConsent(consent, attest);
}

let blobs: Blob[] = [];
beforeEach(() => {
  blobs = [];
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:test';
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

// ------------------------------------------------------------------------------------------------------------------

describe('customers: method screen', () => {
  it('asks one question with three answers and "Skip for now", and focuses the heading', async () => {
    rig();
    const { el } = await mount(CustomersMethodScreen);
    const h1 = el.querySelector('h1')!;
    expect(textOf(h1)).toBe('[onboarding.customers.method.title]');
    expect(el.querySelectorAll('button.onb-answer')).toHaveLength(3);
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(0);
    expect(textOf(el)).toContain('[onboarding.common.skip]');
    expect(textOf(el)).toContain('[onboarding.help.cta]');
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
  });

  it.each([['#onb-cust-upload', '/setup/customers/upload'], ['#onb-cust-paste', '/setup/customers/paste'], ['#onb-cust-one', '/setup/customers/one']])(
    '%s goes to %s',
    async (sel, url) => {
      const r = rig();
      const { f, el } = await mount(CustomersMethodScreen);
      click(f, el, sel);
      expect(lastUrl(r.nav)).toBe(url);
    },
  );

  it('entering the screen forgets a list from an earlier visit', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'all', true);
    await mount(CustomersMethodScreen);
    expect(r.flow.parsed()).toBeNull();
    expect(r.flow.attest()).toBe(false);
    expect(r.flow.consent()).toBeNull();
  });

  it('Skip for now records POST /prompts/customers {state: skipped}, tells the merchant and goes to the dashboard', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersMethodScreen);
    click(f, el, '#onb-cust-skip');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(r.onb['promptDone']).toHaveBeenCalledWith('customers', 'skipped');
    expect(lastUrl(r.nav)).toBe('/dashboard');
    expect(r.toasts.toasts().map((t) => t.message)).toEqual(['[onboarding.customers.skipped]']);
    expect(r.state.state()?.prompts?.customers?.state).toBe('skipped');
  });

  it('a failing skip shows the mapped error, primes "Need help?" and stays on the screen', async () => {
    const r = rig();
    r.onb['promptDone'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(CustomersMethodScreen);
    click(f, el, '#onb-cust-skip');
    const alert = el.querySelector('[role="alert"]')!;
    expect(textOf(alert)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(r.help.lastError()).toBe('ONB_NETWORK');
    expect(lastUrl(r.nav)).not.toBe('/dashboard');
    expect((el.querySelector('#onb-cust-skip') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('customers: upload screen', () => {
  it('downloads the client-generated template: header only (opt-in / source / date columns, no sample customer, no Language when Arabic is off)', async () => {
    rig();
    const { f, el } = await mount(CustomersUploadScreen);
    click(f, el, '#onb-cust-template');
    expect(blobs).toHaveLength(1);
    const text = await blobToText(blobs[0]);
    expect([...new Uint8Array(await readFileBytes(blobs[0])).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const t = parseCsvText(text, ',');
    expect(t[0]).toEqual(['Name', 'Phone', 'Opted in (yes/no)', 'Opt-in source', 'Opt-in date', 'Email', 'Notes']);
    expect(t).toHaveLength(1);
  });

  it('adds the Language column to the template only when Arabic is on', async () => {
    rig({ arabic: true });
    const { f, el } = await mount(CustomersUploadScreen);
    click(f, el, '#onb-cust-template');
    const t = parseCsvText(await blobToText(blobs[0]), ',');
    expect(t[0][t[0].length - 1]).toBe('Language (en/ar)');
    expect(t).toHaveLength(1);
  });

  it('the Check button is disabled until a file is chosen', async () => {
    rig();
    const { f, el } = await mount(CustomersUploadScreen);
    const check = el.querySelector<HTMLButtonElement>('#onb-cust-check')!;
    expect(check.disabled).toBe(true);
    chooseFile(f, el, '#onb-cust-file', csvFileOf(NO_COLUMN, 'sara.csv'));
    expect(check.disabled).toBe(false);
    expect(textOf(el.querySelector('#onb-cust-file-name')!)).toBe('sara.csv');
  });

  it('a list without an opt-in column goes to the opt-in question and uploads NOTHING yet', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf(NO_COLUMN));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/optin'));
    expect(r.flow.parsed()?.rows).toHaveLength(3);
    expect(r.flow.attest()).toBe(false);
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('a list with rows marked yes goes to the opt-in question', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf(WITH_COLUMN));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/optin'));
    expect(r.flow.parsed()?.hasOptInColumn).toBe(true);
    expect(r.flow.fileName()).toBe('list.csv');
  });

  it('an opt-in column with no yes row skips the question: nobody is confirmed and the preview follows', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone,Opted in\nSara,0501234567,no\nOmar,0502345678,\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/preview'));
    expect(r.flow.consent()).toBe('none');
    expect(r.flow.attest()).toBe(false);
  });

  it('reads a semicolon file with a BOM and Arabic-Indic digits and turns the phone into a full "+966..." number', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    const phone = String.fromCodePoint(0x660, 0x665, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667);
    chooseFile(f, el, '#onb-cust-file', csvFileOf(`${BOM}Name;Phone\r\nSara;${phone}\r\n`));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(r.flow.parsed()).not.toBeNull());
    expect(r.flow.parsed()?.rows[0].phone).toBe('+966501234567');
    expect(r.flow.parsed()?.rows[0].digits).toBe('966501234567');
  });

  it.each([['SA', '+966501234567'], ['AE', '+971501234567'], [undefined, '+966501234567']])(
    'the country of Step 1 (%s) decides how a local number is read: %s', async (country, expected) => {
      const r = rig({ country });
      const { f, el } = await mount(CustomersUploadScreen);
      chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\nSara,0501234567\nOmar,501234567\n'));
      click(f, el, '#onb-cust-check');
      await vi.waitFor(() => expect(r.flow.parsed()).not.toBeNull());
      expect(r.flow.parsed()?.rows.map((x) => x.phone)).toEqual([expected, expected]);
    });

  it('"Another country": a local number is a skipped row (the country code is needed), one with + or 00 is fine', async () => {
    const r = rig({ country: 'OTHER' });
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\nSara,07700900123\nOmar,+44 7700 900124\nLina,0044 7700 900125\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(r.flow.parsed()).not.toBeNull());
    expect(r.flow.parsed()?.rows.map((x) => x.phone)).toEqual(['+447700900124', '+447700900125']);
    expect(r.flow.parsed()?.rejected.map((x) => [x.name, x.reason])).toEqual([['Sara', 'country_code_needed']]);
  });

  it('says which country a number without a country code is read in, and which columns are used', async () => {
    rig({ country: 'AE' });
    const { el } = await mount(CustomersUploadScreen);
    const note = el.querySelector('[data-phone-note]')!;
    expect(note.getAttribute('data-country')).toBe('AE');
    expect(textOf(note)).toBe('[onboarding.customers.phone.note {"country":"[onboarding.country.AE]","code":"971"}]');
    expect(textOf(el.querySelector('#onb-cust-columns')!)).toBe('[onboarding.customers.upload.columns]');
    TestBed.resetTestingModule();
    rig({ country: 'OTHER', arabic: true });
    const other = await mount(CustomersUploadScreen);
    expect(textOf(other.el.querySelector('[data-phone-note]')!)).toContain('[onboarding.customers.phone.noteOther]');
    expect(textOf(other.el.querySelector('[data-phone-note] [dir="ltr"]')!)).toBe('+44 7xxx xxxxxx');
    expect(textOf(other.el.querySelector('#onb-cust-columns')!)).toBe('[onboarding.customers.upload.columnsLang]'); // language is read only when Arabic is on
  });

  it('a stray quote is not swallowed into the rest of the file: the other customers are kept and the lines that could not be read are counted', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\nSara,0501234567\n"Broken,0509999999\nOmar,0502345678\nLina,0503456789\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/optin'));
    expect(r.flow.parsed()?.rows.map((x) => x.name)).toEqual(['Sara', 'Omar', 'Lina']);
    expect(r.flow.parsed()?.unreadable).toBe(1);
    expect(r.flow.parsed()?.rejected.map((x) => x.reason)).toEqual(['unreadable']);
  });

  it('rows whose phone is not a number are skipped rows (reason invalid_phone), never uploaded; the rest goes on', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\nSara,0501234567\nTiny,123\nLetters,05012abc\nPlus,050+1234567\nLong,1234567890123456\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/optin'));
    expect(r.flow.parsed()?.rows.map((x) => x.name)).toEqual(['Sara']);
    expect(r.flow.parsed()?.rejected.map((x) => [x.name, x.reason])).toEqual([
      ['Tiny', 'invalid_phone'], ['Letters', 'invalid_phone'], ['Plus', 'invalid_phone'], ['Long', 'invalid_phone'],
    ]);
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('a file where EVERY phone is bad has nothing to ask about: straight to the preview, nothing uploaded', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\nTiny,123\nLetters,abc\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/preview'));
    expect(r.flow.consent()).toBe('none');
    expect(r.flow.parsed()?.rows).toEqual([]);
    expect(r.flow.parsed()?.rejected).toHaveLength(2);
  });

  it('a spreadsheet shows the "save as CSV or use the full import page" hint with the link, and sends nothing', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', new File(['PK'], 'customers.xlsx'));
    click(f, el, '#onb-cust-check');
    await settle(f);
    const hint = el.querySelector('#onb-cust-hint')!;
    expect(textOf(hint)).toContain('[onboarding.customers.upload.xlsx]');
    const link = hint.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/imports?entityType=customer');
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
    expect(r.flow.parsed()).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(hint));
  });

  it('a file without a phone column says so and offers the full import page', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,City\nSara,Riyadh\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(el.querySelector('#onb-cust-hint')).not.toBeNull());
    expect(textOf(el.querySelector('#onb-cust-hint')!)).toContain('[onboarding.customers.upload.noPhone]');
    expect(el.querySelector('#onb-cust-hint a')!.getAttribute('href')).toBe('/imports?entityType=customer');
    expect(urlsOf(r.nav)).not.toContain('/setup/customers/optin');
  });

  it('a file without a name column says so', async () => {
    rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Phone,City\n0501,Riyadh\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(el.querySelector('#onb-cust-hint')).not.toBeNull());
    expect(textOf(el.querySelector('#onb-cust-hint')!)).toContain('[onboarding.customers.upload.noName]');
  });

  it('more than 5,000 rows -> ONB_IMPORT_TOO_MANY', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    const rows = Array.from({ length: 5001 }, (_, i) => `C${i},${tenDigits(i)}`).join('\n');
    chooseFile(f, el, '#onb-cust-file', csvFileOf(`Name,Phone\n${rows}\n`));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_TOO_MANY]');
    expect(r.help.lastError()).toBe('ONB_IMPORT_TOO_MANY');
    expect(r.flow.parsed()).toBeNull();
  });

  it('exactly 5,000 rows is accepted', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersUploadScreen);
    const rows = Array.from({ length: 5000 }, (_, i) => `C${i},${tenDigits(i)}`).join('\n');
    chooseFile(f, el, '#onb-cust-file', csvFileOf(`Name,Phone\n${rows}\n`));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/optin'));
    expect(r.flow.parsed()?.rows).toHaveLength(5000);
  });

  it.each([['notes.pdf', 'hello'], ['empty.csv', '']])('%s -> ONB_IMPORT_BAD_FILE', async (name, body) => {
    rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', new File([body], name));
    click(f, el, '#onb-cust-check');
    await settle(f);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_BAD_FILE]');
  });

  it('a header-only file -> ONB_IMPORT_NO_ROWS', async () => {
    rig();
    const { f, el } = await mount(CustomersUploadScreen);
    chooseFile(f, el, '#onb-cust-file', csvFileOf('Name,Phone\n'));
    click(f, el, '#onb-cust-check');
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_NO_ROWS]');
  });

  it('focuses the heading on entry, has "Need help?" and exactly one primary button', async () => {
    rig();
    const { el } = await mount(CustomersUploadScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
    expect(textOf(el)).toContain('[onboarding.help.cta]');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
  });
});

describe('customers: paste screen', () => {
  const type = (f: ComponentFixture<unknown>, el: HTMLElement, value: string): void => {
    const ta = el.querySelector<HTMLTextAreaElement>('#onb-cust-paste')!;
    ta.value = value;
    ta.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  it('is disabled while empty, parses name/phone lines and goes to the opt-in question', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-check')!.disabled).toBe(true);
    type(f, el, 'Sara, 0501234567\nOmar; 0559876543\nLina\t0561112222\n');
    click(f, el, '#onb-cust-check');
    expect(lastUrl(r.nav)).toBe('/setup/customers/optin');
    expect(r.flow.parsed()?.rows.map((x) => x.name)).toEqual(['Sara', 'Omar', 'Lina']);
    expect(r.flow.fileName()).toBeNull();
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('keeps the text when the merchant comes back', async () => {
    const r = rig();
    r.flow.pasteText.set('Sara, 0501');
    const { el } = await mount(CustomersPasteScreen);
    expect(el.querySelector<HTMLTextAreaElement>('#onb-cust-paste')!.value).toBe('Sara, 0501');
  });

  it('lines without a name or a phone are "can\'t add" rows, not errors', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, 'Sara, 0501234567\nOmar\n0509999999\n');
    click(f, el, '#onb-cust-check');
    expect(r.flow.parsed()?.rows).toHaveLength(1);
    expect(r.flow.parsed()?.rejected.map((x) => x.reason)).toEqual(['missing_phone', 'missing_name']);
  });

  it('bad numbers are "can\'t add" rows with the invalid-phone reason; a number in Arabic digits is fine and becomes a full number', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, `Sara, 0501234567\nOmar, 12345\nLina, 050+1234567\nNour, abc\nHessa, ${ARABIC_DIGITS_PHONE}\nKhaled, 1234567890123456`);
    click(f, el, '#onb-cust-check');
    expect(lastUrl(r.nav)).toBe('/setup/customers/optin');
    expect(r.flow.parsed()?.rows.map((x) => [x.name, x.phone])).toEqual([['Sara', '+966501234567'], ['Hessa', '+966501234567']]);
    expect(r.flow.parsed()?.rejected.map((x) => [x.name, x.reason])).toEqual([
      ['Omar', 'invalid_phone'], ['Lina', 'invalid_phone'], ['Nour', 'invalid_phone'], ['Khaled', 'invalid_phone'],
    ]);
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('reads the numbers with the country of Step 1, shows the sample line of that country and says how a number without a code is read', async () => {
    const r = rig({ country: 'KW' });
    const { f, el } = await mount(CustomersPasteScreen);
    expect(el.querySelector<HTMLTextAreaElement>('#onb-cust-paste')!.placeholder).toBe('Sara Ahmed, 51234567');
    expect(textOf(el.querySelector('[data-phone-note]')!)).toBe('[onboarding.customers.phone.note {"country":"[onboarding.country.KW]","code":"965"}]');
    expect(el.querySelector('#onb-cust-paste')!.getAttribute('aria-describedby')).toBe('onb-cust-paste-note');
    expect(el.querySelector('#onb-cust-paste-note')).not.toBeNull();
    type(f, el, 'Sara, 51234567\nOmar, 0501234567\n');
    click(f, el, '#onb-cust-check');
    expect(r.flow.parsed()?.rows.map((x) => x.phone)).toEqual(['+96551234567']);
    expect(r.flow.parsed()?.rejected.map((x) => [x.name, x.reason])).toEqual([['Omar', 'invalid_phone']]);
  });

  it('"Another country": the line asks for the country code, a local number is rejected with that reason', async () => {
    const r = rig({ country: 'OTHER' });
    const { f, el } = await mount(CustomersPasteScreen);
    expect(el.querySelector<HTMLTextAreaElement>('#onb-cust-paste')!.placeholder).toBe('Sara Ahmed, +447700900123');
    expect(textOf(el.querySelector('[data-phone-note]')!)).toContain('[onboarding.customers.phone.noteOther]');
    type(f, el, 'Sara, 07700900123\nOmar, +44 7700 900124');
    click(f, el, '#onb-cust-check');
    expect(r.flow.parsed()?.rows.map((x) => x.phone)).toEqual(['+447700900124']);
    expect(r.flow.parsed()?.rejected.map((x) => x.reason)).toEqual(['country_code_needed']);
  });

  it('an optional third value says yes or no for each line; an empty one says nothing', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, 'Sara, 0501234567, yes\nOmar, 0502345678, no\nLina, 0503456789, maybe\nNour, 0504567890\nHessa, 0505678901,');
    click(f, el, '#onb-cust-check');
    expect(r.flow.parsed()?.rows.map((x) => [x.name, x.optIn])).toEqual([['Sara', 'yes'], ['Omar', 'no'], ['Lina', 'no'], ['Nour', 'unset'], ['Hessa', 'unset']]);
    expect(r.flow.parsed()?.hasOptInColumn).toBe(false);
    expect(lastUrl(r.nav)).toBe('/setup/customers/optin');
  });

  it('a line whose quote is never closed is counted as a line that could not be read; the others are kept', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, 'Sara, 0501234567\n"Omar, 0502345678\nLina, 0503456789');
    click(f, el, '#onb-cust-check');
    expect(r.flow.parsed()?.rows.map((x) => x.name)).toEqual(['Sara', 'Lina']);
    expect(r.flow.parsed()?.unreadable).toBe(1);
    expect(r.flow.parsed()?.rejected.map((x) => x.reason)).toEqual(['unreadable']);
  });

  it('a list of only bad numbers goes straight to the preview (nothing to ask about)', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, 'Omar, 12345\nLina, abc');
    click(f, el, '#onb-cust-check');
    expect(lastUrl(r.nav)).toBe('/setup/customers/preview');
    expect(r.flow.consent()).toBe('none');
  });

  it('only unusable lines go straight to the preview (nothing to ask about)', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, 'Omar\n');
    click(f, el, '#onb-cust-check');
    expect(lastUrl(r.nav)).toBe('/setup/customers/preview');
    expect(r.flow.consent()).toBe('none');
  });

  it('more than 5,000 lines -> ONB_IMPORT_TOO_MANY', async () => {
    rig();
    const { f, el } = await mount(CustomersPasteScreen);
    type(f, el, Array.from({ length: 5001 }, (_, i) => `C${i}, ${tenDigits(i)}`).join('\n'));
    click(f, el, '#onb-cust-check');
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_TOO_MANY]');
  });

  it('focuses the heading', async () => {
    rig();
    const { el } = await mount(CustomersPasteScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('customers: opt-in screen (compliance)', () => {
  it('a deep link without a list goes back to the first screen and renders nothing', async () => {
    const r = rig();
    const { el } = await mount(CustomersOptinScreen);
    expect(urlsOf(r.nav)).toContain('/setup/customers');
    expect(el.querySelector('h1')).toBeNull();
  });

  it('nothing is selected, the box is not there and Continue is disabled on entry', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const { el } = await mount(CustomersOptinScreen);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.customers.optin.title]');
    expect(el.querySelectorAll('input[type="radio"]:checked')).toHaveLength(0);
    expect(el.querySelector('#onb-cust-attest')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-optin-continue')!.disabled).toBe(true);
    expect(textOf(el)).toContain('[onboarding.customers.optin.warning]');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
  });

  it('"Yes" shows the attestation UNTICKED and Continue stays disabled until it is ticked', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const { f, el } = await mount(CustomersOptinScreen);
    click(f, el, '#onb-cust-optin-yes');
    const box = el.querySelector<HTMLInputElement>('#onb-cust-attest')!;
    expect(box.checked).toBe(false);
    expect(textOf(el)).toContain('[onboarding.customers.attest]');
    const next = el.querySelector<HTMLButtonElement>('#onb-cust-optin-continue')!;
    expect(next.disabled).toBe(true);
    next.click();
    expect(r.flow.consent()).toBeNull();
    expect(urlsOf(r.nav)).not.toContain('/setup/customers/preview');
    box.click();
    f.detectChanges();
    expect(next.disabled).toBe(false);
    next.click();
    expect(r.flow.consent()).toBe('all');
    expect(r.flow.attest()).toBe(true);
    expect(lastUrl(r.nav)).toBe('/setup/customers/preview');
  });

  it('"Not sure" continues without any tick and imports everyone WITHOUT consent', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const { f, el } = await mount(CustomersOptinScreen);
    click(f, el, '#onb-cust-optin-unsure');
    expect(el.querySelector('#onb-cust-attest')).toBeNull();
    click(f, el, '#onb-cust-optin-continue');
    expect(r.flow.consent()).toBe('none');
    expect(r.flow.attest()).toBe(false);
    expect(lastUrl(r.nav)).toBe('/setup/customers/preview');
  });

  it('changing the answer clears a ticked box (Yes, tick, Not sure, Yes: unticked again)', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const { f, el } = await mount(CustomersOptinScreen);
    click(f, el, '#onb-cust-optin-yes');
    click(f, el, '#onb-cust-attest');
    expect(el.querySelector<HTMLInputElement>('#onb-cust-attest')!.checked).toBe(true);
    click(f, el, '#onb-cust-optin-unsure');
    click(f, el, '#onb-cust-optin-yes');
    expect(el.querySelector<HTMLInputElement>('#onb-cust-attest')!.checked).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-optin-continue')!.disabled).toBe(true);
  });

  it('a file with its own opt-in column asks about the rows marked yes and confirms ONLY those (rows mode)', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(WITH_COLUMN), 'list.csv');
    const { f, el } = await mount(CustomersOptinScreen);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.customers.optin.fileTitle]');
    expect(textOf(el)).toContain('[onboarding.customers.optin.fileYes]');
    click(f, el, '#onb-cust-optin-yes');
    click(f, el, '#onb-cust-attest');
    click(f, el, '#onb-cust-optin-continue');
    expect(r.flow.consent()).toBe('rows');
    expect(r.flow.attest()).toBe(true);
  });

  it('Back returns to the screen the list came from', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(NO_COLUMN), 'list.csv');
    const a = await mount(CustomersOptinScreen);
    click(a.f, a.el, '.onb-bar-links .onb-link');
    expect(lastUrl(r.nav)).toBe('/setup/customers/upload');
    TestBed.resetTestingModule();
    const r2 = rig();
    r2.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const b = await mount(CustomersOptinScreen);
    click(b.f, b.el, '.onb-bar-links .onb-link');
    expect(lastUrl(r2.nav)).toBe('/setup/customers/paste');
  });

  it('focuses the heading', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    const { el } = await mount(CustomersOptinScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('customers: opt-in screen, consent columns that are not understood and opt-out columns (R6-03)', () => {
  const SHOPIFY = 'Name,Phone,Accepts Marketing\nSara Ahmed,0501234567,yes\nOmar Ali,0559876543,no\nLina Nasser,0561112222,yes\n';

  it('a consent-like column we do not understand is named, the "all of them agreed" answer is OFF and only "Not sure" is left', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(SHOPIFY), 'list.csv');
    const { f, el } = await mount(CustomersOptinScreen);
    expect(r.flow.shortcutBlocked()).toBe(true);
    const notice = el.querySelector('#onb-cust-optin-unknown')!;
    expect(textOf(notice)).toContain('[onboarding.customers.optin.unknownBlocked]');
    expect(textOf(notice.querySelector('[data-columns="unknown"]')!)).toBe('Accepts Marketing');
    expect(notice.querySelector('[data-columns="unknown"] li')!.getAttribute('dir')).toBe('auto'); // the merchant's own header text
    const yes = el.querySelector<HTMLInputElement>('#onb-cust-optin-yes')!;
    expect(yes.disabled).toBe(true);
    expect(yes.getAttribute('aria-describedby')).toBe('onb-cust-optin-unknown');
    yes.click(); // a disabled radio cannot be picked
    f.detectChanges();
    expect(el.querySelector('#onb-cust-attest')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-optin-continue')!.disabled).toBe(true);
    click(f, el, '#onb-cust-optin-unsure');
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-optin-continue')!.disabled).toBe(false);
    click(f, el, '#onb-cust-optin-continue');
    expect(r.flow.consent()).toBe('none');
    expect(r.flow.attest()).toBe(false);
    expect(lastUrl(r.nav)).toBe('/setup/customers/preview');
  });

  it('the answer cannot be forced either: the flow refuses "all agreed" for such a list, even with a tick', () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(SHOPIFY), 'list.csv');
    r.flow.setConsent('all', true);
    expect(r.flow.consent()).toBe('none');
    expect(r.flow.attest()).toBe(false);
  });

  it('with a Not sure answer the whole file is ONE unattested job: the "yes" of the ignored column grants nothing', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(SHOPIFY), 'list.csv');
    r.flow.setConsent('all', true); // refused (see above), the screen only offers none
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.jobs.map((j) => j.attested)).toEqual([false]);
    expect(r.api['uploadImport'].mock.calls.every((c) => c[2] === false)).toBe(true);
    expect(parseCsvText(await fileText(r.jobs[0]), ',').length).toBe(4);
  });

  it('a list WITH the recognised opt-in column and another consent-like column keeps its answer, and says the other column was not used', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText('Name,Phone,Opted in,Accepts Marketing\nSara,0501234567,yes,no\nOmar,0502345678,no,yes\n'), 'list.csv');
    const { f, el } = await mount(CustomersOptinScreen);
    expect(r.flow.shortcutBlocked()).toBe(false);
    expect(textOf(el.querySelector('#onb-cust-optin-unknown')!)).toContain('[onboarding.customers.optin.unknownIgnored]');
    expect(textOf(el.querySelector('[data-columns="unknown"]')!)).toBe('Accepts Marketing');
    expect(el.querySelector<HTMLInputElement>('#onb-cust-optin-yes')!.disabled).toBe(false);
    click(f, el, '#onb-cust-optin-yes');
    click(f, el, '#onb-cust-attest');
    click(f, el, '#onb-cust-optin-continue');
    expect(r.flow.consent()).toBe('rows');
    expect(r.flow.attest()).toBe(true);
  });

  it('an opt-out column is named; the rows it marks are always added without permission, even after "all of them agreed"', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText('Name,Phone,Unsubscribed\nSara,0501234567,\nOmar,0502345678,yes\nLina,0503456789,no\n'), 'list.csv');
    const { f, el } = await mount(CustomersOptinScreen);
    expect(textOf(el.querySelector('#onb-cust-optin-optout')!)).toContain('[onboarding.customers.optin.optOutFound]');
    expect(textOf(el.querySelector('[data-columns="optout"]')!)).toBe('Unsubscribed');
    expect(el.querySelector('#onb-cust-optin-unknown')).toBeNull();
    click(f, el, '#onb-cust-optin-yes');
    click(f, el, '#onb-cust-attest');
    click(f, el, '#onb-cust-optin-continue');
    expect(r.flow.consent()).toBe('all');
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.jobs.map((j) => j.attested)).toEqual([true, false]);
    expect((await fileText(r.jobs[0])).includes('Omar')).toBe(false);
    expect(parseCsvText(await fileText(r.jobs[0]), ',').slice(1).map((x) => x[0])).toEqual(['Sara', 'Lina']);
    expect(parseCsvText(await fileText(r.jobs[1]), ',').slice(1).map((x) => x[0])).toEqual(['Omar']);
  });

  it('no notice at all for a list without such columns', async () => {
    const r = rig();
    r.flow.setParsed(parseCustomerFileText(NO_COLUMN), 'list.csv');
    const { el } = await mount(CustomersOptinScreen);
    expect(el.querySelector('#onb-cust-optin-unknown')).toBeNull();
    expect(el.querySelector('#onb-cust-optin-optout')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#onb-cust-optin-yes')!.disabled).toBe(false);
  });

  it('a pasted list is never blocked (it has no header row)', () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567, yes'), null);
    expect(r.flow.shortcutBlocked()).toBe(false);
  });
});

describe('customers: import jobs and the opt-in split (compliance)', () => {
  it('"Yes, all of them" + the tick: ONE attested job with every row, canonical headers, mapping confirmed', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'all', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.jobs()).not.toBeNull());
    f.detectChanges();
    expect(r.api['uploadImport']).toHaveBeenCalledTimes(1);
    expect(r.jobs[0]).toMatchObject({ entity: 'customer', attested: true });
    expect(r.api['uploadImport'].mock.calls[0][2]).toBe(true);
    const t = parseCsvText(await fileText(r.jobs[0]), ',');
    expect(t[0]).toEqual(['Name', 'Phone', 'Email', 'Notes']);
    expect(t.slice(1).map((x) => x[0])).toEqual(['Sara Ahmed', 'Omar Ali', 'Lina Nasser']);
    expect(r.api['updateImportMapping']).toHaveBeenCalledWith('job1', expect.objectContaining({ name: 'Name', phone: 'Phone' }));
    expect(el.querySelector('#onb-cust-prev-add')).not.toBeNull();
  });

  it('every phone goes to the engine as "+<digits>" (never as typed), so the server cannot read it as a Saudi number', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'all', true);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(parseCsvText(await fileText(r.jobs[0]), ',').slice(1).map((x) => x[1])).toEqual(['+966501234567', '+966559876543', '+966561112222']);
    TestBed.resetTestingModule();
    const uae = rig({ country: 'AE' });
    uae.flow.setParsed(parsePasteText('Sara, 0501234567\nOmar, 559876543', { country: 'AE' }), null);
    uae.flow.setConsent('none', false);
    await new Promise<void>((resolve) => uae.flow.prepare(false).subscribe({ complete: resolve }));
    expect(parseCsvText(await fileText(uae.jobs[0]), ',').slice(1).map((x) => x[1])).toEqual(['+971501234567', '+971559876543']);
  });

  it('under "all of them agreed" a row marked NO (pasted third value) or unsubscribed still goes to the plain job', async () => {
    const r = rig();
    r.flow.setParsed(parsePasteText('Sara, 0501234567, yes\nOmar, 0502345678, no\nLina, 0503456789\nNour, 0504567890, unsubscribed\nHessa, 0505678901, maybe'), null);
    r.flow.setConsent('all', true);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.jobs.map((j) => j.attested)).toEqual([true, false]);
    expect(parseCsvText(await fileText(r.jobs[0]), ',').slice(1).map((x) => x[0])).toEqual(['Sara', 'Lina']);
    expect(parseCsvText(await fileText(r.jobs[1]), ',').slice(1).map((x) => x[0])).toEqual(['Omar', 'Nour', 'Hessa']);
  });

  it('the same person twice with different answers: BOTH rows go to the plain job, and the preview counts them (R6-04)', async () => {
    const r = rig({ summaries: [{ clean: 1 }, { clean: 1, duplicate: 1 }] });
    seed(r, 'Name,Phone,Opted in\nSara,0501234567,yes\nSara A,+966501234567,no\nOmar,0502345678,yes\n', 'rows', true);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.jobs.map((j) => j.attested)).toEqual([true, false]);
    expect(parseCsvText(await fileText(r.jobs[0]), ',').slice(1).map((x) => x[0])).toEqual(['Omar']);
    expect(parseCsvText(await fileText(r.jobs[1]), ',').slice(1).map((x) => x[0])).toEqual(['Sara', 'Sara A']);
    expect(r.flow.preview()).toEqual({ total: 3, canAdd: 2, cannotAdd: 0, duplicates: 0, withoutOptin: 1, repeated: 1, conflicting: 2, unreadable: 0 });
  });

  it('an opt-in column + the tick: the yes rows go to the attested job FIRST, every other row to a plain job', async () => {
    const r = rig();
    seed(r, WITH_COLUMN, 'rows', true);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(2));
    expect(r.jobs.map((j) => j.attested)).toEqual([true, false]);
    expect(r.api['uploadImport'].mock.calls.map((c) => c[2])).toEqual([true, false]);
    const attested = parseCsvText(await fileText(r.jobs[0]), ',');
    const plain = parseCsvText(await fileText(r.jobs[1]), ',');
    expect(attested.slice(1).map((x) => x[0])).toEqual(['Sara Ahmed', 'Lina Nasser']);
    expect(plain.slice(1).map((x) => x[0])).toEqual(['Omar Ali']);
  });

  it('source and date of a yes row are appended to its Notes', async () => {
    const r = rig();
    seed(r, WITH_COLUMN, 'rows', true);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(2));
    const attested = parseCsvText(await fileText(r.jobs[0]), ',');
    expect(attested[1][3]).toBe('Opted in: In store form, 2026-09-01');
    expect(attested[2][3]).toBe('Opted in: Web form, 2026-09-02');
    expect(parseCsvText(await fileText(r.jobs[1]), ',')[1][3]).toBe('');
  });

  it('a row added WITHOUT permission never gets an "Opted in" note, even when the file has a source and a date for it (R6-06)', async () => {
    const r = rig();
    seed(r, WITH_COLUMN, 'none', false); // "Not sure": the whole file is one plain job
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(1));
    const text = await fileText(r.jobs[0]);
    expect(text).not.toContain('Opted in');
    expect(parseCsvText(text, ',').slice(1).map((x) => x[3])).toEqual(['', '', '']);
  });

  it('a plain "Source" or "Date" column is not consent evidence: no note is written from it', async () => {
    const r = rig();
    seed(r, 'Name,Phone,Opted in,Source,Date\nSara,0501234567,yes,Instagram,2023-05-05\n', 'rows', true);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(1));
    expect(r.jobs[0].attested).toBe(true);
    expect(parseCsvText(await fileText(r.jobs[0]), ',')[1][3]).toBe('');
  });

  it('"Not sure": ONE unattested job with everyone, even if the file says yes', async () => {
    const r = rig();
    seed(r, WITH_COLUMN, 'none', false);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(1));
    expect(r.jobs[0].attested).toBe(false);
    expect(parseCsvText(await fileText(r.jobs[0]), ',').length).toBe(4);
  });

  it.each([['rows', WITH_COLUMN], ['all', NO_COLUMN], ['none', NO_COLUMN]] as const)(
    'an unticked attestation never produces marketingConsentAttested=true (mode %s)',
    async (mode, csv) => {
      const r = rig();
      seed(r, csv, mode, false);
      await mount(CustomersPreviewScreen);
      await vi.waitFor(() => expect(r.jobs.length).toBeGreaterThan(0));
      expect(r.api['uploadImport'].mock.calls.every((c) => c[2] === false)).toBe(true);
      expect(r.jobs.every((j) => j.attested === false)).toBe(true);
    },
  );

  it('the attestation cannot be set through setConsent("none", true) or by a non-boolean', () => {
    const r = rig();
    seed(r, NO_COLUMN, 'none', true);
    expect(r.flow.attest()).toBe(false);
    r.flow.setConsent('all', 'true' as unknown as boolean);
    expect(r.flow.attest()).toBe(false);
  });

  it('a new list or a changed answer drops the prepared jobs and the tick', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'all', true);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.flow.jobs()).toHaveLength(1);
    r.flow.setConsent('none', false);
    expect(r.flow.jobs()).toBeNull();
    r.flow.setParsed(parsePasteText('Sara, 0501234567'), null);
    expect(r.flow.attest()).toBe(false);
    expect(r.flow.consent()).toBeNull();
  });

  it('preparing twice with the same answer creates the jobs once', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'all', true);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    expect(r.api['uploadImport']).toHaveBeenCalledTimes(1);
  });

  it('a required column the engine could not map stops with ONB_IMPORT_BAD_FILE and runs nothing', async () => {
    const r = rig({ mapping: { name: 'Name' } });
    seed(r, NO_COLUMN, 'all', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_BAD_FILE]');
    expect(r.api['updateImportMapping']).not.toHaveBeenCalled();
    expect(r.api['runImport']).not.toHaveBeenCalled();
    expect(r.help.lastError()).toBe('ONB_IMPORT_BAD_FILE');
  });

  it('the Language column is uploaded only when Arabic is on', async () => {
    const r = rig({ arabic: true });
    seed(r, 'Name,Phone,Language\nSara,0501234567,ar\n', 'none', false);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(1));
    expect(parseCsvText(await fileText(r.jobs[0]), ',')[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Language']);
    TestBed.resetTestingModule();
    const r2 = rig({ arabic: false });
    seed(r2, 'Name,Phone,Language\nSara,0501234567,ar\n', 'none', false);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r2.jobs).toHaveLength(1));
    expect(parseCsvText(await fileText(r2.jobs[0]), ',')[0]).toEqual(['Name', 'Phone', 'Email', 'Notes']);
  });
});

describe('customers: preview screen', () => {
  it('a deep link without a list or an answer goes back to the first screen', async () => {
    const r = rig();
    await mount(CustomersPreviewScreen);
    expect(urlsOf(r.nav)).toContain('/setup/customers');
    TestBed.resetTestingModule();
    const r2 = rig();
    r2.flow.setParsed(parsePasteText('Sara, 0501234567'), null); // parsed, but no answer yet
    await mount(CustomersPreviewScreen);
    expect(urlsOf(r2.nav)).toContain('/setup/customers');
    expect(r2.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('shows the counts (found / can be added / cannot / already in your list) and one primary button', async () => {
    const r = rig({ summaries: [{ clean: 1, duplicate: 1, error: 0 }, { clean: 0, duplicate: 0, error: 1 }] });
    seed(r, WITH_COLUMN + 'NoPhone,\n', 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    expect(r.flow.preview()).toEqual({ total: 4, canAdd: 1, cannotAdd: 2, duplicates: 1, withoutOptin: 0, repeated: 0, conflicting: 0, unreadable: 0 });
    const text = textOf(el);
    expect(text).toContain('{"total":4}');
    expect(text).toContain('[onboarding.customers.preview.ok {"n":1}]');
    expect(text).toContain('[onboarding.customers.preview.bad {"n":2}]');
    expect(text).toContain('[onboarding.customers.preview.dupes {"n":1}]');
    expect(text).toContain('[onboarding.customers.preview.add {"n":1}]');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
    expect(textOf(el)).toContain('[onboarding.help.cta]');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });

  it('says how many will be added without a recorded opt-in', async () => {
    const r = rig({ summaries: [{ clean: 2 }, { clean: 1 }] });
    seed(r, WITH_COLUMN, 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    expect(r.flow.preview()?.withoutOptin).toBe(1);
    expect(textOf(el.querySelector('#onb-cust-prev-nooptin')!)).toContain('[onboarding.customers.preview.noOptin {"n":1}]');
  });

  it('Add runs the attested job first, then the plain one, defaults discrepancies to skip, sums the result and goes to the result screen', async () => {
    const r = rig({
      summaries: [{ clean: 2 }, { clean: 1 }],
      discrepancies: [[4, 7], []],
      runs: [{ importedCount: 2, skippedDuplicateCount: 1, failedCount: 1 }, { importedCount: 1, skippedDuplicateCount: 0, failedCount: 2 }],
    });
    seed(r, WITH_COLUMN, 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-add');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/result'));
    expect(r.api['runImport'].mock.calls.map((c) => c[0])).toEqual(['job1', 'job2']);
    expect(r.api['runImport'].mock.calls[0][1]).toEqual([{ rowIndex: 4, action: 'skip' }, { rowIndex: 7, action: 'skip' }]);
    expect(r.api['runImport'].mock.calls[1][1]).toEqual([]);
    expect(r.flow.result()).toEqual({ added: 3, failed: 3, duplicates: 1, withoutOptin: 1, rejected: 0, skipped: 3 });
  });

  it('counts the rows rejected on this side as skipped', async () => {
    const r = rig();
    seed(r, 'Name,Phone\nSara,0501234567\nOmar,\n', 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-add');
    await vi.waitFor(() => expect(r.flow.result()).not.toBeNull());
    expect(r.flow.result()).toMatchObject({ added: 1, rejected: 1, skipped: 1 });
  });

  it('a failure on the second job keeps the first result and a retry runs only the second job', async () => {
    const r = rig({ summaries: [{ clean: 2 }, { clean: 1 }] });
    seed(r, WITH_COLUMN, 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    let calls = 0;
    const original = r.api['runImport'].getMockImplementation() as (id: string) => unknown;
    r.api['runImport'].mockImplementation((id: string) => (++calls === 2 ? throwError(() => ({ status: 0 })) : original(id)));
    click(f, el, '#onb-cust-prev-add');
    await settle(f);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(urlsOf(r.nav)).not.toContain('/setup/customers/result');
    expect(r.flow.jobs()?.map((j) => !!j.ran)).toEqual([true, false]);
    click(f, el, '#onb-cust-prev-add');
    await vi.waitFor(() => expect(lastUrl(r.nav)).toBe('/setup/customers/result'));
    expect(r.api['runImport'].mock.calls.map((c) => c[0])).toEqual(['job1', 'job2', 'job2']);
    expect(r.flow.result()?.added).toBe(2);
  });

  it('the Add button is disabled when nothing can be added', async () => {
    const r = rig({ summaries: [{ clean: 0, duplicate: 1 }] });
    seed(r, NO_COLUMN, 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('#onb-cust-prev-add')!.disabled).toBe(true);
  });

  it('a failing validation shows the mapped error with a retry that runs the preparation again', async () => {
    const r = rig();
    seed(r, NO_COLUMN, 'none', false);
    r.api['uploadImport'].mockReturnValueOnce(throwError(() => ({ status: 400, error: { error: 'No file uploaded' } })));
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(el.querySelector('#onb-cust-prev-retry')).not.toBeNull());
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_GENERIC]');
    expect(textOf(el)).not.toContain('No file uploaded');
    click(f, el, '#onb-cust-prev-retry');
    await vi.waitFor(() => expect(el.querySelector('#onb-cust-prev-add')).not.toBeNull());
  });

  it('numbers that are not numbers count as "can\'t be added", are NOT in the uploaded file, and get their reason in the download', async () => {
    const r = rig({ summaries: [{ clean: 1 }] });
    seed(r, 'Name,Phone\nSara,0501234567\nTiny,123\nLetters,05012abc\n', 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    expect(r.flow.preview()).toEqual({ total: 3, canAdd: 1, cannotAdd: 2, duplicates: 0, withoutOptin: 1, repeated: 0, conflicting: 0, unreadable: 0 });
    expect(textOf(el)).toContain('[onboarding.customers.preview.bad {"n":2}]');
    const sent = await fileText(r.jobs[0]);
    expect(sent).toContain('Sara');
    expect(sent).not.toContain('Tiny');
    expect(sent).not.toContain('05012abc');
    click(f, el, '#onb-cust-prev-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    const t = parseCsvText(await blobToText(blobs[0]), ',');
    expect(t[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Reason']);
    expect(t.slice(1)).toEqual([
      ['Tiny', '123', '', '', REASON_INVALID],
      ['Letters', '05012abc', '', '', REASON_INVALID],
    ]);
    expect(r.api['downloadImportErrorReport']).not.toHaveBeenCalled(); // the engine never saw a bad row, so it has no report
  });

  it('a phone in Arabic digits is uploaded as a full "+966..." number with Western digits only', async () => {
    const r = rig();
    seed(r, `Name,Phone\nSara,${ARABIC_DIGITS_PHONE}\n`, 'none', false);
    await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.jobs).toHaveLength(1));
    const text = await fileText(r.jobs[0]);
    expect(text).toContain('+966501234567');
    expect(text).not.toContain(ARABIC_DIGITS_PHONE);
  });

  it('shows the lines that could not be read, the people repeated in the file and the rows that disagree about permission', async () => {
    const r = rig({ summaries: [{ clean: 1 }, { clean: 1, duplicate: 1 }] });
    seed(r, 'Name,Phone,Opted in\nSara,0501234567,yes\nSara A,+966501234567,no\nOmar,0502345678,yes\n"Broken,0509999999\n', 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    expect(r.flow.preview()).toMatchObject({ total: 4, cannotAdd: 1, unreadable: 1, repeated: 1, conflicting: 2 });
    expect(textOf(el.querySelector('#onb-cust-prev-unreadable')!)).toBe('[onboarding.customers.preview.unreadable {"n":1}]');
    expect(textOf(el.querySelector('#onb-cust-prev-repeated')!)).toBe('[onboarding.customers.preview.repeated {"n":1}]');
    expect(textOf(el.querySelector('#onb-cust-prev-conflict')!)).toContain('[onboarding.customers.preview.conflicting {"n":2}]');
    expect(textOf(el.querySelector('#onb-cust-prev-bad')!)).toBe('[onboarding.customers.preview.bad {"n":1}]'); // the unreadable line is also "can't be added"
    expect(textOf(el.querySelector('#onb-cust-prev-nooptin')!)).toContain('[onboarding.customers.preview.noOptin {"n":1}]');
    expect(el.querySelector('#onb-cust-prev-dupes')).toBeNull(); // the engine's duplicate is the repeated row, not somebody already in the list
  });

  it('the lines that could not be read are in the skipped-rows download with their own reason', async () => {
    const r = rig({ summaries: [{ clean: 1 }] });
    seed(r, 'Name,Phone\nSara,0501234567\n"Broken,0509999999\n', 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    expect(parseCsvText(await blobToText(blobs[0]), ',').slice(1)).toEqual([['"Broken,0509999999', '', '', '', '[onboarding.customers.reason.unreadable]']]);
  });

  it('the skipped-rows download cannot carry a formula into a spreadsheet', async () => {
    const r = rig({ summaries: [{ clean: 1 }] });
    seed(r, 'Name,Phone\nSara,0501234567\n=cmd|calc,0502345678abc\n', 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    const t = parseCsvText(await blobToText(blobs[0]), ',');
    expect(t[1][0]).toBe("'=cmd|calc");
  });

  it('downloads ONE merged CSV of the skipped rows with a single Reason column', async () => {
    const r = rig({ summaries: [{ clean: 1, error: 1 }] });
    seed(r, 'Name,Phone\nBad,0509999999\nSara,0501234567\nOmar,\n', 'none', false);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    expect(r.api['downloadImportErrorReport']).toHaveBeenCalledTimes(1);
    expect(r.api['downloadImportErrorReport']).toHaveBeenCalledWith('job1');
    const text = await blobToText(blobs[0]);
    expect([...new Uint8Array(await readFileBytes(blobs[0])).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const t = parseCsvText(text, ',');
    expect(t[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Reason']);
    expect(t).toHaveLength(3);
    expect(t[1][4]).toBe('Phone is not a valid phone number');
    expect(t[2]).toEqual(['Omar', '', '', '', '[onboarding.customers.reason.missingPhone]']);
  });

  it('with two jobs both error reports are merged into the same file', async () => {
    const r = rig({ summaries: [{ clean: 1, error: 1 }, { clean: 0, error: 1 }] });
    seed(r, WITH_COLUMN, 'rows', true);
    const { f, el } = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    f.detectChanges();
    click(f, el, '#onb-cust-prev-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    expect(r.api['downloadImportErrorReport'].mock.calls.map((c) => c[0])).toEqual(['job1', 'job2']);
    expect(parseCsvText(await blobToText(blobs[0]), ',')).toHaveLength(3);
  });
});

describe('customers: result screen', () => {
  it('a deep link without a result goes back to the first screen', async () => {
    const r = rig();
    const { el } = await mount(CustomersResultScreen);
    expect(urlsOf(r.nav)).toContain('/setup/customers');
    expect(el.querySelector('h1')).toBeNull();
  });

  it('shows "N added, M skipped", the duplicates, the consent note and the download, and records done once', async () => {
    const r = rig();
    r.flow.result.set({ added: 128, failed: 4, duplicates: 3, withoutOptin: 37, rejected: 0, skipped: 4 });
    const { f, el } = await mount(CustomersResultScreen);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.customers.result.line {"added":128,"skipped":4}]');
    expect(textOf(el)).toContain('[onboarding.customers.result.dupes {"n":3}]');
    expect(textOf(el.querySelector('#onb-cust-res-nooptin')!)).toContain('[onboarding.customers.result.noOptin {"n":37}]');
    expect(el.querySelector('#onb-cust-res-nooptin a')!.getAttribute('href')).toBe('/customers');
    expect(el.querySelector('#onb-cust-res-download')).not.toBeNull();
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(r.onb['promptDone']).toHaveBeenCalledWith('customers', 'done');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
    click(f, el, '#onb-cust-res-continue');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(lastUrl(r.nav)).toBe('/dashboard');
    expect(r.state.state()?.prompts?.customers?.state).toBe('done');
  });

  it('no consent note and no download when there is nothing to say', async () => {
    const r = rig();
    r.flow.result.set({ added: 5, failed: 0, duplicates: 0, withoutOptin: 0, rejected: 0, skipped: 0 });
    const { el } = await mount(CustomersResultScreen);
    expect(el.querySelector('#onb-cust-res-nooptin')).toBeNull();
    expect(el.querySelector('#onb-cust-res-download')).toBeNull();
    expect(el.querySelector('#onb-cust-res-dupes')).toBeNull();
  });

  it('Continue shows the server refusal (422) and does not leave the screen', async () => {
    const r = rig();
    r.onb['promptDone'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'VALIDATION_FAILED' } })));
    r.flow.result.set({ added: 1, failed: 0, duplicates: 0, withoutOptin: 0, rejected: 0, skipped: 0 });
    const { f, el } = await mount(CustomersResultScreen);
    click(f, el, '#onb-cust-res-continue');
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.VALIDATION_FAILED]');
    expect(r.help.lastError()).toBe('VALIDATION_FAILED');
    expect(lastUrl(r.nav)).not.toBe('/dashboard');
  });

  it('when nothing was added or found, done is NOT recorded: "Add more customers" is the primary button and Skip is available', async () => {
    const r = rig();
    r.flow.result.set({ added: 0, failed: 2, duplicates: 0, withoutOptin: 0, rejected: 1, skipped: 3 });
    const { f, el } = await mount(CustomersResultScreen);
    expect(r.onb['promptDone']).not.toHaveBeenCalled();
    expect(el.querySelector('#onb-cust-res-continue')).toBeNull();
    expect(el.querySelector('.onb-btn-primary')!.id).toBe('onb-cust-res-more');
    click(f, el, '#onb-cust-res-skip');
    expect(r.onb['promptDone']).toHaveBeenCalledWith('customers', 'skipped');
  });

  it('"Add more customers" starts again from the first screen with an empty flow', async () => {
    const r = rig();
    r.flow.result.set({ added: 2, failed: 0, duplicates: 0, withoutOptin: 0, rejected: 0, skipped: 0 });
    const { f, el } = await mount(CustomersResultScreen);
    click(f, el, '#onb-cust-res-more');
    expect(lastUrl(r.nav)).toBe('/setup/customers');
    expect(r.flow.result()).toBeNull();
  });

  it('the skipped-rows download of the result screen carries the invalid-phone reason too', async () => {
    const r = rig({ summaries: [{ clean: 1 }], runs: [{ importedCount: 1, failedCount: 0 }] });
    seed(r, 'Name,Phone\nSara,0501234567\nTiny,123\n', 'none', false);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    await new Promise<void>((resolve) => r.flow.run().subscribe({ complete: resolve }));
    expect(r.flow.result()).toMatchObject({ added: 1, rejected: 1, skipped: 1 });
    const { f, el } = await mount(CustomersResultScreen);
    click(f, el, '#onb-cust-res-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    expect(parseCsvText(await blobToText(blobs[0]), ',').slice(1)).toEqual([['Tiny', '123', '', '', REASON_INVALID]]);
  });

  it('downloads the skipped rows from the engine reports of the jobs that ran', async () => {
    const r = rig({ summaries: [{ clean: 1, error: 1 }], runs: [{ importedCount: 1, failedCount: 1 }] });
    seed(r, 'Name,Phone\nBad,0509999999\nSara,0501234567\n', 'none', false);
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    await new Promise<void>((resolve) => r.flow.run().subscribe({ complete: resolve }));
    const { f, el } = await mount(CustomersResultScreen);
    click(f, el, '#onb-cust-res-download');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    expect(r.api['downloadImportErrorReport']).toHaveBeenCalledWith('job1');
  });
});

describe('customers: result screen, "Ask AI Mode what to do next"', () => {
  afterEach(() => setClipboard(undefined));
  const added = (n: number, over: Record<string, number> = {}) => ({ added: n, failed: 0, duplicates: 0, withoutOptin: 0, rejected: 0, skipped: 0, ...over });

  it('is offered once customers were added; click copies ONE sentence with the count only, then the router link to AI Mode appears', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const r = rig();
    r.flow.result.set(added(128, { withoutOptin: 37, skipped: 4, failed: 4 }));
    const { f, el } = await mount(CustomersResultScreen);
    const btn = el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!;
    expect(textOf(btn)).toBe('[onboarding.aiNext.cta]');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1); // still ONE primary button: this is a quiet secondary action
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.customers {"n":128}]');
    expect(el.querySelector('a[data-act="ai-open"]')!.getAttribute('href')).toBe('/ai-mode');
    expect(textOf(el)).toContain('[onboarding.promotion.first.aiCopied]');
  });

  it('shows the sentence on screen when the browser refuses the clipboard', async () => {
    setClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    const r = rig();
    r.flow.result.set(added(2));
    const { f, el } = await mount(CustomersResultScreen);
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(textOf(el.querySelector('[data-ai-prompt]')!)).toBe('[onboarding.aiNext.customers {"n":2}]');
  });

  it('is not offered when nothing new was added (only duplicates, or only failures)', async () => {
    const r = rig();
    r.flow.result.set(added(0, { duplicates: 3 }));
    const a = await mount(CustomersResultScreen);
    expect(a.el.querySelector('[data-ai-next]')).toBeNull();
    TestBed.resetTestingModule();
    const r2 = rig();
    r2.flow.result.set(added(0, { failed: 2, skipped: 2 }));
    const b = await mount(CustomersResultScreen);
    expect(b.el.querySelector('[data-ai-next]')).toBeNull();
  });

  it('is not offered while the app is locked (ONBOARDING_UNLOCK_AT=finished): AI Mode would be veiled', async () => {
    const r = rig();
    r.state.state.set({ ...stateOf(), locked: true });
    r.flow.result.set(added(5));
    const { el } = await mount(CustomersResultScreen);
    expect(el.querySelector('[data-ai-next]')).toBeNull();
  });
});

describe('customers: one by one', () => {
  const type = (f: ComponentFixture<unknown>, el: HTMLElement, sel: string, value: string): void => {
    const input = el.querySelector<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const submit = (f: ComponentFixture<unknown>, el: HTMLElement): void => {
    el.querySelector<HTMLButtonElement>('#onb-cust-one-add')!.click();
    f.detectChanges();
  };

  it('the consent box is UNTICKED by default and the body says marketingConsent false; the number is saved as digits only', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    expect(el.querySelector<HTMLInputElement>('#onb-cust-agreed')!.checked).toBe(false);
    type(f, el, '#onb-cust-name', 'Sara Ahmed');
    type(f, el, '#onb-cust-phone', '0501234567');
    submit(f, el);
    expect(r.api['createCustomer']).toHaveBeenCalledTimes(1);
    expect(r.api['createCustomer']).toHaveBeenCalledWith({ firstname: 'Sara', lastname: 'Ahmed', phone: '966501234567', marketingConsent: false });
  });

  it('ticking the box sends marketingConsent true for that customer only; the box is unticked again after the add', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara Ahmed');
    type(f, el, '#onb-cust-phone', '0501234567');
    el.querySelector<HTMLInputElement>('#onb-cust-agreed')!.click();
    f.detectChanges();
    submit(f, el);
    expect(r.api['createCustomer'].mock.calls[0][0].marketingConsent).toBe(true);
    click(f, el, '#onb-cust-one-another');
    expect(el.querySelector<HTMLInputElement>('#onb-cust-agreed')!.checked).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#onb-cust-name')!.value).toBe('');
    type(f, el, '#onb-cust-name', 'Omar');
    type(f, el, '#onb-cust-phone', '0559876543');
    submit(f, el);
    expect(r.api['createCustomer'].mock.calls[1][0]).toEqual({ firstname: 'Omar', lastname: 'Omar', phone: '966559876543', marketingConsent: false });
  });

  it('a single word is used for both names (the old wizard\'s mapping) and a long name is split on whitespace', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', '  Ahmed   bin   Ali  ');
    type(f, el, '#onb-cust-phone', ' +966501234567 ');
    submit(f, el);
    expect(r.api['createCustomer']).toHaveBeenCalledWith({ firstname: 'Ahmed', lastname: 'bin Ali', phone: '966501234567', marketingConsent: false });
  });

  it('shows "Added", the count of done is recorded once, and Done goes to the dashboard', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '0501234567');
    submit(f, el);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.customers.one.added]');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(r.onb['promptDone']).toHaveBeenCalledWith('customers', 'done');
    click(f, el, '#onb-cust-one-done');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(lastUrl(r.nav)).toBe('/dashboard');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
  });

  it('empty fields show inline messages, focus the first and send nothing', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    submit(f, el);
    expect(r.api['createCustomer']).not.toHaveBeenCalled();
    expect(textOf(el.querySelector('#onb-cust-name-err')!)).toContain('[onboarding.customers.one.nameNeeded]');
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toContain('[onboarding.customers.one.phoneNeeded]');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-cust-name')));
  });

  it.each(['0501', '1234567', '12345678', '1234567890123456', 'abc', '050+1234567', '0501234abc', '++966501234567', '05012345678'])(
    '"%s" is not a phone number: the inline message with the allowed length and the example, focus on the phone box, nothing sent', async (typed) => {
      const r = rig();
      const { f, el } = await mount(CustomersOneScreen);
      type(f, el, '#onb-cust-name', 'Sara');
      type(f, el, '#onb-cust-phone', typed);
      submit(f, el);
      expect(r.api['createCustomer']).not.toHaveBeenCalled();
      expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toContain('[onboarding.customers.one.phoneInvalid {"min":8,"max":15,"example":"+966 5x xxx xxxx"}]');
      expect(el.querySelector('#onb-cust-phone')!.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector('#onb-cust-name-err')).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-cust-phone')));
      expect(r.onb['promptDone']).not.toHaveBeenCalled();
    });

  it.each(['0501234567', '501234567', '+966 50 123 4567', '(050) 123-4567', '050.123.4567', ARABIC_DIGITS_PHONE, '00966501234567', '966501234567', '+966 (0) 50 123 4567', '966501234567.0'])(
    '"%s" passes the check and is saved as 966501234567: DIGITS ONLY, the format WhatsApp\'s own lookups match exactly (R6-02)', async (typed) => {
      const r = rig();
      const { f, el } = await mount(CustomersOneScreen);
      type(f, el, '#onb-cust-name', 'Sara Ahmed');
      type(f, el, '#onb-cust-phone', `  ${typed}  `);
      submit(f, el);
      expect(r.api['createCustomer']).toHaveBeenCalledTimes(1);
      expect(r.api['createCustomer']).toHaveBeenCalledWith({ firstname: 'Sara', lastname: 'Ahmed', phone: '966501234567', marketingConsent: false });
    });

  it.each([['AE', '0501234567', '971501234567'], ['KW', '51234567', '96551234567'], ['QA', '55123456', '97455123456'], ['BH', '36123456', '97336123456'], ['OM', '91234567', '96891234567']])(
    'the country of Step 1 decides: %s, "%s" is saved as %s (never as a Saudi number)', async (country, typed, expected) => {
      const r = rig({ country });
      const { f, el } = await mount(CustomersOneScreen);
      type(f, el, '#onb-cust-name', 'Sara');
      type(f, el, '#onb-cust-phone', typed);
      submit(f, el);
      expect(r.api['createCustomer']).toHaveBeenCalledWith({ firstname: 'Sara', lastname: 'Sara', phone: expected, marketingConsent: false });
    });

  it('the messages show the format of the workspace country (a Kuwaiti number looks different from a Saudi one)', async () => {
    rig({ country: 'KW' });
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '123');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toContain('"example":"+965 xxxx xxxx"');
  });

  it('"Another country": a local number is refused and the message asks for the country code; with + or 00 it is saved as digits', async () => {
    const r = rig({ country: 'OTHER' });
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '07700900123');
    submit(f, el);
    expect(r.api['createCustomer']).not.toHaveBeenCalled();
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toBe('[onboarding.customers.one.phoneCountryNeeded {"example":"+44 7xxx xxxxxx"}]');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-cust-phone')));
    type(f, el, '#onb-cust-phone', '+44 7700 900123');
    submit(f, el);
    expect(r.api['createCustomer']).toHaveBeenCalledWith({ firstname: 'Sara', lastname: 'Sara', phone: '447700900123', marketingConsent: false });
  });

  it('says how a number without a country code is read, and the field points at that line', async () => {
    rig({ country: 'AE' });
    const { el } = await mount(CustomersOneScreen);
    expect(textOf(el.querySelector('#onb-cust-phone-note')!)).toBe('[onboarding.customers.phone.note {"country":"[onboarding.country.AE]","code":"971"}]');
    expect(el.querySelector('#onb-cust-phone')!.getAttribute('aria-describedby')).toContain('onb-cust-phone-note');
  });

  it('an empty phone keeps its own message; typing again clears whichever message is showing', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toContain('[onboarding.customers.one.phoneNeeded]');
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).not.toContain('phoneInvalid');
    type(f, el, '#onb-cust-phone', '123');
    expect(el.querySelector('#onb-cust-phone-err')).toBeNull();
    submit(f, el);
    expect(textOf(el.querySelector('#onb-cust-phone-err')!)).toContain('[onboarding.customers.one.phoneInvalid');
    type(f, el, '#onb-cust-phone', '0501234567');
    expect(el.querySelector('#onb-cust-phone-err')).toBeNull();
    submit(f, el);
    expect(r.api['createCustomer']).toHaveBeenCalledTimes(1);
  });

  it('a missing name is reported first (focus on the name) even when the phone is also wrong', async () => {
    const r = rig();
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-phone', '12');
    submit(f, el);
    expect(el.querySelector('#onb-cust-name-err')).not.toBeNull();
    expect(el.querySelector('#onb-cust-phone-err')).not.toBeNull();
    expect(r.api['createCustomer']).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-cust-name')));
  });

  it('a 400 shows the plain message with the phone example, never the server text', async () => {
    const r = rig();
    r.api['createCustomer'].mockReturnValue(throwError(() => ({ status: 400, error: { error: 'phone 0501234567 already exists' } })));
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '0501234567');
    submit(f, el);
    const alert = el.querySelector('#onb-cust-one-error')!;
    expect(textOf(alert)).toContain('[onboarding.customers.one.error {"example":"+966 5x xxx xxxx"}]');
    expect(textOf(el)).not.toContain('already exists');
    expect(r.help.lastError()).toBe('VALIDATION_FAILED');
    expect(r.onb['promptDone']).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('#onb-cust-name')!.value).toBe('Sara'); // nothing is lost
  });

  it('another failure (offline) uses the mapped error block', async () => {
    const r = rig();
    r.api['createCustomer'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '0501234567');
    submit(f, el);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(r.help.lastError()).toBe('ONB_NETWORK');
  });

  it('a quiet failure of the background "done" is retried by Done', async () => {
    const r = rig();
    r.onb['promptDone'].mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(CustomersOneScreen);
    type(f, el, '#onb-cust-name', 'Sara');
    type(f, el, '#onb-cust-phone', '0501234567');
    submit(f, el);
    expect(el.querySelector('[role="alert"]')).toBeNull(); // quiet
    click(f, el, '#onb-cust-one-done');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(2);
    expect(lastUrl(r.nav)).toBe('/dashboard');
  });

  it('focuses the heading and has "Need help?"', async () => {
    rig();
    const { el } = await mount(CustomersOneScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
    expect(textOf(el)).toContain('[onboarding.help.cta]');
  });
});

describe('customers: the flow forgets a merchant when the session ends (R6-13)', () => {
  const TOKEN_KEY = 'waflow_auth_token';

  it('a login token that changes wipes the parsed rows, the pasted text, the jobs, the result and the help context', async () => {
    const r = rig();
    r.state.load(); // the state is now loaded for token-A
    seed(r, NO_COLUMN, 'all', true);
    r.flow.pasteText.set('Sara, 0501234567');
    await new Promise<void>((resolve) => r.flow.prepare(false).subscribe({ complete: resolve }));
    r.flow.result.set({ added: 1, failed: 0, duplicates: 0, withoutOptin: 0, rejected: 0, skipped: 0 });
    r.help.context.set({ businessName: 'Old Shop', supportEmail: 'old@example.test' });
    r.help.setLastError('META_ERROR');
    expect(r.flow.parsed()).not.toBeNull();
    localStorage.setItem(TOKEN_KEY, 'token-B'); // another merchant logs in, in the same tab
    r.state.ensureLoaded();
    expect(r.flow.parsed()).toBeNull();
    expect(r.flow.pasteText()).toBe('');
    expect(r.flow.jobs()).toBeNull();
    expect(r.flow.result()).toBeNull();
    expect(r.flow.consent()).toBeNull();
    expect(r.flow.attest()).toBe(false);
    expect(r.help.context()).toBeNull();
    expect(r.help.lastError()).toBeNull();
  });

  it('a logout (the token is removed) wipes them too, and Back to a customers screen starts again from the first one', async () => {
    const r = rig();
    r.state.load();
    seed(r, WITH_COLUMN, 'rows', true);
    localStorage.removeItem(TOKEN_KEY);
    r.state.ensureLoaded();
    expect(r.flow.parsed()).toBeNull();
    expect(r.flow.attest()).toBe(false);
    const { el } = await mount(CustomersPreviewScreen); // what the browser's Back button would open
    expect(urlsOf(r.nav)).toContain('/setup/customers');
    expect(el.querySelector('h1')).toBeNull();
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('nothing is wiped while the same token stays (ordinary reloads of the state keep the list)', () => {
    const r = rig();
    r.state.load();
    seed(r, NO_COLUMN, 'all', true);
    r.state.ensureLoaded();
    r.state.load(true);
    expect(r.flow.parsed()).not.toBeNull();
    expect(r.flow.attest()).toBe(true);
  });

  it('the test-message choice of the previous merchant is forgotten as well', () => {
    const r = rig();
    r.state.load();
    r.flow.reset();
    const choice = TestBed.inject(OnbTestChoice);
    choice.decided.set(true);
    localStorage.setItem(TOKEN_KEY, 'token-C');
    r.state.ensureLoaded();
    expect(choice.decided()).toBe(false);
  });
});

describe('customers: no personal data leaves the request bodies', () => {
  it('nothing is logged, stored or put in a URL while a list goes through the whole flow', async () => {
    const r = rig({ summaries: [{ clean: 2 }, { clean: 1 }] });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const phone = '0501234567';
    seed(r, WITH_COLUMN, 'rows', true);
    const p = await mount(CustomersPreviewScreen);
    await vi.waitFor(() => expect(r.flow.preview()).not.toBeNull());
    p.f.detectChanges();
    click(p.f, p.el, '#onb-cust-prev-add');
    await vi.waitFor(() => expect(r.flow.result()).not.toBeNull());
    const logged = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(logged).not.toContain(phone);
    expect(logged).not.toContain('Sara');
    const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(stored).not.toContain(phone);
    expect(stored).not.toContain('Sara');
    expect(urlsOf(r.nav).join(' ')).not.toContain(phone);
    expect(JSON.stringify(r.onb['promptDone'].mock.calls)).not.toContain(phone);
    expect(JSON.stringify(r.onb['event'].mock.calls)).not.toContain(phone);
  });
});
