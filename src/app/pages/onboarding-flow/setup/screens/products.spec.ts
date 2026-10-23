import { Component, Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { ApiService } from '../../../../services/api.service';
import { LocalizationApiService } from '../../../../services/localization-api.service';
import { LocalizationFlagService } from '../../../../services/localization-flag.service';
import { AuthService } from '../../../../shared/auth.service';
import { LocUiService } from '../../../localization/shared/loc-ui.service';
import { blobToText, parseCsvText } from '../../customers/csv';
import { OnbApiService } from '../../onb-api.service';
import { OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type { OnbState } from '../../onb.types';
import { DEFAULT_CATEGORY, DEFAULT_DURATION, ProductsScreen, itemBody, parseItemPrice } from './products';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
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
interface Rig {
  state: OnbStateService;
  router: Router;
  nav: Fn;
  api: Record<string, Fn>;
  loc: Record<string, Fn>;
  onb: Record<string, Fn>;
  help: OnbHelpService;
  toasts: LocUiService;
  arabic: ReturnType<typeof signal<boolean>>;
  uploads: { entity: string; attested: boolean }[];
}

const AR_NAME = String.fromCodePoint(0x642, 0x647, 0x648, 0x629);

function rig(opts: { arabic?: boolean; summary?: Record<string, number>; run?: Record<string, number>; mapping?: Record<string, string> } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const uploads: { entity: string; attested: boolean }[] = [];
  const session$ = new BehaviorSubject<unknown>({ role: 'owner', user: { name: 'Sara', phone: '', email: '' }, workspace: { name: 'W' } });
  const arabic = signal(opts.arabic === true);
  const api: Record<string, Fn> = {
    createProduct: vi.fn(() => of({ _id: 'p1' })),
    createService: vi.fn(() => of({ _id: 's1' })),
    uploadImage: vi.fn(() => of({ url: '/uploads/latte.png' })),
    downloadImportSampleTemplate: vi.fn(() => of(new Blob(['Name,Price,Category,Description', String.fromCharCode(10), 'Classic T-Shirt,SAR 45.00,Apparel,Soft cotton tee']))),
    uploadImport: vi.fn((entity: string, _file: File, attested: boolean) => {
      uploads.push({ entity, attested });
      return of({
        id: 'job1', columnMapping: opts.mapping ?? { name: 'Name', basePrice: 'Price' },
        fields: [{ key: 'name', required: true }, { key: 'basePrice', required: true }, { key: 'category' }],
      });
    }),
    updateImportMapping: vi.fn(() => of({ summary: { totalRows: 3, clean: 2, duplicate: 0, error: 1, discrepancy: 0, ...(opts.summary ?? {}) } })),
    runImport: vi.fn(() => of({ importedCount: 2, skippedDuplicateCount: 0, failedCount: 1, ...(opts.run ?? {}) })),
    downloadImportErrorReport: vi.fn(() => of(new Blob(['Name,Price,Reason\nBad,x,Price is not a valid price']))),
  };
  const loc: Record<string, Fn> = { saveCatalogTranslation: vi.fn(() => of({})) };
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
      { provide: LocalizationApiService, useValue: loc },
      { provide: LocalizationFlagService, useValue: { arabicEnabled: arabic } },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  state.state.set({
    enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'products',
    steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' }, approvals: { status: 'waiting' } },
    prompts: { customers: { state: 'done' }, products: { state: 'pending' } },
  });
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigateByUrl') as unknown as Fn;
  return { state, router, nav, api, loc, onb, help: TestBed.inject(OnbHelpService), toasts: TestBed.inject(LocUiService), arabic, uploads };
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
const type = (f: ComponentFixture<unknown>, el: HTMLElement, sel: string, value: string): void => {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
  if (!input) throw new Error(`no element ${sel}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
};
const submit = (f: ComponentFixture<unknown>, el: HTMLElement): void => click(f, el, '#onb-prod-add');
function chooseFile(f: ComponentFixture<unknown>, el: HTMLElement, sel: string, file: File): void {
  const input = el.querySelector<HTMLInputElement>(sel)!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  f.detectChanges();
}
const lastUrl = (nav: Fn): string => String(nav.mock.calls[nav.mock.calls.length - 1][0]);
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

describe('products: pure helpers', () => {
  it.each<[string, number | null]>([
    ['18', 18], ['18.5', 18.5], ['18,5', 18.5], [' 1 200 ', 1200], ['0', 0], ['', null], ['abc', null], ['-5', null], ['1.2.3', null],
    [String.fromCodePoint(0x661, 0x668), 18], [`${String.fromCodePoint(0x661, 0x668)}${String.fromCodePoint(0x66b)}${String.fromCodePoint(0x665)}`, 18.5],
    [String.fromCodePoint(0x6f1, 0x6f8), 18], ['9999999999', null],
  ])('price %j -> %j', (raw, expected) => {
    expect(parseItemPrice(raw)).toBe(expected);
  });

  it('product body: category General, price, description, images', () => {
    expect(itemBody('product', { name: 'Latte', price: 18, description: 'Hot', photoUrl: '/u/a.png' })).toEqual({
      name: 'Latte', category: DEFAULT_CATEGORY, basePrice: 18, description: 'Hot', images: ['/u/a.png'],
    });
    expect(DEFAULT_CATEGORY).toBe('General');
  });

  it('service body adds the 60-minute default duration; no photo means an empty images array', () => {
    expect(itemBody('service', { name: 'Haircut', price: 50, description: '', photoUrl: null })).toEqual({
      name: 'Haircut', category: 'General', basePrice: 50, description: '', images: [], duration: 60,
    });
    expect(DEFAULT_DURATION).toBe(60);
  });
});

describe('products: one item at a time', () => {
  it('asks one question, has Product / Service, one primary button, help, skip and the CSV link; focuses the heading', async () => {
    rig();
    const { el } = await mount(ProductsScreen);
    const h1 = el.querySelector('h1')!;
    expect(textOf(h1)).toBe('[onboarding.products.title]');
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(el.querySelector<HTMLInputElement>('#onb-prod-kind-product')!.checked).toBe(true);
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
    expect(textOf(el)).toContain('[onboarding.help.cta]');
    expect(textOf(el)).toContain('[onboarding.products.csv]');
    expect(textOf(el)).toContain('[onboarding.common.skip]');
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
  });

  it('a product is created with category General and nothing else invented', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', '  Latte  ');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(r.api['createProduct']).toHaveBeenCalledTimes(1);
    expect(r.api['createProduct']).toHaveBeenCalledWith({ name: 'Latte', category: 'General', basePrice: 18, description: '', images: [] });
    expect(r.api['createService']).not.toHaveBeenCalled();
  });

  it('a service is created through createService with duration 60', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-kind-service');
    type(f, el, '#onb-prod-name', 'Haircut');
    type(f, el, '#onb-prod-price', '50.5');
    submit(f, el);
    expect(r.api['createService']).toHaveBeenCalledWith({ name: 'Haircut', category: 'General', basePrice: 50.5, description: '', images: [], duration: 60 });
    expect(r.api['createProduct']).not.toHaveBeenCalled();
  });

  it('a price typed in Arabic-Indic digits is sent as a number', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', `${String.fromCodePoint(0x661, 0x668)}${String.fromCodePoint(0x66b)}${String.fromCodePoint(0x665)}`);
    submit(f, el);
    expect(r.api['createProduct'].mock.calls[0][0].basePrice).toBe(18.5);
  });

  it('description and a photo (uploaded when chosen) go into the body', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    expect(el.querySelector('#onb-prod-more-btn')!.getAttribute('aria-expanded')).toBe('true');
    type(f, el, '#onb-prod-desc', 'Hot and fresh');
    chooseFile(f, el, '#onb-prod-photo', new File(['x'], 'latte.png', { type: 'image/png' }));
    expect(r.api['uploadImage']).toHaveBeenCalledTimes(1);
    f.detectChanges();
    expect(textOf(el.querySelector('#onb-prod-photo-name')!)).toBe('latte.png');
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(r.api['createProduct']).toHaveBeenCalledWith({ name: 'Latte', category: 'General', basePrice: 18, description: 'Hot and fresh', images: ['/uploads/latte.png'] });
  });

  it('a failed photo upload shows the mapped error and does not block adding without it', async () => {
    const r = rig();
    r.api['uploadImage'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    chooseFile(f, el, '#onb-prod-photo', new File(['x'], 'latte.png'));
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(r.help.lastError()).toBe('ONB_NETWORK');
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(r.api['createProduct']).toHaveBeenCalledWith(expect.objectContaining({ images: [] }));
  });

  it('empty name / bad price show inline messages, focus the field and send nothing', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    submit(f, el);
    expect(textOf(el.querySelector('#onb-prod-name-err')!)).toContain('[onboarding.products.nameNeeded]');
    expect(textOf(el.querySelector('#onb-prod-price-err')!)).toContain('[onboarding.products.priceNeeded]');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-prod-name')));
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', 'free');
    submit(f, el);
    expect(el.querySelector('#onb-prod-name-err')).toBeNull();
    expect(el.querySelector('#onb-prod-price-err')).not.toBeNull();
    expect(r.api['createProduct']).not.toHaveBeenCalled();
  });

  it('after adding: shows "Added: name", the count, records done once; Add another resets the form; Done goes to the dashboard', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.products.added {"name":"Latte"}]');
    expect(textOf(el.querySelector('#onb-prod-count')!)).toBe('[onboarding.products.count {"n":1}]');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(r.onb['promptDone']).toHaveBeenCalledWith('products', 'done');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
    click(f, el, '#onb-prod-another');
    expect(el.querySelector<HTMLInputElement>('#onb-prod-name')!.value).toBe('');
    type(f, el, '#onb-prod-name', 'Mocha');
    type(f, el, '#onb-prod-price', '20');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-prod-count')!)).toBe('[onboarding.products.count {"n":2}]');
    click(f, el, '#onb-prod-done');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(lastUrl(r.nav)).toBe('/dashboard');
    expect(r.state.state()?.prompts?.products?.state).toBe('done');
  });

  it('the kind stays selected after "Add another"', async () => {
    rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-kind-service');
    type(f, el, '#onb-prod-name', 'Haircut');
    type(f, el, '#onb-prod-price', '50');
    submit(f, el);
    click(f, el, '#onb-prod-another');
    expect(el.querySelector<HTMLInputElement>('#onb-prod-kind-service')!.checked).toBe(true);
  });

  it('a failed create shows the mapped error, keeps the typed values and primes "Need help?"', async () => {
    const r = rig();
    r.api['createProduct'].mockReturnValue(throwError(() => ({ status: 400, error: { error: 'category: Path `category` is required.' } })));
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_GENERIC]');
    expect(textOf(el)).not.toContain('Path');
    expect(r.help.lastError()).toBe('ONB_GENERIC');
    expect(el.querySelector<HTMLInputElement>('#onb-prod-name')!.value).toBe('Latte');
    expect(r.onb['promptDone']).not.toHaveBeenCalled();
  });

  it('Done shows the server refusal (422) when the count check fails, and does not leave', async () => {
    const r = rig();
    r.onb['promptDone'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'VALIDATION_FAILED' } })));
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(el.querySelector('[role="alert"]')).toBeNull(); // the background call is quiet
    click(f, el, '#onb-prod-done');
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.VALIDATION_FAILED]');
    expect(r.nav).not.toHaveBeenCalledWith('/dashboard');
  });

  it('Skip for now records POST /prompts/products {state: skipped} and goes to the dashboard', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-skip');
    expect(r.onb['promptDone']).toHaveBeenCalledTimes(1);
    expect(r.onb['promptDone']).toHaveBeenCalledWith('products', 'skipped');
    expect(lastUrl(r.nav)).toBe('/dashboard');
    expect(r.toasts.toasts()).toHaveLength(1);
    expect(r.state.state()?.prompts?.products?.state).toBe('skipped');
  });
});

describe('products: "Ask AI Mode what to do next"', () => {
  const setClipboard = (writeText: unknown): void => {
    Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
  };
  const settle = async (f: ComponentFixture<unknown>): Promise<void> => {
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
  };
  afterEach(() => setClipboard(undefined));

  it('is not on the form (nothing was added yet)', async () => {
    rig();
    const { el } = await mount(ProductsScreen);
    expect(el.querySelector('[data-ai-next]')).toBeNull();
  });

  it('after adding an item it is a quiet secondary action; click copies ONE sentence with the count only, then the AI Mode link appears', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    rig();
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
    expect(textOf(el.querySelector('[data-act="ai-next"]')!)).toBe('[onboarding.aiNext.cta]');
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.products {"n":1}]');
    expect(String((writeText.mock.calls[0] as unknown[])[0])).not.toContain('Latte'); // a count, never the name of an item
    expect(el.querySelector('a[data-act="ai-open"]')!.getAttribute('href')).toBe('/ai-mode');
  });

  it('the count follows the items added in this visit', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    rig();
    const { f, el } = await mount(ProductsScreen);
    for (const [name, price] of [['Latte', '18'], ['Mocha', '20']]) {
      type(f, el, '#onb-prod-name', name);
      type(f, el, '#onb-prod-price', price);
      submit(f, el);
      if (name === 'Latte') click(f, el, '#onb-prod-another');
    }
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.products {"n":2}]');
  });

  it('shows the sentence on screen when the browser refuses the clipboard', async () => {
    setClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    rig();
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(textOf(el.querySelector('[data-ai-prompt]')!)).toBe('[onboarding.aiNext.products {"n":1}]');
  });

  it('is not offered while the app is locked (AI Mode would be veiled)', async () => {
    const r = rig();
    r.state.state.set({ ...r.state.state()!, locked: true });
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.products.added {"name":"Latte"}]');
    expect(el.querySelector('[data-ai-next]')).toBeNull();
  });

  it('after a CSV import that added items it is offered with the number added; when nothing was added it is not', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-csv');
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nLatte,18\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    expect(el.querySelector('[data-ai-next]')).toBeNull(); // not on the preview: nothing is added yet
    click(f, el, '#onb-prod-prev-add');
    click(f, el, '[data-act="ai-next"]');
    await settle(f);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.products {"n":2}]'); // the rig's import adds 2
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    rig({ run: { importedCount: 0, failedCount: 3 } });
    const m = await mount(ProductsScreen);
    click(m.f, m.el, '#onb-prod-csv');
    chooseFile(m.f, m.el, '#onb-prod-file', new File(['Name,Price\nx,y\n'], 'items.csv'));
    click(m.f, m.el, '#onb-prod-csv-check');
    click(m.f, m.el, '#onb-prod-prev-add');
    expect(m.el.querySelector('[data-ai-next]')).toBeNull();
  });
});

describe('products: Arabic fields only when the workspace has Arabic on', () => {
  it('are not rendered when the flag is off (even with the details open)', async () => {
    rig({ arabic: false });
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    expect(el.querySelector('#onb-prod-name-ar')).toBeNull();
    expect(el.querySelector('#onb-prod-desc-ar')).toBeNull();
    expect(textOf(el)).not.toContain('[onboarding.products.nameAr]');
  });

  it('flag off: the Arabic catalogue endpoint is never called', async () => {
    const r = rig({ arabic: false });
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(r.loc['saveCatalogTranslation']).not.toHaveBeenCalled();
  });

  it('are rendered when the flag is on, with rtl / lang ar', async () => {
    rig({ arabic: true });
    const { f, el } = await mount(ProductsScreen);
    expect(el.querySelector('#onb-prod-name-ar')).toBeNull(); // inside the optional details
    click(f, el, '#onb-prod-more-btn');
    const nameAr = el.querySelector('#onb-prod-name-ar')!;
    expect(nameAr.getAttribute('dir')).toBe('rtl');
    expect(nameAr.getAttribute('lang')).toBe('ar');
    expect(el.querySelector('#onb-prod-desc-ar')).not.toBeNull();
  });

  it('flag on: the Arabic draft is saved through the existing catalogue endpoint for the new product', async () => {
    const r = rig({ arabic: true });
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    type(f, el, '#onb-prod-name-ar', AR_NAME);
    type(f, el, '#onb-prod-desc-ar', `${AR_NAME}!`);
    submit(f, el);
    expect(r.api['createProduct'].mock.calls[0][0]).not.toHaveProperty('nameAr');
    expect(r.loc['saveCatalogTranslation']).toHaveBeenCalledWith('product', 'p1', { name: AR_NAME, description: `${AR_NAME}!`, source: 'merchant' });
  });

  it('a service saves its Arabic draft as kind "service"; an empty description is left out', async () => {
    const r = rig({ arabic: true });
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-kind-service');
    click(f, el, '#onb-prod-more-btn');
    type(f, el, '#onb-prod-name', 'Haircut');
    type(f, el, '#onb-prod-price', '50');
    type(f, el, '#onb-prod-name-ar', AR_NAME);
    submit(f, el);
    expect(r.loc['saveCatalogTranslation']).toHaveBeenCalledWith('service', 's1', { name: AR_NAME, source: 'merchant' });
  });

  it('flag on but no Arabic typed: nothing is saved', async () => {
    const r = rig({ arabic: true });
    const { f, el } = await mount(ProductsScreen);
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    submit(f, el);
    expect(r.loc['saveCatalogTranslation']).not.toHaveBeenCalled();
  });

  it('an Arabic description without an Arabic name is refused inline and nothing is created', async () => {
    const r = rig({ arabic: true });
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    type(f, el, '#onb-prod-desc-ar', AR_NAME);
    submit(f, el);
    expect(textOf(el.querySelector('#onb-prod-name-ar-err')!)).toContain('[onboarding.products.nameArNeeded]');
    expect(r.api['createProduct']).not.toHaveBeenCalled();
  });

  it('a failed Arabic save does not undo the product: it is added and a warning is shown', async () => {
    const r = rig({ arabic: true });
    r.loc['saveCatalogTranslation'].mockReturnValue(throwError(() => ({ status: 500 })));
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-more-btn');
    type(f, el, '#onb-prod-name', 'Latte');
    type(f, el, '#onb-prod-price', '18');
    type(f, el, '#onb-prod-name-ar', AR_NAME);
    submit(f, el);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.products.added');
    expect(textOf(el.querySelector('#onb-prod-ar-failed')!)).toContain('[onboarding.products.arFailed]');
  });
});

describe('products: CSV path', () => {
  async function openCsv(r: Rig): Promise<{ f: ComponentFixture<ProductsScreen>; el: HTMLElement }> {
    const m = await mount(ProductsScreen);
    click(m.f, m.el, '#onb-prod-csv');
    expect(r).toBeTruthy();
    return m;
  }

  it('"Upload a CSV instead" opens the CSV screen; the template is the engine\'s own for the chosen kind', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-kind-service');
    click(f, el, '#onb-prod-csv');
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.products.csvTitle]');
    click(f, el, '#onb-prod-template');
    expect(r.api['downloadImportSampleTemplate']).toHaveBeenCalledWith('service');
    await vi.waitFor(() => expect(blobs).toHaveLength(1));
    // HEADER ONLY: the example rows of the engine's file are never handed to the merchant (an untouched file must not import fake items)
    const text = await blobToText(blobs[0]);
    expect(text).toContain('Name,Price,Category,Description');
    expect(text.toLowerCase()).not.toContain('classic');
    expect(parseCsvText(text, ',')).toHaveLength(1);
  });

  it('uploads the file as ONE job WITHOUT any consent flag, maps it and shows the counts', async () => {
    const r = rig();
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nLatte,18\n'], 'items.csv', { type: 'text/csv' }));
    click(f, el, '#onb-prod-csv-check');
    expect(r.api['uploadImport']).toHaveBeenCalledTimes(1);
    expect(r.api['uploadImport'].mock.calls[0][0]).toBe('product');
    expect(r.uploads).toEqual([{ entity: 'product', attested: false }]);
    expect(r.api['updateImportMapping']).toHaveBeenCalledWith('job1', { name: 'Name', basePrice: 'Price' });
    expect(textOf(el.querySelector('#onb-prod-prev-ok')!)).toContain('{"n":2}');
    expect(textOf(el.querySelector('#onb-prod-prev-bad')!)).toContain('{"n":1}');
    expect(el.querySelectorAll('.onb-btn-primary')).toHaveLength(1);
  });

  it('a service CSV uses the "service" entity', async () => {
    const r = rig();
    const { f, el } = await mount(ProductsScreen);
    click(f, el, '#onb-prod-kind-service');
    click(f, el, '#onb-prod-csv');
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nCut,50\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    expect(r.uploads).toEqual([{ entity: 'service', attested: false }]);
  });

  it('Add runs the import, shows "N added, M skipped", and records done', async () => {
    const r = rig();
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nLatte,18\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    click(f, el, '#onb-prod-prev-add');
    expect(r.api['runImport']).toHaveBeenCalledWith('job1', []);
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.products.csvResult {"added":2,"skipped":1}]');
    expect(r.onb['promptDone']).toHaveBeenCalledWith('products', 'done');
    click(f, el, '#onb-prod-res-download');
    expect(r.api['downloadImportErrorReport']).toHaveBeenCalledWith('job1');
    expect(blobs).toHaveLength(1);
    click(f, el, '#onb-prod-res-done');
    expect(lastUrl(r.nav)).toBe('/dashboard');
  });

  it('nothing added: done is not recorded and the primary button starts again', async () => {
    const r = rig({ run: { importedCount: 0, failedCount: 3 } });
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nx,y\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    click(f, el, '#onb-prod-prev-add');
    expect(r.onb['promptDone']).not.toHaveBeenCalled();
    expect(el.querySelector('#onb-prod-res-done')).toBeNull();
    expect(el.querySelector('.onb-btn-primary')!.id).toBe('onb-prod-res-again');
  });

  it('a spreadsheet shows the full-import hint with the link for the chosen kind and uploads nothing', async () => {
    const r = rig();
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['PK'], 'items.xlsx'));
    click(f, el, '#onb-prod-csv-check');
    const hint = el.querySelector('#onb-prod-hint')!;
    expect(textOf(hint)).toContain('[onboarding.customers.upload.xlsx]');
    expect(hint.querySelector('a')!.getAttribute('href')).toBe('/imports?entityType=product');
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });

  it('columns the engine could not map -> hint with the full import page, no mapping call', async () => {
    const r = rig({ mapping: { name: 'Name' } });
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Cost\nx,1\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    expect(textOf(el.querySelector('#onb-prod-hint')!)).toContain('[onboarding.products.csvNoColumns]');
    expect(r.api['updateImportMapping']).not.toHaveBeenCalled();
  });

  it('a wrong file type -> ONB_IMPORT_BAD_FILE; a failing upload -> the mapped error', async () => {
    const r = rig();
    const { f, el } = await openCsv(r);
    chooseFile(f, el, '#onb-prod-file', new File(['x'], 'items.pdf'));
    click(f, el, '#onb-prod-csv-check');
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_IMPORT_BAD_FILE]');
    r.api['uploadImport'].mockReturnValue(throwError(() => ({ status: 0 })));
    chooseFile(f, el, '#onb-prod-file', new File(['Name,Price\nx,1\n'], 'items.csv'));
    click(f, el, '#onb-prod-csv-check');
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(r.help.lastError()).toBe('ONB_NETWORK');
  });

  it('Back returns to the form', async () => {
    const r = rig();
    const { f, el } = await openCsv(r);
    click(f, el, '.onb-bar-links .onb-link');
    expect(textOf(el.querySelector('h1')!)).toBe('[onboarding.products.title]');
    expect(r.api['uploadImport']).not.toHaveBeenCalled();
  });
});
