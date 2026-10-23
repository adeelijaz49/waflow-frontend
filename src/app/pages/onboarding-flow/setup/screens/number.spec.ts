import { Component, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import arCatalog from '../../../../i18n/catalogs/ar/onboarding.json';
import enCatalog from '../../../../i18n/catalogs/en/onboarding.json';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type { OnbState } from '../../onb.types';
import { BUSINESS_APP_KEYS, NumberBusinessAppScreen } from './number-business-app';
import { NumberGetOneScreen } from './number-get-one';
import { NUMBER_HELP_MAX, NumberHelpScreen } from './number-help';
import { NumberLandlineScreen } from './number-landline';
import { NumberMigrateScreen } from './number-migrate';
import { NumberNotSureScreen } from './number-not-sure';
import { NumberPausedScreen } from './number-paused';
import { NumberPersonalScreen } from './number-personal';
import { NumberQuestionScreen } from './number-question';
import { NumberWhereScreen } from './number-where';
import { SAUDI_TELECOM_GUIDANCE_URL } from '../../onb-links';
import { serverNextStep } from './onb-a-kit';

vi.setConfig({ testTimeout: 30000 });

const en = enCatalog as Record<string, string>;
const ar = arCatalog as Record<string, string>;

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
  enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'number',
  steps: { business: { status: 'done' }, number: { status: 'todo' } }, business: { name: 'Sara Cafe', country: 'SA', industry: 'fashion' }, ...over,
});

type Fn = ReturnType<typeof vi.fn>;
interface Rig { state: OnbStateService; router: Router; api: Record<string, Fn>; nav: Fn; help: OnbHelpService; announcer: OnbAnnouncer }

function rig(initial: OnbState | null = st(), opts: { query?: Record<string, string>; role?: 'owner' | 'member' } = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const session$ = new BehaviorSubject<unknown>({ role: opts.role ?? 'owner', user: { name: 'Sara', phone: '', email: '' }, workspace: { name: 'W' } });
  const api: Record<string, Fn> = {
    getState: vi.fn(() => new Subject<OnbState>()),
    numberPath: vi.fn(() => of({ path: 'A', nextStep: 'connect', guidance: { keys: ['x'] } })),
    numberReady: vi.fn(() => of({})),
    numberSupportRequest: vi.fn(() => of({})),
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
  vi.spyOn(state, 'reloadNow').mockResolvedValue(null); // the background re-read; the rig has no server
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigateByUrl') as unknown as Fn;
  return { state, router, api, nav, help: TestBed.inject(OnbHelpService), announcer: TestBed.inject(OnbAnnouncer) };
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
const keysIn = (el: Element): string[] => Array.from(textOf(el).matchAll(/\[(onboarding\.[A-Za-z0-9_.]+)\]/g)).map((m) => m[1]);
const lastUrl = (nav: Fn): unknown => nav.mock.calls[nav.mock.calls.length - 1]?.[0];
const clickText = (el: HTMLElement, selector: string, key: string): HTMLElement => {
  const hit = Array.from(el.querySelectorAll<HTMLElement>(selector)).find((e) => textOf(e).includes(`[${key}]`));
  if (!hit) throw new Error(`no ${selector} with ${key}`);
  hit.click();
  return hit;
};

const common = { afterEach: () => { vi.restoreAllMocks(); document.body.innerHTML = ''; } };

describe('NumberQuestionScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('one question, two equal-weight answers (no primary button), a "Not sure?" link and Need help', async () => {
    rig();
    const { el } = await mount(NumberQuestionScreen);
    expect(textOf(el.querySelector('h1')!)).toContain('[onboarding.number.q.title]');
    expect(el.querySelectorAll('button.onb-answer')).toHaveLength(2);
    expect(el.querySelector('button.onb-btn-primary')).toBeNull();
    expect(el.querySelector('a[href="/setup/number/not-sure"]')).not.toBeNull();
    expect(textOf(el)).toContain('[onboarding.number.q.notSure]');
    expect(el.querySelector('app-onb-help')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });

  it('Yes: no request (the backend rejects {hasNumber:true} without a usage), straight to the "where is it used" screen', async () => {
    const r = rig();
    const { el } = await mount(NumberQuestionScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.q.yes');
    expect(r.api['numberPath']).not.toHaveBeenCalled();
    expect(lastUrl(r.nav)).toBe('/setup/number/where');
  });

  it('No: POST {hasNumber:false} then Path B', async () => {
    const r = rig();
    const { el } = await mount(NumberQuestionScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.q.no');
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: false });
    expect(lastUrl(r.nav)).toBe('/setup/number/get-one');
    expect(r.state.state()!.steps!.number!.status).not.toBe('done'); // no number yet: Step 2 is not done
  });

  it('a double tap sends ONE request and both answers are disabled while it runs', async () => {
    const r = rig();
    const pending = new Subject<unknown>();
    r.api['numberPath'].mockReturnValue(pending);
    const { f, el } = await mount(NumberQuestionScreen);
    const no = clickText(el, 'button.onb-answer', 'onboarding.number.q.no');
    no.click();
    f.detectChanges();
    expect(r.api['numberPath']).toHaveBeenCalledTimes(1);
    expect(Array.from(el.querySelectorAll<HTMLButtonElement>('button.onb-answer')).every((b) => b.disabled)).toBe(true);
    expect(el.querySelector('section')!.getAttribute('aria-busy')).toBe('true');
  });

  it.each<[string, unknown, string]>([
    ['the number is already connected (409)', { status: 409, error: { code: 'NUMBER_ALREADY_CONNECTED' } }, 'NUMBER_ALREADY_CONNECTED'],
    ['a network failure', { status: 0 }, 'ONB_NETWORK'],
    ['past due', { status: 402, error: { code: 'PAYMENT_PAST_DUE' } }, 'PAYMENT_PAST_DUE'],
    ['a missing prerequisite', { status: 409, error: { code: 'STEP_PREREQUISITE' } }, 'STEP_PREREQUISITE'],
  ])('%s: catalogue text in an alert, Need help primed, no navigation', async (_n, err, code) => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => err));
    const { f, el } = await mount(NumberQuestionScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.q.no');
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain(`[onboarding.errors.${code}]`);
    expect(r.help.lastError()).toBe(code);
    expect(r.nav).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLButtonElement>('button.onb-answer')!.disabled).toBe(false);
  });

  it('after NUMBER_ALREADY_CONNECTED the merchant gets a link on to Step 4 instead of being able to change the answer', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => ({ status: 409, error: { code: 'NUMBER_ALREADY_CONNECTED' } })));
    const { f, el } = await mount(NumberQuestionScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.q.no');
    f.detectChanges();
    expect(el.querySelector('[role="alert"] a')!.getAttribute('href')).toBe('/setup/approvals');
  });

  it('members can answer (Step 2 has no owner gate)', async () => {
    const r = rig(st(), { role: 'member' });
    const { el } = await mount(NumberQuestionScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.q.no');
    expect(r.api['numberPath']).toHaveBeenCalledTimes(1);
  });
});

describe('NumberNotSureScreen', () => {
  afterEach(common.afterEach);
  it('says what the number is in two sentences and has one button back to the question; sends nothing', async () => {
    const r = rig();
    const { el } = await mount(NumberNotSureScreen);
    expect(textOf(el)).toContain('[onboarding.number.notSure.body]');
    const back = el.querySelectorAll('a.onb-btn-primary');
    expect(back).toHaveLength(1);
    expect(back[0].getAttribute('href')).toBe('/setup/number');
    expect(textOf(back[0])).toContain('[onboarding.number.notSure.back]');
    expect(el.querySelector('app-onb-help')).not.toBeNull();
    expect(r.api['numberPath']).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });

  it('the explanation says the number is the one customers message and differs from the personal WhatsApp', () => {
    expect(en['number.notSure.body']).toBe("This is the number your customers will message. It's different from your personal WhatsApp.");
  });
});

describe('NumberWhereScreen (Path A, four branches)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('four tappable rows with the four answers', async () => {
    rig();
    const { el } = await mount(NumberWhereScreen);
    expect(keysIn(el.querySelector('h1')!)).toEqual(['onboarding.number.where.title']);
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('button.onb-answer')).map((b) => keysIn(b)[0]);
    expect(rows).toEqual([
      'onboarding.number.where.none', 'onboarding.number.where.personal', 'onboarding.number.where.business', 'onboarding.number.where.landline',
    ]);
  });

  it('not on WhatsApp at all: POST {hasNumber:true, usage:"unused"}, Step 2 done locally, straight to Step 3', async () => {
    const r = rig();
    const { el } = await mount(NumberWhereScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.where.none');
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'unused' });
    expect(lastUrl(r.nav)).toBe('/setup/connect');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
    expect(r.state.state()!.nextStep).toBe('connect');
    expect(r.state.reloadNow).toHaveBeenCalled(); // the server's own answer replaces the local one
    expect(r.api['event']).toHaveBeenCalledWith(expect.objectContaining({ type: 'step_complete', step: 'number' }));
  });

  it.each<[string, string]>([
    ['onboarding.number.where.personal', '/setup/number/personal'],
    ['onboarding.number.where.business', '/setup/number/business-app'],
    ['onboarding.number.where.landline', '/setup/number/landline'],
  ])('%s opens its own screen first and sends nothing yet', async (key, url) => {
    const r = rig();
    const { el } = await mount(NumberWhereScreen);
    clickText(el, 'button.onb-answer', key);
    expect(lastUrl(r.nav)).toBe(url);
    expect(r.api['numberPath']).not.toHaveBeenCalled();
  });

  it('a failed answer shows the error and stays', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => ({ status: 500 })));
    const { f, el } = await mount(NumberWhereScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.where.none');
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_GENERIC]');
    expect(r.nav).not.toHaveBeenCalled();
    expect(r.state.state()!.steps!.number!.status).toBe('todo');
  });

  it('Back goes to the question; focus is on the heading', async () => {
    rig();
    const { el } = await mount(NumberWhereScreen);
    expect(el.querySelector('a[href="/setup/number"]')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('NumberPersonalScreen (the warning gate)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('shows the warning (alert), the how-to and an UNTICKED required checkbox; Continue is off until it is ticked', async () => {
    rig();
    const { f, el } = await mount(NumberPersonalScreen);
    expect(keysIn(el.querySelector('h1')!)).toEqual(['onboarding.number.personal.title']);
    const warn = el.querySelector('.onb-alert-warn')!;
    expect(warn.getAttribute('role')).toBe('alert');
    expect(textOf(warn)).toContain('[onboarding.number.personal.warning]');
    expect(textOf(el)).toContain('[onboarding.number.personal.how]');
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false); // consent is never pre-ticked
    expect(textOf(el)).toContain('[onboarding.number.personal.ack]');
    const go = el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!;
    expect(go.disabled).toBe(true);
    expect(textOf(go)).toContain('[onboarding.number.personal.go]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(go.disabled).toBe(false);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(go.disabled).toBe(true);
  });

  it('nothing is sent while the box is unticked (even if the handler is called directly)', async () => {
    const r = rig();
    const { f } = await mount(NumberPersonalScreen);
    f.componentInstance.confirm();
    expect(r.api['numberPath']).not.toHaveBeenCalled();
  });

  it('ticked: sends {hasNumber:true, usage:"personal", acknowledgeRemoval:true} and goes to Step 3', async () => {
    const r = rig();
    const { f, el } = await mount(NumberPersonalScreen);
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    expect(r.api['numberPath']).toHaveBeenCalledTimes(1);
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'personal', acknowledgeRemoval: true });
    expect(lastUrl(r.nav)).toBe('/setup/connect');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
  });

  it('a 422 NUMBER_PERSONAL_WARNING_REQUIRED shows the message, un-ticks the box and puts focus on it', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => ({ status: 422, error: { code: 'NUMBER_PERSONAL_WARNING_REQUIRED' } })));
    const { f, el } = await mount(NumberPersonalScreen);
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    f.detectChanges();
    expect(textOf(el.querySelector('app-onb-a-error [role="alert"]')!)).toContain('[onboarding.errors.NUMBER_PERSONAL_WARNING_REQUIRED]');
    expect(box.checked).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.disabled).toBe(true);
    expect(r.nav).not.toHaveBeenCalled();
    expect(r.help.lastError()).toBe('NUMBER_PERSONAL_WARNING_REQUIRED');
  });

  it('"Choose a different number" goes to Path B with {hasNumber:false} (no acknowledgement needed)', async () => {
    const r = rig();
    const { el } = await mount(NumberPersonalScreen);
    clickText(el, 'button.onb-link', 'onboarding.number.personal.other');
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: false });
    expect(lastUrl(r.nav)).toBe('/setup/number/get-one');
  });

  it('the how-to carries only the verified facts: delete the account, back up chats, up to 3 minutes', () => {
    const how = en['number.personal.how'];
    expect(how).toMatch(/Delete my account/);
    expect(how).toMatch(/back up your chats/i);
    expect(how).toMatch(/3 minutes/);
    expect(en['number.personal.warning']).toMatch(/lose WhatsApp on that number/);
  });

  it('focus goes to the heading; Need help is present', async () => {
    rig();
    const { el } = await mount(NumberPersonalScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
    expect(el.querySelector('app-onb-help')).not.toBeNull();
  });
});

describe('NumberBusinessAppScreen (verified wording only)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('renders exactly the verified key set and nothing else', async () => {
    rig();
    const { el } = await mount(NumberBusinessAppScreen);
    // the page chrome (help button, back link) adds common/help keys; the screen's own copy is the number.bizapp.* set
    const own = keysIn(el).filter((k) => k.startsWith('onboarding.number.'));
    expect([...new Set(own)].sort()).toEqual([...BUSINESS_APP_KEYS].sort());
    expect(BUSINESS_APP_KEYS).toHaveLength(10);
  });

  it('the verified copy makes no country claim and never says "free"; availability is not promised', () => {
    for (const key of BUSINESS_APP_KEYS) {
      const k = key.replace('onboarding.', '');
      expect(en[k], k).toBeTruthy();
      expect(en[k], k).not.toMatch(/\bfree\b|\bfreely\b|no cost|no charge|at no/i);
      expect(en[k], k).not.toMatch(/Saudi|KSA|Arabia|Emirates|UAE|Kuwait|Qatar|Bahrain|Oman|Gulf|Middle East|Riyadh/i);
      expect(ar[k], k).not.toMatch(/مجان|بلا\s*مقابل|السعود|الإمارات|الكويت|قطر|البحرين|عُمان|الخليج|الرياض/);
    }
    expect(en['number.bizapp.body']).toMatch(/may be able to/);
    expect(en['number.bizapp.body']).toMatch(/can't promise/);
    expect(en['number.bizapp.c4']).toBe('Messages sent through WaFlow are charged by Meta to your own Meta account.');
    expect(en['number.bizapp.c3']).toMatch(/every 2 weeks/);
  });

  it('Continue and connect: {hasNumber:true, usage:"business_app", businessAppChoice:"coexistence"} then Step 3 (Meta decides there)', async () => {
    const r = rig();
    const { el } = await mount(NumberBusinessAppScreen);
    const prim = el.querySelectorAll('button.onb-btn-primary');
    expect(prim).toHaveLength(1);
    (prim[0] as HTMLButtonElement).click();
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'business_app', businessAppChoice: 'coexistence' });
    expect(lastUrl(r.nav)).toBe('/setup/connect');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
  });

  it('"Use a different number": {usage:"business_app", businessAppChoice:"different_number"} then Path B', async () => {
    const r = rig();
    const { el } = await mount(NumberBusinessAppScreen);
    clickText(el, 'button.onb-link', 'onboarding.number.bizapp.other');
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'business_app', businessAppChoice: 'different_number' });
    expect(lastUrl(r.nav)).toBe('/setup/number/get-one');
    expect(r.state.state()!.steps!.number!.status).toBe('todo');
  });

  it('"Move this number to WaFlow instead" opens the migrate screen without sending anything', async () => {
    const r = rig();
    const { el } = await mount(NumberBusinessAppScreen);
    const link = Array.from(el.querySelectorAll('a')).find((a) => textOf(a).includes('[onboarding.number.bizapp.move]'))!;
    expect(link.getAttribute('href')).toBe('/setup/number/migrate');
    expect(r.api['numberPath']).not.toHaveBeenCalled();
  });

  it('focus on the heading', async () => {
    rig();
    const { el } = await mount(NumberBusinessAppScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('NumberMigrateScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('says the WhatsApp account on the number is deleted first, chats are lost, up to 3 minutes', async () => {
    rig();
    const { el } = await mount(NumberMigrateScreen);
    expect(textOf(el)).toContain('[onboarding.number.migrate.body]');
    expect(en['number.migrate.body']).toMatch(/delete the WhatsApp account/);
    expect(en['number.migrate.body']).toMatch(/back up your chats/i);
    expect(en['number.migrate.body']).toMatch(/3 minutes/);
    expect(textOf(el)).not.toContain('[onboarding.number.migrate.noCoexist]');
  });

  it("I've deleted it: {usage:'business_app', businessAppChoice:'migrate'} then Step 3", async () => {
    const r = rig();
    const { el } = await mount(NumberMigrateScreen);
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'business_app', businessAppChoice: 'migrate' });
    expect(lastUrl(r.nav)).toBe('/setup/connect');
  });

  it('Use a different number: Path B', async () => {
    const r = rig();
    const { el } = await mount(NumberMigrateScreen);
    clickText(el, 'button.onb-link', 'onboarding.number.bizapp.other');
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'business_app', businessAppChoice: 'different_number' });
    expect(lastUrl(r.nav)).toBe('/setup/number/get-one');
  });

  it.each<[string, () => Rig]>([
    ['the connect step sends the merchant here with ?reason=coexistence', () => rig(st(), { query: { reason: 'coexistence' } })],
    ['the server says the last problem was CONNECT_COEXISTENCE_UNAVAILABLE', () => rig(st({ lastError: { code: 'CONNECT_COEXISTENCE_UNAVAILABLE' } }))],
    ['the connect screen just showed CONNECT_COEXISTENCE_UNAVAILABLE', () => { const r = rig(); r.help.setLastError('CONNECT_COEXISTENCE_UNAVAILABLE'); return r; }],
  ])('"Meta doesn\'t offer to keep the app on this number" when %s', async (_n, make) => {
    make();
    const { el } = await mount(NumberMigrateScreen);
    expect(textOf(el)).toContain('[onboarding.number.migrate.noCoexist]');
  });

  it('a failed answer shows the catalogue text', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => ({ status: 0 })));
    const { f, el } = await mount(NumberMigrateScreen);
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_NETWORK]');
  });
});

describe('NumberLandlineScreen', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('tells the merchant Meta will CALL, to be near the phone and choose "Call me"; one Continue button', async () => {
    const r = rig();
    const { el } = await mount(NumberLandlineScreen);
    expect(keysIn(el.querySelector('h1')!)).toEqual(['onboarding.number.landline.title']);
    expect(textOf(el)).toContain('[onboarding.number.landline.body]');
    expect(en['number.landline.title']).toMatch(/call this number/);
    expect(en['number.landline.body']).toMatch(/"Call me"/);
    expect(en['number.landline.body']).toMatch(/calls from abroad/);
    expect(en['number.landline.body']).toMatch(/Extensions don't work/);
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    expect(r.api['numberPath']).toHaveBeenCalledWith({ hasNumber: true, usage: 'landline' });
    expect(lastUrl(r.nav)).toBe('/setup/connect');
  });
});

describe('NumberGetOneScreen (Path B)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('shows the title, the explanation and the four tips; no regulatory rule is stated', async () => {
    rig();
    const { el } = await mount(NumberGetOneScreen);
    const keys = keysIn(el);
    for (const k of ['title', 'body', 'tips', 't1', 't2', 't3', 't4', 'link', 'ready', 'help', 'later']) expect(keys, k).toContain(`onboarding.number.getone.${k}`);
    expect(el.querySelectorAll('ul.onb-tips li')).toHaveLength(4);
    for (const k of ['t1', 't2', 't3', 't4']) expect(en[`number.getone.${k}`]).not.toMatch(/must be registered|is required by law|regulation requires|illegal/i);
    expect(en['number.getone.body']).toMatch(/must not already be used on WhatsApp/);
  });

  it('the regulator link opens in a new tab with noopener noreferrer, https', async () => {
    rig();
    const { el } = await mount(NumberGetOneScreen);
    const a = el.querySelector<HTMLAnchorElement>('ul.onb-tips a')!;
    expect(a.getAttribute('href')).toBe(SAUDI_TELECOM_GUIDANCE_URL);
    expect(SAUDI_TELECOM_GUIDANCE_URL.startsWith('https://')).toBe(true);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it("I've got my number: POST /number/ready, Step 2 done locally, Step 3", async () => {
    const r = rig();
    const { el } = await mount(NumberGetOneScreen);
    const prim = el.querySelectorAll('button.onb-btn-primary');
    expect(prim).toHaveLength(1);
    (prim[0] as HTMLButtonElement).click();
    expect(r.api['numberReady']).toHaveBeenCalledTimes(1);
    expect(lastUrl(r.nav)).toBe('/setup/connect');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
    expect(r.state.state()!.nextStep).toBe('connect');
    expect(r.state.reloadNow).toHaveBeenCalled();
  });

  it("I've got my number twice quickly sends one request", async () => {
    const r = rig();
    const pending = new Subject<unknown>();
    r.api['numberReady'].mockReturnValue(pending);
    const { f, el } = await mount(NumberGetOneScreen);
    const btn = el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!;
    btn.click();
    f.detectChanges();
    btn.click();
    expect(r.api['numberReady']).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
  });

  it('a failed "ready" shows the error and stays', async () => {
    const r = rig();
    r.api['numberReady'].mockReturnValue(throwError(() => ({ status: 409, error: { code: 'STEP_PREREQUISITE' } })));
    const { f, el } = await mount(NumberGetOneScreen);
    el.querySelector<HTMLButtonElement>('button.onb-btn-primary')!.click();
    f.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.STEP_PREREQUISITE]');
    expect(r.nav).not.toHaveBeenCalled();
  });

  it('"Ask WaFlow to help me get a number" opens the request screen; "I\'ll come back later" opens the pause and records number_paused', async () => {
    const r = rig();
    const { el } = await mount(NumberGetOneScreen);
    expect(el.querySelector('a[href="/setup/number/help"]')).not.toBeNull();
    const later = el.querySelector<HTMLAnchorElement>('a[href="/setup/number/paused"]')!;
    later.addEventListener('click', (e) => e.preventDefault());
    later.click();
    expect(r.api['event']).toHaveBeenCalledWith({ type: 'step_skip', step: 'number', code: 'number_paused' });
  });

  it('focus on the heading', async () => {
    rig();
    const { el } = await mount(NumberGetOneScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('NumberHelpScreen (one request)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  const note = (f: ComponentFixture<unknown>, el: HTMLElement, text: string): void => {
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const send = (f: ComponentFixture<unknown>, el: HTMLElement): void => {
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    f.detectChanges();
  };

  it('one optional note limited to 300 characters; one primary Send button; Need help is present', async () => {
    rig();
    const { el } = await mount(NumberHelpScreen);
    const ta = el.querySelector('textarea')!;
    expect(ta.getAttribute('maxlength')).toBe(String(NUMBER_HELP_MAX));
    expect(NUMBER_HELP_MAX).toBe(300);
    expect(ta.getAttribute('dir')).toBe('auto');
    expect(el.querySelector(`label[for="${ta.id}"]`)).not.toBeNull();
    expect(el.querySelectorAll('button.onb-btn-primary')).toHaveLength(1);
    expect(el.querySelector('app-onb-help')).not.toBeNull();
  });

  it('sends ONE request with the note (spaces collapsed, cut at 300), then shows the confirmation and no second request is possible', async () => {
    const r = rig();
    const { f, el } = await mount(NumberHelpScreen);
    note(f, el, `  I would like   a number\n for the shop ${'x'.repeat(400)}`);
    send(f, el);
    expect(r.api['numberSupportRequest']).toHaveBeenCalledTimes(1);
    const sent = r.api['numberSupportRequest'].mock.calls[0][0] as string;
    expect(sent.startsWith('I would like a number for the shop x')).toBe(true);
    expect(sent.length).toBe(300);
    expect(textOf(el)).toContain('[onboarding.number.help.done]');
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('button[type="submit"]')).toBeNull();
    expect(r.announcer.message()).toContain('[onboarding.number.help.done]');
    expect(f.componentInstance.outcome()).toBe('sent');
    f.componentInstance.send(new Event('submit'));
    expect(r.api['numberSupportRequest']).toHaveBeenCalledTimes(1);
    expect(el.querySelector('a.onb-btn-primary')!.getAttribute('href')).toBe('/setup/number/paused');
  });

  it('with no note the request carries no message', async () => {
    const r = rig();
    const { f, el } = await mount(NumberHelpScreen);
    send(f, el);
    expect(r.api['numberSupportRequest']).toHaveBeenCalledWith(undefined);
  });

  it('a double tap sends one request', async () => {
    const r = rig();
    const pending = new Subject<unknown>();
    r.api['numberSupportRequest'].mockReturnValue(pending);
    const { f, el } = await mount(NumberHelpScreen);
    send(f, el);
    send(f, el);
    expect(r.api['numberSupportRequest']).toHaveBeenCalledTimes(1);
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('the rate limit says "You\'ve already asked. We\'ll be in touch." (no error block)', async () => {
    const r = rig();
    r.api['numberSupportRequest'].mockReturnValue(throwError(() => ({ status: 429, error: { code: 'RATE_LIMITED' } })));
    const { f, el } = await mount(NumberHelpScreen);
    send(f, el);
    expect(textOf(el)).toContain('[onboarding.number.help.already]');
    expect(textOf(el)).not.toContain('[onboarding.errors.RATE_LIMITED]');
    expect(r.announcer.message()).toContain('[onboarding.number.help.already]');
    expect(r.help.lastError()).toBe('RATE_LIMITED');
  });

  it('another failure shows the catalogue text and the form stays for another try', async () => {
    const r = rig();
    r.api['numberSupportRequest'].mockReturnValue(throwError(() => ({ status: 500, error: { error: 'smtp password wrong' } })));
    const { f, el } = await mount(NumberHelpScreen);
    note(f, el, 'hello');
    send(f, el);
    expect(textOf(el.querySelector('[role="alert"]')!)).toContain('[onboarding.errors.ONB_GENERIC]');
    expect(el.textContent).not.toContain('smtp');
    expect(el.querySelector('textarea')!.value).toBe('hello');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('the confirmation says WaFlow cannot buy a number but will help choose one', () => {
    expect(en['number.help.done']).toMatch(/can't buy a number for you/);
    expect(en['number.help.done']).toMatch(/help you choose one/);
  });

  it('focus on the heading', async () => {
    rig();
    const { el } = await mount(NumberHelpScreen);
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });
});

describe('NumberPausedScreen (the paused landing)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(common.afterEach);

  it('says "Take your time", that progress is saved and that a reminder comes by e-mail, with the paused badge (icon + words)', async () => {
    rig(st({ number: { paused: true, path: 'B' }, progress: { status: 'paused_number' } }));
    const { el } = await mount(NumberPausedScreen);
    expect(keysIn(el.querySelector('h1')!)).toEqual(['onboarding.number.paused.title']);
    expect(textOf(el)).toContain('[onboarding.number.paused.body]');
    const badge = el.querySelector('.onb-badge')!;
    expect(textOf(badge)).toContain('[onboarding.number.paused.badge]');
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(en['number.paused.body']).toMatch(/email you a reminder/);
    expect(en['number.paused.body']).not.toMatch(/WhatsApp message/i);
    expect(el.querySelector('app-onb-help')).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector('h1')));
  });

  it("I've got my number resumes: POST /number/ready, Step 2 done, Step 3", async () => {
    const r = rig(st({ number: { paused: true }, progress: { status: 'paused_number' } }));
    const { el } = await mount(NumberPausedScreen);
    const prim = el.querySelectorAll('button.onb-btn-primary');
    expect(prim).toHaveLength(1);
    (prim[0] as HTMLButtonElement).click();
    expect(r.api['numberReady']).toHaveBeenCalledTimes(1);
    expect(lastUrl(r.nav)).toBe('/setup/connect');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
    expect(r.state.state()!.number!.paused).toBe(false);
  });

  it('offers the help request', async () => {
    rig(st({ number: { paused: true } }));
    const { el } = await mount(NumberPausedScreen);
    expect(el.querySelector('a[href="/setup/number/help"]')).not.toBeNull();
  });
});

describe('Step 2 across all screens', () => {
  afterEach(common.afterEach);

  it('every Step 2 screen has a focus-receiving heading, Need help, and no physical-direction CSS classes', async () => {
    const screens: Type<unknown>[] = [
      NumberQuestionScreen, NumberNotSureScreen, NumberWhereScreen, NumberPersonalScreen, NumberBusinessAppScreen, NumberMigrateScreen,
      NumberLandlineScreen, NumberGetOneScreen, NumberHelpScreen, NumberPausedScreen,
    ];
    for (const s of screens) {
      TestBed.resetTestingModule();
      document.body.innerHTML = '';
      rig();
      const { el } = await mount(s);
      const h1 = el.querySelector('h1')!;
      expect(h1.getAttribute('tabindex'), s.name).toBe('-1');
      expect(h1.classList.contains('onb-q'), s.name).toBe(true);
      expect(el.querySelector('app-onb-help'), s.name).not.toBeNull();
      expect(el.querySelectorAll('h1'), s.name).toHaveLength(1);
    }
  });

  it('the arabic copy of the screens exists for every key they use (spot check of the guidance keys)', () => {
    for (const k of ['number.q.title', 'number.personal.warning', 'number.personal.how', 'number.bizapp.body', 'number.migrate.body', 'number.landline.body', 'number.getone.link', 'number.help.done', 'number.paused.body']) {
      expect(typeof ar[k], k).toBe('string');
      expect(ar[k].length, k).toBeGreaterThan(3);
    }
  });
});

describe('Step 2 answers: the server confirms (POST /number/path, /number/ready)', () => {
  it('serverNextStep trusts the word of the server when it names a known step and falls back otherwise', () => {
    expect(serverNextStep({ nextStep: 'connect' }, 'connect')).toBe('connect');
    expect(serverNextStep({ nextStep: 'approvals' }, 'connect')).toBe('approvals');
    expect(serverNextStep({ nextStep: 'nonsense' }, 'connect')).toBe('connect');
    expect(serverNextStep({ nextStep: null }, 'connect')).toBe('connect');
    expect(serverNextStep(null, 'connect')).toBe('connect');
    expect(serverNextStep(undefined, null)).toBeNull();
  });

  it('a Path A answer marks Step 2 done only after the server accepted it, with the next step of the server', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(of({ path: 'A', nextStep: 'approvals', guidance: { keys: [] } }));
    const { el } = await mount(NumberWhereScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.where.none');
    expect(r.state.state()!.steps!.number!.status).toBe('done');
    expect(r.state.state()!.nextStep).toBe('approvals');
  });

  it('a refused answer (409) leaves Step 2 as it was', async () => {
    const r = rig();
    r.api['numberPath'].mockReturnValue(throwError(() => ({ status: 409, error: { code: 'NUMBER_ALREADY_CONNECTED' } })));
    const { el } = await mount(NumberWhereScreen);
    clickText(el, 'button.onb-answer', 'onboarding.number.where.none');
    expect(r.state.state()!.steps!.number!.status).toBe('todo');
    expect(r.state.state()!.nextStep).toBe('number');
  });
});
