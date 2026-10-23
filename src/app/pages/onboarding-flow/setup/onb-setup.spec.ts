import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { I18nService } from '../../../i18n/i18n.service';
import type { CatalogMap } from '../../../i18n/i18n.types';
import { AuthService } from '../../../shared/auth.service';
import { Dashboard } from '../../dashboard/dashboard';
import { OnbApiService } from '../onb-api.service';
import { OnbStateService } from '../onb-state.service';
import type { OnbState } from '../onb.types';
import { OnbChecklist, checklistRows, currentStepNumber } from './onb-checklist';
import { OnbDashboardHost } from './onb-dashboard-host';
import { OnbEntry } from './onb-entry';
import { OnbHome } from './onb-home';
import { OnbResume } from './onb-resume';
import { OnbSetupShell } from './onb-setup-shell';
import { SETUP_ROUTES, stepRedirect } from './setup.routes';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
let failCatalog = false;
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return failCatalog ? Promise.reject(new Error('chunk load failed')) : Promise.resolve(catalog());
  }
}
@Component({ template: '' }) class Blank {}
@Component({ selector: 'app-dashboard', template: `<div class="stub-dashboard">dash</div>` }) class StubDashboard {}

const st = (over: Partial<OnbState> = {}): OnbState => ({ enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'business', ...over });
const statusesOf = (state: OnbState) => checklistRows(state).map((r) => r.status);

describe('checklistRows', () => {
  it('a fresh merchant: step 1 is current, 2 is to do, 4 and 5 are locked until Step 3', () => {
    const rows = checklistRows(st({ steps: { business: { status: 'todo' } } }));
    expect(rows.map((r) => r.status)).toEqual(['current', 'todo', 'todo', 'locked', 'locked']);
    expect(rows.map((r) => r.reachable)).toEqual([true, true, true, false, false]);
    expect(rows.find((r) => r.current)!.key).toBe('business');
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it('done and skipped count as done; the next step becomes current', () => {
    const s = st({ nextStep: 'connect', steps: { business: { status: 'done' }, number: { status: 'skipped' } } });
    expect(statusesOf(s)).toEqual(['done', 'done', 'current', 'locked', 'locked']);
  });

  it('after Step 3: steps 4 and 5 open; the prompts belong to step 4 (current while customers/products are next)', () => {
    const s = st({ nextStep: 'customers', steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } } });
    expect(statusesOf(s)).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(checklistRows(s).find((r) => r.current)!.key).toBe('approvals');
  });

  it('server statuses map to words: waiting, needs you, paused, checking', () => {
    const base = { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } };
    expect(checklistRows(st({ nextStep: 'approvals', steps: { ...base, approvals: { status: 'waiting' } } }))[3].status).toBe('waiting');
    expect(checklistRows(st({ nextStep: 'approvals', steps: { ...base, approvals: { status: 'needs_you' } } }))[3].status).toBe('needsYou');
    expect(checklistRows(st({ nextStep: 'approvals', steps: { ...base, approvals: { status: 'checking' } } }))[3].status).toBe('checking');
    expect(checklistRows(st({ nextStep: 'number', steps: { business: { status: 'done' }, number: { status: 'paused' } } }))[1].status).toBe('paused');
  });

  it('a paused number (state.number.paused) shows as paused and stays reachable', () => {
    const rows = checklistRows(st({ nextStep: 'number', number: { paused: true }, steps: { business: { status: 'done' } } }));
    expect(rows[1].status).toBe('paused');
    expect(rows[1].reachable).toBe(true);
  });

  it('a finished setup has no current row; unknown or missing data is neutral', () => {
    const done = { status: 'done' };
    const s = st({ view: 'done', nextStep: null, steps: { business: done, number: done, connect: done, approvals: done, promotion: done } });
    expect(statusesOf(s)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(checklistRows(s).some((r) => r.current)).toBe(false);
    expect(statusesOf({ enrolled: true })).toEqual(['current', 'todo', 'todo', 'locked', 'locked']);
    expect(statusesOf(null as unknown as OnbState)).toEqual(['current', 'todo', 'todo', 'locked', 'locked']);
  });

  it('a finished setup whose Step 4 is still open (waiting on Meta) keeps Step 4 as the current row', () => {
    const done = { status: 'done' };
    for (const approvals of [{ status: 'in_progress' }, { status: 'waiting' }, { status: 'needs_you' }, { status: 'todo' }]) {
      const s = st({ view: 'done', nextStep: null, steps: { business: done, number: done, connect: done, approvals, promotion: { status: 'skipped' } } });
      const rows = checklistRows(s);
      expect(rows.filter((r) => r.current).map((r) => r.key), approvals.status).toEqual(['approvals']);
      expect(rows.map((r) => r.reachable), approvals.status).toEqual([true, true, true, true, true]);
      expect(currentStepNumber(rows), approvals.status).toBe(4);
      expect(rows[3].status).not.toBe('done');
    }
  });

  it('a finished setup with only Step 5 open highlights Step 5; with everything done nothing is current', () => {
    const done = { status: 'done' };
    const s = st({ view: 'done', nextStep: null, steps: { business: done, number: done, connect: done, approvals: done, promotion: { status: 'todo' } } });
    expect(checklistRows(s).filter((r) => r.current).map((r) => r.key)).toEqual(['promotion']);
    expect(checklistRows({ ...s, steps: { ...s.steps, promotion: done } }).some((r) => r.current)).toBe(false);
  });

  it('an unfinished setup is unchanged: the server nextStep decides the current row', () => {
    const done = { status: 'done' };
    const s = st({ view: 'setup', nextStep: 'customers', steps: { business: done, number: done, connect: done, approvals: { status: 'in_progress' } } });
    expect(checklistRows(s).filter((r) => r.current).map((r) => r.key)).toEqual(['approvals']);
    const t2 = st({ view: 'setup', nextStep: 'promotion', steps: { business: done, number: done, connect: done, approvals: { status: 'in_progress' } } });
    expect(checklistRows(t2).filter((r) => r.current).map((r) => r.key)).toEqual(['promotion']);
  });

  it('currentStepNumber follows the current row (5 when everything is done)', () => {
    expect(currentStepNumber(checklistRows(st({ steps: {} })))).toBe(1);
    expect(currentStepNumber(checklistRows(st({ nextStep: 'connect', steps: { business: { status: 'done' }, number: { status: 'done' } } })))).toBe(3);
    const done = { status: 'done' };
    expect(currentStepNumber(checklistRows(st({ view: 'done', nextStep: null, steps: { business: done, number: done, connect: done, approvals: done, promotion: done } })))).toBe(5);
  });
});

describe('stepRedirect (the step guard, pure)', () => {
  const steps = (...done: string[]) => Object.fromEntries(done.map((k) => [k, { status: 'done' }]));
  it.each<[string, OnbState | null, 'business' | 'number' | 'connect' | 'approvals' | 'promotion', string | null]>([
    ['unknown state is let through', null, 'connect', null],
    ['not enrolled is let through (the parent guard handles it)', { enrolled: false }, 'connect', null],
    ['takeover goes to billing', st({ subscription: { state: 'none' } }), 'business', '/setup/billing'],
    ['pending goes to billing', st({ subscription: { state: 'pending' } }), 'number', '/setup/billing'],
    ['view billing goes to billing', st({ view: 'billing' }), 'business', '/setup/billing'],
    ['step 1 is always open', st({ steps: {} }), 'business', null],
    ['step 2 needs step 1', st({ steps: {}, nextStep: 'business' }), 'number', '/setup/business/name'],
    ['step 2 after step 1', st({ steps: steps('business'), nextStep: 'number' }), 'number', null],
    ['step 3 needs step 2', st({ steps: steps('business'), nextStep: 'number' }), 'connect', '/setup/number'],
    ['step 4 needs step 3', st({ steps: steps('business', 'number'), nextStep: 'connect' }), 'approvals', '/setup/connect'],
    ['step 5 after step 3', st({ steps: steps('business', 'number', 'connect'), nextStep: 'approvals' }), 'promotion', null],
    ['a state without steps is let through', st({ steps: undefined }), 'connect', null],
  ])('%s', (_n, state, step, expected) => {
    const landing = state ? (state.subscription?.state === 'active' ? ({ business: '/setup/business/name', number: '/setup/number', connect: '/setup/connect', approvals: '/setup/approvals' } as Record<string, string>)[String(state.nextStep)] ?? null : '/setup/billing') : null;
    expect(stepRedirect(state, step, `/setup/${step}`, landing)).toBe(expected);
  });

  it('never redirects to the page being opened (no loop on an inconsistent state)', () => {
    expect(stepRedirect(st({ steps: {}, nextStep: 'connect' }), 'connect', '/setup/connect', '/setup/connect')).toBeNull();
    expect(stepRedirect(st({ steps: {}, nextStep: 'connect' }), 'connect', '/setup/connect?x=1', '/setup/connect')).toBeNull();
  });

  it('falls back to /dashboard when there is no landing URL', () => {
    expect(stepRedirect(st({ steps: {} }), 'connect', '/setup/connect', null)).toBe('/dashboard');
  });
});

describe('SETUP_ROUTES', () => {
  it('declares every screen of DF 2.1 under one shell with a catch-all', () => {
    const shell = SETUP_ROUTES[0];
    expect(shell.component).toBe(OnbSetupShell);
    const flat: string[] = [];
    const walk = (rs: typeof SETUP_ROUTES, prefix: string): void => {
      for (const r of rs) {
        const p = [prefix, r.path].filter(Boolean).join('/');
        if (r.children) walk(r.children, p);
        else flat.push(p);
      }
    };
    walk(shell.children!, '');
    for (const p of [
      '', 'billing', 'business', 'business/name', 'business/industry', 'business/links', 'business/cr', 'number', 'number/not-sure', 'number/where',
      'number/personal', 'number/business-app', 'number/migrate', 'number/landline', 'number/get-one', 'number/help', 'number/paused', 'connect',
      'connect/no-facebook', 'approvals', 'customers', 'customers/upload', 'customers/paste', 'customers/one', 'customers/optin', 'customers/preview',
      'customers/result', 'products', 'promotion', 'promotion/test', 'done', 'notifications', '**',
    ]) expect(flat, p).toContain(p);
  });
});

interface Rig { state: OnbStateService; router: Router; api: Record<string, ReturnType<typeof vi.fn>>; session$: BehaviorSubject<unknown> }

function rig(initial: OnbState | null, query: Record<string, string> = {}): Rig {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  failCatalog = false;
  const session$ = new BehaviorSubject<unknown>({ role: 'owner', user: { name: 'Sara', phone: '+966501234567', email: 'sara@example.com' }, workspace: { name: '+966501234567 Workspace' } });
  const api = {
    getState: vi.fn(() => new Subject<OnbState>()),
    preferences: vi.fn(() => of({})),
    promptDone: vi.fn(() => of({})),
    notifications: vi.fn(() => of([])),
    helpContext: vi.fn(() => of({})),
    event: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'dashboard', component: Blank }, { path: 'setup', component: Blank },
        { path: 'setup/billing', component: Blank }, { path: 'setup/connect', component: Blank }, { path: 'setup/business/name', component: Blank },
        { path: 'setup/approvals', component: Blank }, { path: 'setup/customers', component: Blank }, { path: 'setup/products', component: Blank },
      ]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  if (initial) state.state.set(initial);
  return { state, router: TestBed.inject(Router), api, session$ };
}

describe('OnbResume (/setup index and the Stripe return)', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('an active merchant goes to the landing step without any extra request', async () => {
    const r = rig(st({ nextStep: 'connect' }));
    const reload = vi.spyOn(r.state, 'reloadNow');
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith('/setup/connect', { replaceUrl: true }));
    expect(reload).not.toHaveBeenCalled();
  });

  it('a finished merchant goes to the dashboard', async () => {
    const r = rig(st({ view: 'done', nextStep: null }));
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith('/dashboard', { replaceUrl: true }));
  });

  it('?checkout=return re-reads the state from the server first; still pending -> billing with the same marker (a redirect is never proof)', async () => {
    const r = rig(st({ subscription: { state: 'pending' }, view: 'billing' }), { checkout: 'return' });
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(r.state.state());
    const nav = vi.spyOn(r.router, 'navigate');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav).toHaveBeenCalled());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(['/setup/billing'], { queryParams: { checkout: 'return' }, replaceUrl: true });
  });

  it('?checkout=return and the server already says active: straight to the landing step', async () => {
    const r = rig(st({ subscription: { state: 'pending' }, view: 'billing' }), { checkout: 'return' });
    vi.spyOn(r.state, 'reloadNow').mockImplementation(async () => {
      r.state.state.set(st({ nextStep: 'business' }));
      return r.state.state();
    });
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith('/setup/business/name', { replaceUrl: true }));
  });

  it('?checkout=cancel while unpaid keeps the marker; an unknown marker is ignored', async () => {
    const r = rig(st({ subscription: { state: 'none' }, view: 'billing' }), { checkout: 'cancel' });
    vi.spyOn(r.state, 'reloadNow').mockResolvedValue(r.state.state());
    const nav = vi.spyOn(r.router, 'navigate');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith(['/setup/billing'], { queryParams: { checkout: 'cancel' }, replaceUrl: true }));
    TestBed.resetTestingModule();
    const r2 = rig(st({ subscription: { state: 'none' }, view: 'billing' }), { checkout: 'evil' });
    vi.spyOn(r2.state, 'reloadNow').mockResolvedValue(r2.state.state());
    const nav2 = vi.spyOn(r2.router, 'navigateByUrl');
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(nav2).toHaveBeenCalledWith('/setup/billing', { replaceUrl: true }));
  });

  it('a past_due merchant coming back from the billing portal also reloads the state', async () => {
    const r = rig(st({ subscription: { state: 'past_due' }, nextStep: 'connect' }));
    const reload = vi.spyOn(r.state, 'reloadNow').mockResolvedValue(r.state.state());
    TestBed.createComponent(OnbResume).detectChanges();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe('OnbEntry (/onboarding shadow)', () => {
  it('goes to the landing URL and marks the shadow route active while it is on screen', async () => {
    const r = rig(st({ nextStep: 'connect' }));
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    const f = TestBed.createComponent(OnbEntry);
    f.detectChanges();
    expect(r.state.shadowActive).toBe(true);
    expect(nav).toHaveBeenCalledWith('/setup/connect', { replaceUrl: true });
    f.destroy();
    expect(r.state.shadowActive).toBe(false);
  });

  it('a finished merchant is sent to /dashboard', () => {
    const r = rig(st({ view: 'done', nextStep: null }));
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    TestBed.createComponent(OnbEntry).detectChanges();
    expect(nav).toHaveBeenCalledWith('/dashboard', { replaceUrl: true });
  });
});

describe('OnbChecklist component', () => {
  it('renders the five steps with a status word, links to reachable steps only and marks the current one', async () => {
    const r = rig(st({ nextStep: 'connect', steps: { business: { status: 'done' }, number: { status: 'done' } } }));
    await TestBed.inject(I18nService).init();
    const f = TestBed.createComponent(OnbChecklist);
    f.componentRef.setInput('showAction', true);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const items = Array.from(el.querySelectorAll('li.onb-step'));
    expect(items).toHaveLength(5);
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(items[0].textContent).toContain('[onboarding.stepstatus.done]');
    expect(items[3].textContent).toContain('[onboarding.stepstatus.locked]');
    expect(items[3].querySelector('a')).toBeNull(); // locked: no link
    expect(items[2].querySelector('a.onb-step-name')!.getAttribute('href')).toBe('/setup/connect');
    expect(el.querySelectorAll('.onb-step-cta')).toHaveLength(1);
    void r;
  });
});

describe('OnbHome', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());
  const connected = (over: Partial<OnbState> = {}): OnbState =>
    st({ nextStep: 'customers', business: { name: 'Sara Bakery' }, steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } }, prompts: { customers: { state: 'pending' }, products: { state: 'pending' } }, ...over });

  async function home(state: OnbState) {
    const r = rig(state);
    await TestBed.inject(I18nService).init();
    const f = TestBed.createComponent(OnbHome);
    f.detectChanges();
    return { r, f, el: f.nativeElement as HTMLElement };
  }

  it('welcomes the merchant by BUSINESS name; falls back to the user name; never the workspace name', async () => {
    const a = await home(connected());
    expect(a.el.querySelector('h1')!.textContent).toContain('[onboarding.home.welcome]');
    expect(a.r.state.state()!.business!.name).toBe('Sara Bakery');
    const comp = a.f.componentInstance as unknown as { name(): string | null };
    expect(comp.name()).toBe('Sara Bakery');
    TestBed.resetTestingModule();
    const b = await home(connected({ business: null }));
    expect((b.f.componentInstance as unknown as { name(): string | null }).name()).toBe('Sara');
    expect(b.el.textContent).not.toContain('Workspace');
    TestBed.resetTestingModule();
    const c = await home(connected({ business: null }));
    c.r.session$.next(null);
    const compC = TestBed.createComponent(OnbHome);
    compC.detectChanges();
    expect(compC.nativeElement.querySelector('h1').textContent).toContain('[onboarding.title]');
  });

  it('"The rest of WaFlow is visible but locked" shows only while the app is locked, never after Step 3 unlocked it', async () => {
    const locked = await home(connected({ locked: true }));
    expect(locked.el.querySelector('[data-lock-note]')!.textContent).toContain('[onboarding.home.locked]');
    TestBed.resetTestingModule();
    const unlocked = await home(connected({ locked: false }));
    expect(unlocked.el.querySelector('[data-lock-note]')).toBeNull();
    expect(unlocked.el.textContent).not.toContain('[onboarding.home.locked]');
    TestBed.resetTestingModule();
    const unknown = await home(connected());
    expect(unknown.el.textContent).not.toContain('[onboarding.home.locked]');
    TestBed.resetTestingModule();
    const early = await home(st({ nextStep: 'connect', locked: true, steps: { business: { status: 'done' }, number: { status: 'done' } } }));
    expect(early.el.querySelector('[data-lock-note]')).not.toBeNull();
  });

  it('the two cards appear only once Step 3 is done', async () => {
    const before = await home(st({ nextStep: 'connect', steps: { business: { status: 'done' }, number: { status: 'done' } } }));
    expect(before.el.querySelectorAll('.onb-card')).toHaveLength(0);
    TestBed.resetTestingModule();
    const after = await home(connected());
    expect(after.el.querySelectorAll('.onb-card')).toHaveLength(2);
    expect(after.el.textContent).toContain('[onboarding.home.card.customers.cta]');
    expect(after.el.textContent).toContain('[onboarding.home.card.products.cta]');
  });

  it('pending / skipped / done cards: Skip only while pending; the reminder while skipped; the count when done', async () => {
    const h = await home(connected({ prompts: { customers: { state: 'skipped' }, products: { state: 'done' }, counts: { customers: 0, products: 2, services: 1 } } }));
    const cards = Array.from(h.el.querySelectorAll('.onb-card'));
    expect(cards[0].textContent).toContain('[onboarding.home.reminder.customers]');
    expect(cards[0].querySelector('button.onb-link')).toBeNull();
    expect(cards[1].textContent).toContain('[onboarding.home.count.products]');
    expect(cards[1].querySelector('a.onb-btn')).toBeNull();
    TestBed.resetTestingModule();
    const p = await home(connected());
    expect(p.el.querySelectorAll('.onb-card button.onb-link')).toHaveLength(2);
  });

  it('Skip for now records "skipped" on the server and updates the card at once', async () => {
    const h = await home(connected());
    (h.el.querySelector('.onb-card button.onb-link') as HTMLButtonElement).click();
    h.f.detectChanges();
    expect(h.r.api['promptDone']).toHaveBeenCalledWith('customers', 'skipped');
    expect(h.r.state.state()!.prompts!.customers!.state).toBe('skipped');
    expect(h.r.state.state()!.prompts!.products!.state).toBe('pending');
  });
});

describe('OnbDashboardHost', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  async function host(state: OnbState) {
    TestBed.overrideComponent(OnbDashboardHost, { remove: { imports: [Dashboard] }, add: { imports: [StubDashboard] } });
    const r = rig(state);
    await TestBed.inject(I18nService).init();
    const f = TestBed.createComponent(OnbDashboardHost);
    f.detectChanges();
    return { r, f, el: f.nativeElement as HTMLElement };
  }

  it('takeover (none/pending): the billing screen only', async () => {
    const h = await host({ enrolled: true, view: 'billing', subscription: { state: 'pending' } });
    expect(h.el.querySelector('app-onb-billing')).toBeTruthy();
    expect(h.el.querySelector('app-onb-home')).toBeNull();
    expect(h.el.querySelector('.stub-dashboard')).toBeNull();
  });

  it('unfinished setup: the checklist home only', async () => {
    const h = await host(st());
    expect(h.el.querySelector('app-onb-home')).toBeTruthy();
    expect(h.el.querySelector('app-onb-billing')).toBeNull();
    expect(h.el.querySelector('.stub-dashboard')).toBeNull();
  });

  it('finished with a skipped prompt: reminder above the EXISTING dashboard, which is embedded unchanged', async () => {
    const h = await host(st({ view: 'done', nextStep: null, prompts: { customers: { state: 'skipped' }, products: { state: 'done' } } }));
    expect(h.el.querySelectorAll('.onb-reminders .onb-alert')).toHaveLength(1);
    expect(h.el.querySelector('.onb-reminders')!.textContent).toContain('[onboarding.home.reminder.customers]');
    expect(h.el.querySelector('.stub-dashboard')).toBeTruthy();
    // the dashboard is outside the onboarding wrapper: it keeps its own (English/LTR) context
    expect(h.el.querySelector('.stub-dashboard')!.closest('.onb')).toBeNull();
  });

  it('marks the shadow route active while on screen and releases it on destroy', async () => {
    const h = await host(st());
    expect(h.r.state.shadowActive).toBe(true);
    h.f.destroy();
    expect(h.r.state.shadowActive).toBe(false);
  });

  it('wraps onboarding content with lang and dir of the UI language', async () => {
    const h = await host(st());
    const root = h.el.querySelector('.onb')!;
    expect(root.getAttribute('lang')).toBe('en');
    expect(root.getAttribute('dir')).toBe('ltr');
  });
});

describe('OnbSetupShell', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  const connected = (): OnbState => st({ nextStep: 'approvals', connection: { level: 'connected' }, notifications: { unread: 2 }, steps: { business: { status: 'done' }, number: { status: 'done' }, connect: { status: 'done' } } });

  async function shell(state: OnbState, query: Record<string, string> = {}) {
    const r = rig(state, query);
    const f = TestBed.createComponent(OnbSetupShell);
    f.detectChanges();
    await vi.waitFor(() => expect(TestBed.inject(I18nService).ready()).toBe(true));
    f.detectChanges();
    return { r, f, el: f.nativeElement as HTMLElement, i18n: TestBed.inject(I18nService) };
  }

  it('renders header, progress text, checklist, outlet, live region and the shared UI host', async () => {
    const { el } = await shell(connected());
    expect(el.querySelector('.onb-head-title')!.textContent).toContain('[onboarding.title]');
    expect(el.querySelector('.onb-progress-text')!.textContent).toContain('[onboarding.progress.label]');
    expect(el.querySelectorAll('li.onb-step')).toHaveLength(5);
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('app-loc-ui-host')).toBeTruthy();
    const live = el.querySelector('.onb-sr')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
    expect(el.querySelector('app-onb-status-pill')!.textContent).toContain('[onboarding.pill.connected]');
    expect(el.querySelector('.onb-head-count')!.textContent!.trim()).toBe('2');
  });

  it('finished setup with Step 4 still open: the progress bar and the list highlight Step 4 ("Step 4 of 5" is never shown with nothing current)', async () => {
    const done = { status: 'done' };
    const { el } = await shell(st({
      view: 'done', nextStep: null, connection: { level: 'connected' },
      steps: { business: done, number: done, connect: done, approvals: { status: 'in_progress' }, promotion: { status: 'skipped' } },
    }));
    const segments = Array.from(el.querySelectorAll('.onb-progress li')).map((li) => li.getAttribute('data-s'));
    expect(segments).toEqual(['done', 'done', 'done', 'current', 'done']);
    const items = Array.from(el.querySelectorAll('li.onb-step'));
    expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null]);
    expect(el.querySelector('.onb-progress-text')!.textContent).toContain('[onboarding.progress.label]');
    expect(el.querySelector('.onb-progress-text')!.textContent).toContain('[onboarding.step.approvals]');
  });

  it('a completely finished setup shows no current segment', async () => {
    const done = { status: 'done' };
    const { el } = await shell(st({ view: 'done', nextStep: null, steps: { business: done, number: done, connect: done, approvals: done, promotion: done } }));
    expect(Array.from(el.querySelectorAll('.onb-progress li')).map((li) => li.getAttribute('data-s'))).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(el.querySelector('li.onb-step[aria-current]')).toBeNull();
  });

  it('has page-level lang and dir (scoped to its own root)', async () => {
    const { el } = await shell(connected());
    const root = el.querySelector('.onb-root')!;
    expect(root.getAttribute('lang')).toBe('en');
    expect(root.getAttribute('dir')).toBe('ltr');
  });

  it('?lang=ar switches the UI language; the language button shows the OTHER language', async () => {
    const { el, i18n } = await shell(connected(), { lang: 'ar' });
    await vi.waitFor(() => expect(i18n.lang()).toBe('ar'));
    expect(el.querySelector('.onb-root')!.getAttribute('dir')).not.toBeNull();
    const btn = Array.from(el.querySelectorAll('.onb-head-tools button')).find((b) => b.getAttribute('lang'));
    expect(btn).toBeTruthy();
  });

  it('switching language stores the preference only when the subscription is active (gate A)', async () => {
    const a = await shell(connected());
    const btn = () => Array.from(a.el.querySelectorAll('.onb-head-tools button')).find((b) => b.getAttribute('lang')) as HTMLButtonElement;
    btn().click();
    await vi.waitFor(() => expect(a.i18n.lang()).toBe('ar'));
    expect(a.r.api['preferences']).toHaveBeenCalledWith({ uiLanguage: 'ar', languages: ['ar', 'en'] });
    TestBed.resetTestingModule();
    const b = await shell(st({ subscription: { state: 'past_due' } }));
    (Array.from(b.el.querySelectorAll('.onb-head-tools button')).find((x) => x.getAttribute('lang')) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(b.i18n.lang()).toBe('ar'));
    expect(b.r.api['preferences']).not.toHaveBeenCalled();
  });

  it('during the payment takeover there is no progress, no checklist and no steps toggle', async () => {
    const { el } = await shell({ enrolled: true, view: 'billing', subscription: { state: 'none' } });
    expect(el.querySelector('.onb-progress')).toBeNull();
    expect(el.querySelector('app-onb-checklist')).toBeNull();
    expect(el.querySelector('.onb-steps-toggle')).toBeNull();
  });

  it('the steps toggle opens and closes the checklist panel on a phone', async () => {
    const { f, el } = await shell(connected());
    const side = el.querySelector('.onb-side')!;
    expect(side.classList.contains('onb-side-open')).toBe(false);
    const toggle = el.querySelector('.onb-steps-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    f.detectChanges();
    expect(side.classList.contains('onb-side-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('the bell opens the notifications sheet', async () => {
    const { f, el } = await shell(connected());
    (el.querySelector('.onb-head-bell') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('app-onb-notifications [role="dialog"]')).toBeTruthy();
  });

  it('a catalogue that cannot be downloaded shows a bilingual retry message instead of raw keys', async () => {
    const r = rig(connected());
    failCatalog = true;
    const f = TestBed.createComponent(OnbSetupShell);
    f.detectChanges();
    await vi.waitFor(() => expect(f.componentInstance.textsFailed()).toBe(true));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('.onb-head')).toBeNull();
    failCatalog = false;
    void r;
    (el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(TestBed.inject(I18nService).ready()).toBe(true));
    f.detectChanges();
    expect(el.querySelector('.onb-head')).toBeTruthy();
  });
});
