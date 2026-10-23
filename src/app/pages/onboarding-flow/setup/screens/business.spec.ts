import { Component, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { LocUiService } from '../../../localization/shared/loc-ui.service';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import { ONB_INDUSTRY_KEYS, type OnbState } from '../../onb.types';
import { BusinessCrScreen } from './business-cr';
import { BusinessIndustryScreen } from './business-industry';
import { BusinessLinksScreen } from './business-links';
import { BusinessNameScreen } from './business-name';
import { fieldOfError } from './onb-a-kit';
import {
  AFTER_BUSINESS_URL, BUSINESS_COUNTRIES, BUSINESS_URLS, classifyLink, cleanLine, isAnswered, nextBusinessUrl, validBusinessName, validContactEmail,
  validCrNumber,
} from './onb-business-rules';

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
}
@Component({ template: '' }) class Blank {}

const st = (over: Partial<OnbState> = {}): OnbState => ({
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'business', steps: { business: { status: 'todo' } }, business: {}, ...over,
});

type Fn = ReturnType<typeof vi.fn>;
interface Rig { state: OnbStateService; router: Router; api: Record<string, Fn>; nav: Fn; help: OnbHelpService; announcer: OnbAnnouncer; toast: LocUiService }

function rig(initial: OnbState | null, opts: { query?: Record<string, string>; role?: 'owner' | 'member' } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const session$ = new BehaviorSubject<unknown>({ role: opts.role ?? 'owner', user: { name: 'Sara', phone: '', email: '' }, workspace: { name: 'W' } });
  const api: Record<string, Fn> = {
    getState: vi.fn(() => new Subject<OnbState>()),
    putBusiness: vi.fn(() => of({})),
    event: vi.fn(() => of({})),
    helpContext: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}) } } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  state.state.set(initial);
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigateByUrl') as unknown as Fn;
  return { state, router, api, nav, help: TestBed.inject(OnbHelpService), announcer: TestBed.inject(OnbAnnouncer), toast: TestBed.inject(LocUiService) };
}

async function mount<T>(cls: Type<T>): Promise<{ f: ComponentFixture<T>; el: HTMLElement }> {
  await TestBed.inject(I18nService).init();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const f = TestBed.createComponent(cls);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement };
}

const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ');
const type = (f: ComponentFixture<unknown>, el: HTMLElement, selector: string, value: string): HTMLInputElement => {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
  return input;
};
const submit = (f: ComponentFixture<unknown>, el: HTMLElement): void => {
  el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  f.detectChanges();
};
const lastCall = (fn: Fn): unknown[] => fn.mock.calls[fn.mock.calls.length - 1];

// ------------------------------------------------------------------------------------------------------------------

describe('Step 1 rules (pure)', () => {
  it('cleanLine removes control and bidi characters and collapses spaces', () => {
    const dirty = `  Sara${String.fromCodePoint(0x202e)}'s   Cafe${String.fromCodePoint(0x200b)}${String.fromCharCode(7)} `;
    expect(cleanLine(dirty)).toBe("Sara's Cafe");
    expect(cleanLine(null)).toBe('');
  });

  it.each<[unknown, string | null]>([
    ['Sara Cafe', 'Sara Cafe'],
    ['  Sara   Cafe ', 'Sara Cafe'],
    ['ab', 'ab'],
    ['a', null],
    ['', null],
    ['   ', null],
    ['x'.repeat(80), 'x'.repeat(80)],
    ['x'.repeat(81), null],
    [undefined, null],
  ])('business name %j', (input, expected) => {
    expect(validBusinessName(input)).toBe(expected);
  });

  it.each<[unknown, string | null]>([
    ['12345', '12345'],
    ['1010-123456', '1010123456'],
    ['1010 123 456', '1010123456'],
    ['AB12C', 'AB12C'],
    ['1234', null],
    ['x'.repeat(21), null],
    ['12 345!', null],
    ['', null],
  ])('CR number %j', (input, expected) => {
    expect(validCrNumber(input)).toBe(expected);
  });

  describe('validContactEmail (optional "Email for updates", the server\'s own format check)', () => {
    it.each<[unknown, string]>([
      ['sara@example.com', 'sara@example.com'],
      ['  Sara@Example.COM  ', 'sara@example.com'],
      ['sara.o-neil+shop@mail.example.co.uk', 'sara.o-neil+shop@mail.example.co.uk'],
      ['a@b.co', 'a@b.co'],
      [`sara${String.fromCodePoint(0x200b)}@example.com`, 'sara@example.com'],
      [`${'a'.repeat(108)}@example.com`, `${'a'.repeat(108)}@example.com`],
    ])('%j is accepted as %s', (input, expected) => {
      expect(validContactEmail(input)).toBe(expected);
    });

    it.each<unknown>([
      '', '   ', null, undefined, 'sara', 'sara@', '@example.com', 'sara@example', 'sara@@example.com', 'sa ra@example.com', 'sara@exa mple.com',
      '<sara>@example.com', 'sara,x@example.com', 'sara;x@example.com', 'sara:x@example.com', 'a@b.', 'a@.b', 'sara(x)@example.com',
      'sara@example.com, bob@example.com', 'sara[x]@example.com', `sara${String.fromCharCode(92)}x@example.com`, `${'a'.repeat(109)}@example.com`, 42, {},
    ])('%j is not an address', (input) => {
      expect(validContactEmail(input)).toBeNull();
    });
  });

  describe('classifyLink', () => {
    it.each<[string, string]>([
      ['@sara', 'sara'],
      ['sara', 'sara'],
      ['sara.cafe_1', 'sara.cafe_1'],
      ['instagram.com/sara', 'sara'],
      ['https://www.instagram.com/sara.cafe/', 'sara.cafe'],
      ['http://instagram.com/sara?igsh=abc', 'sara'],
      ['  @Sara_Cafe  ', 'Sara_Cafe'],
    ])('%s is the Instagram name %s', (input, handle) => {
      expect(classifyLink(input)).toEqual({ kind: 'instagram', instagram: handle });
    });

    it.each<[string, string]>([
      ['https://sara.sa', 'https://sara.sa'],
      ['sara.sa', 'https://sara.sa'],
      ['sara-cafe.com', 'https://sara-cafe.com'],
      ['www.sara.com', 'https://www.sara.com'],
      ['http://sara.com', 'https://sara.com'],
      ['https://sara.com/menu', 'https://sara.com/menu'],
      ['https://sara.com/', 'https://sara.com'],
    ])('%s is the website %s', (input, url) => {
      expect(classifyLink(input)).toEqual({ kind: 'website', website: url });
    });

    it.each<string>(['not a link!', 'https://', 'ftp://sara.com', 'sara@example.com', '@', 'a'.repeat(31), 'https://sara', 'javascript:alert(1)', 'https://user:pw@sara.com'])(
      '%s is invalid',
      (input) => {
        expect(classifyLink(input).kind).toBe('invalid');
      },
    );

    it('empty (or only spaces) is allowed: the field is optional', () => {
      expect(classifyLink('')).toEqual({ kind: 'empty' });
      expect(classifyLink('   ')).toEqual({ kind: 'empty' });
      expect(classifyLink(undefined)).toEqual({ kind: 'empty' });
    });

    it('an over-long website is invalid', () => {
      expect(classifyLink(`https://${'a'.repeat(200)}.com`).kind).toBe('invalid');
    });
  });

  describe('which screen is next', () => {
    const full = { name: 'Sara', country: 'SA', industry: 'fashion', website: 'https://sara.sa', crNumber: '12345' };
    it('a screen is answered when its data is known and valid', () => {
      expect(isAnswered('name', { name: 'Sara', country: 'SA' })).toBe(true);
      expect(isAnswered('name', { name: 'S', country: 'SA' })).toBe(false);
      expect(isAnswered('name', { name: 'Sara' })).toBe(false);
      expect(isAnswered('industry', { industry: 'fashion' })).toBe(true);
      expect(isAnswered('links', { instagram: 'sara' })).toBe(true);
      expect(isAnswered('links', {})).toBe(false);
      expect(isAnswered('cr', { crSkipped: true })).toBe(true);
      expect(isAnswered('cr', { crNumber: '12345' })).toBe(true);
      expect(isAnswered('cr', null)).toBe(false);
    });

    it('from the start: the first unanswered screen, or Step 2 when everything is known', () => {
      expect(nextBusinessUrl('start', {})).toBe(BUSINESS_URLS.name);
      expect(nextBusinessUrl('start', { name: 'Sara', country: 'SA' })).toBe(BUSINESS_URLS.industry);
      expect(nextBusinessUrl('start', { name: 'Sara', country: 'SA', industry: 'fashion' })).toBe(BUSINESS_URLS.links);
      expect(nextBusinessUrl('start', { ...full, crNumber: undefined })).toBe(BUSINESS_URLS.cr);
      expect(nextBusinessUrl('start', full)).toBe(AFTER_BUSINESS_URL);
    });

    it('after a screen: later screens whose data is known are skipped', () => {
      expect(nextBusinessUrl('industry', { ...full, website: undefined })).toBe(BUSINESS_URLS.links);
      expect(nextBusinessUrl('industry', full)).toBe(AFTER_BUSINESS_URL);
      expect(nextBusinessUrl('links', { ...full, crNumber: undefined })).toBe(BUSINESS_URLS.cr);
      expect(nextBusinessUrl('cr', {})).toBe(AFTER_BUSINESS_URL);
      expect(nextBusinessUrl('name', { name: 'Sara', country: 'SA' })).toBe(BUSINESS_URLS.industry);
    });

    it('the Step 1 URLs are the routes of setup.routes', () => {
      expect(Object.values(BUSINESS_URLS)).toEqual(['/setup/business/name', '/setup/business/industry', '/setup/business/links', '/setup/business/cr']);
      expect(AFTER_BUSINESS_URL).toBe('/setup/number');
      expect(BUSINESS_COUNTRIES).toEqual(['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'OTHER']);
    });
  });

  describe('fieldOfError (which field a VALIDATION_FAILED points at)', () => {
    it.each<[unknown, string | null]>([
      // the real backend bodies
      [{ status: 422, error: { error: 'Some of the information is not valid.', code: 'VALIDATION_FAILED', retryable: false, details: { fields: { name: 'LENGTH' } } } }, 'name'],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { website: 'INVALID' } } } }, 'links'],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { instagram: 'INVALID' } } } }, 'links'],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { crNumber: 'INVALID' } } } }, 'cr'],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { contactEmail: 'INVALID' } } } }, 'email'],
      [{ error: { code: 'VALIDATION_FAILED', fields: ['contactEmail'] } }, 'email'],
      [{ error: { code: 'VALIDATION_FAILED', details: { field: 'email' } } }, 'email'],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { body: 'EMPTY' } } } }, null],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: ['confirmText'] } } }, null],
      [{ status: 422, error: { code: 'VALIDATION_FAILED', details: { reason: 'NOTHING_ADDED', fields: { state: 'NO_DATA' } } } }, null],
      [{ error: { code: 'VALIDATION_FAILED', fields: ['name'] } }, 'name'],
      [{ error: { code: 'VALIDATION_FAILED', details: { fields: { website: 'https' } } } }, 'links'],
      [{ error: { code: 'VALIDATION_FAILED', details: { field: 'instagram' } } }, 'links'],
      [{ error: { code: 'VALIDATION_FAILED', fields: { crNumber: 'x' } } }, 'cr'],
      [{ error: { code: 'VALIDATION_FAILED', details: [{ field: 'name' }] } }, 'name'],
      [{ error: { code: 'VALIDATION_FAILED' } }, null],
      [{ error: 'text' }, null],
      [null, null],
    ])('%j', (err, expected) => {
      expect(fieldOfError(err)).toBe(expected);
    });
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe('BusinessNameScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a fresh merchant sees one question (name + country, Saudi Arabia preselected) and one primary button', async () => {
    rig(st());
    const { el } = await mount(BusinessNameScreen);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.business.name.title]');
    const sel = el.querySelector<HTMLSelectElement>('select')!;
    expect(sel.value).toBe('SA');
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([...BUSINESS_COUNTRIES]);
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    expect(el.querySelector('app-onb-help')).not.toBeNull();
    const input = el.querySelector<HTMLInputElement>('input#onb-biz-name')!;
    expect(input.getAttribute('autocomplete')).toBe('organization');
    expect(el.querySelector(`label[for="onb-biz-name"]`)).not.toBeNull();
  });

  it('pre-fill skips the question: a valid name from checkout is saved for the merchant (default country) and the next screen opens', async () => {
    const r = rig(st({ prefill: { businessName: "  Sara's   Cafe " } }));
    const { el } = await mount(BusinessNameScreen);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ name: "Sara's Cafe", country: 'SA' });
    expect(lastCall(r.nav)[0]).toBe('/setup/business/industry');
    expect(el.querySelector('h1')).toBeNull(); // no flash of the question
  });

  it('pre-fill that cannot be saved falls back to the question, name filled in, and shows the error', async () => {
    const r = rig(st({ prefill: { businessName: 'Sara Cafe' } }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 503, error: { code: 'ONB_GENERIC' } })));
    const { f, el } = await mount(BusinessNameScreen);
    f.detectChanges();
    expect(el.querySelector('h1')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('input#onb-biz-name')!.value).toBe('Sara Cafe');
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('an invalid pre-fill name is ignored (the question is shown empty, nothing is sent)', async () => {
    const r = rig(st({ prefill: { businessName: 'x' } }));
    const { el } = await mount(BusinessNameScreen);
    expect(el.querySelector<HTMLInputElement>('input#onb-biz-name')!.value).toBe('');
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
  });

  it('a saved answer is skipped on the way through to the first unanswered screen (replacing the history entry)', async () => {
    const r = rig(st({ business: { name: 'Sara Cafe', country: 'AE' } }));
    await mount(BusinessNameScreen);
    expect(r.nav).toHaveBeenCalledWith('/setup/business/industry', { replaceUrl: true });
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
  });

  it('with ?edit=1 (the "Change" link) the saved answer is shown and editable, no skipping', async () => {
    const r = rig(st({ business: { name: 'Sara Cafe', country: 'AE' } }), { query: { edit: '1' } });
    const { el } = await mount(BusinessNameScreen);
    expect(r.nav).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('input#onb-biz-name')!.value).toBe('Sara Cafe');
    expect(el.querySelector<HTMLSelectElement>('select')!.value).toBe('AE');
  });

  it('an empty or one-letter name shows the inline message, focuses the field, sends nothing', async () => {
    const r = rig(st());
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'a');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-name-err')!)).toContain('[onboarding.business.error.name]');
    expect(el.querySelector('#onb-biz-name')!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#onb-biz-name-err')!.getAttribute('role')).toBe('alert');
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-biz-name')));
    type(f, el, 'input#onb-biz-name', 'Sara');
    expect(el.querySelector('#onb-biz-name-err')).toBeNull(); // typing clears the message
  });

  it('Continue sends the idempotent partial body {name, country} (trimmed) and opens the industry screen', async () => {
    const r = rig(st());
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', "  Sara's   Cafe  ");
    const sel = el.querySelector<HTMLSelectElement>('select')!;
    sel.value = 'KW';
    sel.dispatchEvent(new Event('change'));
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ name: "Sara's Cafe", country: 'KW' });
    expect(lastCall(r.nav)[0]).toBe('/setup/business/industry');
    expect(r.state.state()!.business).toEqual({ name: "Sara's Cafe", country: 'KW' });
  });

  it('sending the same answer twice sends the same body (idempotent)', async () => {
    const bodies: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      TestBed.resetTestingModule();
      document.body.innerHTML = '';
      const r = rig(st());
      const { f, el } = await mount(BusinessNameScreen);
      type(f, el, 'input#onb-biz-name', 'Sara Cafe');
      submit(f, el);
      bodies.push(r.api['putBusiness'].mock.calls[0][0]);
    }
    expect(bodies[0]).toEqual({ name: 'Sara Cafe', country: 'SA' });
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('a double submit sends ONE request; the button is busy', async () => {
    const r = rig(st());
    const pending = new Subject<unknown>();
    r.api['putBusiness'].mockReturnValue(pending);
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'Sara Cafe');
    submit(f, el);
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    const btn = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    pending.next({});
    pending.complete();
    f.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('the server answer is applied: a full state replaces the local one', async () => {
    const r = rig(st());
    r.api['putBusiness'].mockReturnValue(of(st({ business: { name: 'Sara Cafe', country: 'SA' }, nextStep: 'business' })));
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'Sara Cafe');
    submit(f, el);
    expect(r.state.state()!.business!.name).toBe('Sara Cafe');
  });

  it('server VALIDATION_FAILED on the name shows the inline name message, not the generic block', async () => {
    const r = rig(st());
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'VALIDATION_FAILED', fields: ['name'], error: 'raw server text' } })));
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'Sara Cafe');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-name-err')!)).toContain('[onboarding.business.error.name]');
    expect(el.textContent).not.toContain('raw server text');
    expect(r.help.lastError()).toBe('VALIDATION_FAILED');
    expect(el.querySelector('app-onb-a-error [role="alert"]')).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ['a network failure', { status: 0 }, 'ONB_NETWORK'],
    ['a 5xx', { status: 500 }, 'ONB_GENERIC'],
    ['a payment problem', { status: 402, error: { code: 'PAYMENT_PAST_DUE' } }, 'PAYMENT_PAST_DUE'],
    ['rate limiting', { status: 429 }, 'RATE_LIMITED'],
    ['a validation error on another field', { status: 422, error: { code: 'VALIDATION_FAILED', fields: ['crNumber'] } }, 'VALIDATION_FAILED'],
  ])('%s is shown as catalogue text in an alert and primes Need help (%s)', async (_n, err, code) => {
    const r = rig(st());
    r.api['putBusiness'].mockReturnValue(throwError(() => err));
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'Sara Cafe');
    submit(f, el);
    const alert = el.querySelector('app-onb-a-error [role="alert"]')!;
    expect(textOf(alert)).toContain(`[onboarding.errors.${code}]`);
    expect(r.help.lastError()).toBe(code);
    expect(r.nav).not.toHaveBeenCalledWith('/setup/business/industry');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false); // can retry
  });

  it('focuses the heading on entry', async () => {
    rig(st());
    const { el } = await mount(BusinessNameScreen);
    const h1 = el.querySelector('h1')!;
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
  });

  it('members can do Step 1 (no owner-only gate)', async () => {
    const r = rig(st(), { role: 'member' });
    const { f, el } = await mount(BusinessNameScreen);
    type(f, el, 'input#onb-biz-name', 'Sara Cafe');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe('BusinessIndustryScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const named = { name: "Sara's Cafe", country: 'SA' };

  it('shows the ten options as one radio group labelled by the heading; Continue is off until one is chosen', async () => {
    rig(st({ business: named }));
    const { f, el } = await mount(BusinessIndustryScreen);
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-labelledby')).toBe(el.querySelector('h1')!.id);
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((x) => x.value)).toEqual([...ONB_INDUSTRY_KEYS]);
    expect(radios.every((x) => !x.checked)).toBe(true);
    expect(new Set(radios.map((x) => x.name)).size).toBe(1); // one group: arrow keys move the choice
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(textOf(el)).toContain('[onboarding.industry.restaurant]');
    radios[2].checked = true;
    radios[2].dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it("shows the answers so far with a Change link to the edit mode of the first screen", async () => {
    rig(st({ business: named }));
    const { el } = await mount(BusinessIndustryScreen);
    const summary = el.querySelector('app-onb-a-summary .onb-summary')!;
    expect(textOf(summary)).toContain('[onboarding.business.summary]');
    const link = summary.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/setup/business/name?edit=1');
    expect(textOf(link)).toContain('[onboarding.common.change]');
    expect(summary.querySelector('span')!.getAttribute('dir')).toBe('auto');
  });

  it('uses the server list when it sends one (only keys that have copy)', async () => {
    rig(st({ business: { ...named, industryOptions: ['fashion', 'grocery', 'made_up_key'] } }));
    const { el } = await mount(BusinessIndustryScreen);
    expect(Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map((x) => x.value)).toEqual(['fashion', 'grocery']);
  });

  it('a list with no usable key falls back to the contract list', async () => {
    rig(st({ business: { ...named, industryOptions: ['nope'] } }));
    const { el } = await mount(BusinessIndustryScreen);
    expect(el.querySelectorAll('input[type="radio"]')).toHaveLength(ONB_INDUSTRY_KEYS.length);
  });

  it('the saved industry is preselected', async () => {
    rig(st({ business: { ...named, industry: 'fitness' } }));
    const { el } = await mount(BusinessIndustryScreen);
    expect(el.querySelector<HTMLInputElement>('input[value="fitness"]')!.checked).toBe(true);
  });

  it('Continue sends {industry} only; Step 1 is then done locally (Step 2 opens) and the next unanswered screen is the links screen', async () => {
    const r = rig(st({ business: named }));
    const { f, el } = await mount(BusinessIndustryScreen);
    const radio = el.querySelector<HTMLInputElement>('input[value="fashion"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    f.detectChanges();
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ industry: 'fashion' });
    expect(lastCall(r.nav)[0]).toBe('/setup/business/links');
    expect(r.state.state()!.steps!.business!.status).toBe('done');
    expect(r.state.state()!.nextStep).toBe('number');
    // step_complete is reported once the step is done (gate A: the subscription is active here)
    expect(r.api['event']).toHaveBeenCalledWith(expect.objectContaining({ type: 'step_complete', step: 'business' }));
  });

  it('screens whose data is known are skipped: links known -> CR, both known -> Step 2', async () => {
    const r = rig(st({ business: { ...named, website: 'https://sara.sa' } }));
    const a = await mount(BusinessIndustryScreen);
    a.el.querySelector<HTMLInputElement>('input[value="fashion"]')!.click();
    a.f.detectChanges();
    submit(a.f, a.el);
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const r2 = rig(st({ business: { ...named, website: 'https://sara.sa', crSkipped: true } }));
    const b = await mount(BusinessIndustryScreen);
    b.el.querySelector<HTMLInputElement>('input[value="grocery"]')!.click();
    b.f.detectChanges();
    submit(b.f, b.el);
    expect(lastCall(r2.nav)[0]).toBe('/setup/number');
  });

  it('a failed save keeps the choice and shows the catalogue error', async () => {
    const r = rig(st({ business: named }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(BusinessIndustryScreen);
    el.querySelector<HTMLInputElement>('input[value="grocery"]')!.click();
    f.detectChanges();
    submit(f, el);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(el.querySelector<HTMLInputElement>('input[value="grocery"]')!.checked).toBe(true);
    expect(r.help.lastError()).toBe('ONB_NETWORK');
  });

  it('focuses the heading on entry', async () => {
    rig(st({ business: named }));
    const { el } = await mount(BusinessIndustryScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe('BusinessLinksScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const known = { name: 'Sara Cafe', country: 'SA', industry: 'restaurant' };

  it('one optional field, left-to-right, URL keyboard, one primary button plus Skip for now', async () => {
    rig(st({ business: known }));
    const { el } = await mount(BusinessLinksScreen);
    const input = el.querySelector<HTMLInputElement>('#onb-biz-links')!;
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('inputmode')).toBe('url');
    expect(input.getAttribute('autocomplete')).toBe('url');
    expect(input.getAttribute('placeholder')).toBe('[onboarding.business.links.placeholder]');
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    expect(textOf(el)).toContain('[onboarding.common.skip]');
    expect(textOf(el)).toContain('[onboarding.business.links.body]');
  });

  it.each<[string, Record<string, string>]>([
    ['@sara_cafe', { instagram: 'sara_cafe' }],
    ['instagram.com/sara.cafe', { instagram: 'sara.cafe' }],
    ['https://sara.sa', { website: 'https://sara.sa' }],
    ['sara-cafe.com', { website: 'https://sara-cafe.com' }],
    ['http://sara.com', { website: 'https://sara.com' }],
  ])('"%s" is sent as %j', async (typed, body) => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, '#onb-biz-links', typed);
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith(body);
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
  });

  it('text that is neither shows the inline message, focuses the field, sends nothing', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, '#onb-biz-links', 'not a link!');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-links-err')!)).toContain('[onboarding.business.error.links]');
    expect(el.querySelector('#onb-biz-links')!.getAttribute('aria-invalid')).toBe('true');
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(r.nav).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('#onb-biz-links')));
  });

  it('an empty field, and Skip for now, store nothing and move on', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    submit(f, el);
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
    el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(r.nav).toHaveBeenCalledTimes(2);
  });

  it('skips the CR screen too when it is already answered', async () => {
    const r = rig(st({ business: { ...known, crNumber: '12345' } }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, '#onb-biz-links', '@sara');
    submit(f, el);
    expect(lastCall(r.nav)[0]).toBe('/setup/number');
  });

  it('shows what is already saved (website, else @instagram)', async () => {
    rig(st({ business: { ...known, website: 'https://sara.sa' } }));
    const a = await mount(BusinessLinksScreen);
    expect(a.el.querySelector<HTMLInputElement>('#onb-biz-links')!.value).toBe('https://sara.sa');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    rig(st({ business: { ...known, instagram: 'sara' } }));
    const b = await mount(BusinessLinksScreen);
    expect(b.el.querySelector<HTMLInputElement>('#onb-biz-links')!.value).toBe('@sara');
  });

  it('server VALIDATION_FAILED on website/instagram shows the inline links message', async () => {
    const r = rig(st({ business: known }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'VALIDATION_FAILED', fields: ['website'] } })));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, '#onb-biz-links', 'https://sara.sa');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-links-err')!)).toContain('[onboarding.business.error.links]');
  });

  it('focuses the heading on entry', async () => {
    rig(st({ business: known }));
    const { el } = await mount(BusinessLinksScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe('BusinessLinksScreen: email for updates (optional)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const known = { name: 'Sara Cafe', country: 'SA', industry: 'restaurant' };
  const EMAIL = '#onb-biz-email';
  const LINKS = '#onb-biz-links';

  it('a second, optional field: email keyboard, left-to-right, its own label and hint; still ONE primary button and Skip first', async () => {
    rig(st({ business: known }));
    const { el } = await mount(BusinessLinksScreen);
    const input = el.querySelector<HTMLInputElement>(EMAIL)!;
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('inputmode')).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(input.getAttribute('maxlength')).toBe('120');
    expect(input.getAttribute('placeholder')).toBe('[onboarding.business.email.placeholder]');
    expect(input.required).toBe(false);
    expect(el.querySelector('label[for="onb-biz-email"]')!.textContent).toContain('[onboarding.business.email.field]');
    expect(textOf(el.querySelector('#onb-biz-email-hint')!)).toContain('[onboarding.business.email.hint]');
    expect(input.getAttribute('aria-describedby')).toContain('onb-biz-email-hint');
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    expect(el.querySelector('button.onb-link')!.textContent).toContain('[onboarding.common.skip]'); // the first link-button is still Skip
    expect(el.querySelectorAll('input:not([type="hidden"])')).toHaveLength(2); // two fields at most on one screen
  });

  it('typing only an address sends {contactEmail} (trimmed, lower-case), nothing else, and opens the CR screen', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, EMAIL, '  Sara@Example.COM ');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ contactEmail: 'sara@example.com' });
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
    expect(r.state.state()!.business!.contactEmail).toBe('sara@example.com');
  });

  it('a link and an address go together in ONE request', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, '@sara_cafe');
    type(f, el, EMAIL, 'sara@example.com');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ instagram: 'sara_cafe', contactEmail: 'sara@example.com' });
  });

  it('an empty address never adds a key to the body (the existing link bodies are byte-for-byte what they were)', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, 'https://sara.sa');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ website: 'https://sara.sa' });
    expect(Object.keys(r.api['putBusiness'].mock.calls[0][0] as object)).toEqual(['website']);
  });

  it.each(['sara', 'sara@', 'sara@example', 'sara @example.com', 'a@@b.co', '<a>@b.co'])('"%s" shows the inline message, focuses the email box and sends nothing', async (typed) => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, '@sara_cafe'); // a good link does not get sent without the address either: one request, one decision
    type(f, el, EMAIL, typed);
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-email-err')!)).toContain('[onboarding.business.error.email]');
    expect(el.querySelector(EMAIL)!.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#onb-biz-links-err')).toBeNull();
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(r.nav).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector(EMAIL)));
  });

  it('a wrong link is reported first and gets the focus; both messages can show at once; nothing is sent', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, 'not a link!');
    type(f, el, EMAIL, 'nope');
    submit(f, el);
    expect(el.querySelector('#onb-biz-links-err')).not.toBeNull();
    expect(el.querySelector('#onb-biz-email-err')).not.toBeNull();
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector(LINKS)));
  });

  it('typing again clears the inline message of that field only', async () => {
    rig(st({ business: known }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, 'not a link!');
    type(f, el, EMAIL, 'nope');
    submit(f, el);
    type(f, el, EMAIL, 'nope@');
    expect(el.querySelector('#onb-biz-email-err')).toBeNull();
    expect(el.querySelector('#onb-biz-links-err')).not.toBeNull();
  });

  it('is pre-filled from the saved address, else from the one captured at checkout; a broken pre-fill is not shown', async () => {
    rig(st({ business: { ...known, contactEmail: 'saved@shop.example' }, prefill: { email: 'checkout@shop.example' } }));
    const a = await mount(BusinessLinksScreen);
    expect(a.el.querySelector<HTMLInputElement>(EMAIL)!.value).toBe('saved@shop.example');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    rig(st({ business: known, prefill: { email: 'Checkout@Shop.Example' } }));
    const b = await mount(BusinessLinksScreen);
    expect(b.el.querySelector<HTMLInputElement>(EMAIL)!.value).toBe('checkout@shop.example');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    rig(st({ business: known, prefill: { email: 'not an address' } }));
    const c = await mount(BusinessLinksScreen);
    expect(c.el.querySelector<HTMLInputElement>(EMAIL)!.value).toBe('');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    rig(st({ business: known }));
    const d = await mount(BusinessLinksScreen);
    expect(d.el.querySelector<HTMLInputElement>(EMAIL)!.value).toBe('');
  });

  it('Continue with the checkout address left in place saves it (the merchant saw it and accepted it)', async () => {
    const r = rig(st({ business: known, prefill: { email: 'checkout@shop.example' } }));
    const { f, el } = await mount(BusinessLinksScreen);
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ contactEmail: 'checkout@shop.example' });
  });

  it('Skip sends nothing at all, even with a pre-filled address', async () => {
    const r = rig(st({ business: known, prefill: { email: 'checkout@shop.example' } }));
    const { el } = await mount(BusinessLinksScreen);
    el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
  });

  it('a saved address that is unchanged is not sent again; a changed one is; an emptied one is cleared with null', async () => {
    const r = rig(st({ business: { ...known, contactEmail: 'saved@shop.example' } }));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, LINKS, '@sara_cafe');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenLastCalledWith({ instagram: 'sara_cafe' }); // same address: not repeated
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const r2 = rig(st({ business: { ...known, contactEmail: 'saved@shop.example' } }));
    const b = await mount(BusinessLinksScreen);
    type(b.f, b.el, EMAIL, 'new@shop.example');
    submit(b.f, b.el);
    expect(r2.api['putBusiness']).toHaveBeenLastCalledWith({ contactEmail: 'new@shop.example' });
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const r3 = rig(st({ business: { ...known, contactEmail: 'saved@shop.example' } }));
    const c = await mount(BusinessLinksScreen);
    type(c.f, c.el, EMAIL, '   ');
    submit(c.f, c.el);
    expect(r3.api['putBusiness']).toHaveBeenLastCalledWith({ contactEmail: null });
    expect(r3.state.state()!.business!.contactEmail).toBeNull();
  });

  it('a saved address and nothing else typed: Continue just moves on (nothing to send)', async () => {
    const r = rig(st({ business: { ...known, contactEmail: 'saved@shop.example' } }));
    const { f, el } = await mount(BusinessLinksScreen);
    submit(f, el);
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
  });

  it('members can set it too (Steps 1 and 2 are not owner-only)', async () => {
    const r = rig(st({ business: known }), { role: 'member' });
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, EMAIL, 'member@shop.example');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ contactEmail: 'member@shop.example' });
    expect(lastCall(r.nav)[0]).toBe('/setup/business/cr');
  });

  it('the server refusing the address (it checks the same format) shows the inline email message, not the generic block', async () => {
    const r = rig(st({ business: known }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'VALIDATION_FAILED', details: { fields: { contactEmail: 'INVALID' } } } })));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, EMAIL, 'sara@example.com');
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-email-err')!)).toContain('[onboarding.business.error.email]');
    expect(el.querySelector('#onb-biz-links-err')).toBeNull();
    expect(el.querySelector('app-onb-a-error [role="alert"]')).toBeNull();
    expect(r.help.lastError()).toBe('VALIDATION_FAILED');
    expect(r.nav).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector(EMAIL)));
  });

  it('any other failure still uses the generic error block and keeps what was typed', async () => {
    const r = rig(st({ business: known }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, EMAIL, 'sara@example.com');
    submit(f, el);
    expect(textOf(el.querySelector('app-onb-a-error [role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
    expect(el.querySelector<HTMLInputElement>(EMAIL)!.value).toBe('sara@example.com');
    expect(el.querySelector('#onb-biz-email-err')).toBeNull();
  });

  it('a double submit sends ONE request', async () => {
    const r = rig(st({ business: known }));
    r.api['putBusiness'].mockReturnValue(new Subject());
    const { f, el } = await mount(BusinessLinksScreen);
    type(f, el, EMAIL, 'sara@example.com');
    submit(f, el);
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------------------------------------------------------

describe('BusinessCrScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const known = { name: 'Sara Cafe', country: 'SA', industry: 'restaurant' };

  it('asks for the NUMBER only: there is no upload control (D14)', async () => {
    rig(st({ business: known }));
    const { el } = await mount(BusinessCrScreen);
    expect(el.querySelector('input[type="file"]')).toBeNull();
    expect(el.querySelector('[accept]')).toBeNull();
    expect(textOf(el)).toContain('[onboarding.business.cr.body]');
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    expect(el.querySelector('#onb-biz-cr')!.getAttribute('dir')).toBe('ltr');
  });

  it('a valid number is sent as {crNumber} (spaces and hyphens dropped) and Step 2 opens', async () => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessCrScreen);
    type(f, el, '#onb-biz-cr', '1010-123 456');
    submit(f, el);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ crNumber: '1010123456' });
    expect(lastCall(r.nav)[0]).toBe('/setup/number');
  });

  it.each<string>(['', '1234', 'x'.repeat(21), 'ab!cd'])('"%s" shows the inline CR message and sends nothing', async (typed) => {
    const r = rig(st({ business: known }));
    const { f, el } = await mount(BusinessCrScreen);
    type(f, el, '#onb-biz-cr', typed);
    submit(f, el);
    expect(textOf(el.querySelector('#onb-biz-cr-err')!)).toContain('[onboarding.business.error.cr]');
    expect(r.api['putBusiness']).not.toHaveBeenCalled();
  });

  it('"I don\'t have it yet" sends {crSkipped:true}, reassures (toast + announcement), records cr_skipped and opens Step 2', async () => {
    const r = rig(st({ business: known }));
    const { el } = await mount(BusinessCrScreen);
    el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    expect(r.api['putBusiness']).toHaveBeenCalledTimes(1);
    expect(r.api['putBusiness']).toHaveBeenCalledWith({ crSkipped: true });
    expect(lastCall(r.nav)[0]).toBe('/setup/number');
    expect(r.toast.toasts().map((t) => t.message)).toContain('[onboarding.business.cr.skipped]');
    expect(r.announcer.message()).toContain('[onboarding.business.cr.skipped]');
    expect(r.api['event']).toHaveBeenCalledWith({ type: 'step_skip', step: 'business', code: 'cr_skipped' });
  });

  it('skipping twice sends the same body', async () => {
    const r = rig(st({ business: known }));
    const a = await mount(BusinessCrScreen);
    a.el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    a.f.detectChanges();
    a.el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    expect(r.api['putBusiness'].mock.calls.map((c) => c[0])).toEqual([{ crSkipped: true }, { crSkipped: true }]);
  });

  it('a failed skip shows the error and does not leave the screen', async () => {
    const r = rig(st({ business: known }));
    r.api['putBusiness'].mockReturnValue(throwError(() => ({ status: 500 })));
    const { f, el } = await mount(BusinessCrScreen);
    el.querySelector<HTMLButtonElement>('button.onb-link')!.click();
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_GENERIC]');
    expect(r.nav).not.toHaveBeenCalled();
    expect(r.toast.toasts()).toHaveLength(0);
  });

  it('shows the saved CR number and focuses the heading', async () => {
    rig(st({ business: { ...known, crNumber: '1010123456' } }));
    const { el } = await mount(BusinessCrScreen);
    expect(el.querySelector<HTMLInputElement>('#onb-biz-cr')!.value).toBe('1010123456');
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});
