import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injectable, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError, type Observable } from 'rxjs';
import type { MockInstance } from 'vitest';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { AuthService } from '../../../../shared/auth.service';
import { CONNECT_TIMING, ConnectScreen, connectOutcome, connectRecovery, isInAppBrowser, stateConnectionHint } from './connect';
import { ConnectNoFacebookScreen } from './connect-no-facebook';
import { FacebookSdkService, type FbLoginResponse } from '../../connect/facebook-sdk.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { OnbApiService } from '../../onb-api.service';
import { OnbStateService } from '../../onb-state.service';
import type { OnbConnectConfig, OnbState } from '../../onb.types';

vi.setConfig({ testTimeout: 30000 });

const WWW = 'https://www.facebook.com';
const CODE = 'CODE-LEAK-0123456789';
const IDS = { phone_number_id: '106540352242922', waba_id: '524126980791429', business_id: '2729063490586005' };

// The catalogue is a proxy that "has" every key (except the ones containing "bogus"); t() shows [key|param=value].
const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' && !k.includes('bogus') ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) =>
      typeof k === 'string' && !k.includes('bogus') ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined,
  });
@Injectable()
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
  override t(key: string, params?: TranslateParams): string {
    return params ? `[${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}]` : `[${key}]`;
  }
}
@Component({ template: '' }) class Blank {}

class FakeSdk {
  readonly status = signal<'idle' | 'loading' | 'ready' | 'blocked'>('ready');
  cb: ((r: FbLoginResponse) => void) | null = null;
  options: Record<string, unknown> | null = null;
  load = vi.fn((_cfg: unknown): Promise<void> => Promise.resolve());
  login = vi.fn((options: Record<string, unknown>, cb: (r: FbLoginResponse) => void): void => {
    this.options = options;
    this.cb = cb;
  });
}

const CFG = (over: Partial<OnbConnectConfig> = {}): OnbConnectConfig => ({
  enabled: true, appId: '1234567890', configId: 'cfg-1', graphVersion: 'v25.0', extras: {}, sdkLocale: 'en_US', attemptId: 'att-1', expiresInSec: 900, reconnect: null, ...over,
});
const httpErr = (status: number, code?: string): Observable<never> =>
  throwError(() => new HttpErrorResponse({ status, error: code ? { code } : null }));
const CONNECTED = { status: 'connected', connection: { numberMasked: '+966 5** *** 4567', numberFull: '+966501234567', verifiedName: "Sara's Cafe" } };

function makeApi() {
  return {
    getState: vi.fn(() => new Subject<OnbState>()),
    connectConfig: vi.fn((): Observable<OnbConnectConfig> => of(CFG())),
    reconnect: vi.fn((): Observable<OnbConnectConfig> => of(CFG({ reconnect: { expectedWabaId: IDS.waba_id } }))),
    connectEvent: vi.fn((_b: unknown): Observable<unknown> => of({ outcome: 'cancelled', code: 'CONNECT_CANCELLED' })),
    connectComplete: vi.fn((_b: unknown): Observable<unknown> => of(CONNECTED)),
    connectResume: vi.fn((): Observable<unknown> => of({ status: 'connecting' })),
    connection: vi.fn((): Observable<unknown> => of({ status: 'not_connected', level: 'not_connected' })),
    disconnectRequest: vi.fn((): Observable<unknown> => of({ confirmationToken: 'tok-1', expiresInSec: 300, impactKeys: ['sending', 'templates', 'number', 'bogus'] })),
    disconnect: vi.fn((_t: string): Observable<unknown> => of({})),
    event: vi.fn((_b: unknown): Observable<unknown> => of({})),
    helpContext: vi.fn((): Observable<unknown> => of({})),
    preferences: vi.fn((): Observable<unknown> => of({})),
    promptDone: vi.fn((): Observable<unknown> => of({})),
    notifications: vi.fn((): Observable<unknown> => of([])),
  };
}
type Api = ReturnType<typeof makeApi>;

const ACTIVE: OnbState = { enrolled: true, view: 'setup', subscription: { state: 'active' }, nextStep: 'connect', steps: { connect: { status: 'todo' } } };

interface Rig {
  fixture: ComponentFixture<ConnectScreen>;
  cmp: ConnectScreen;
  api: Api;
  sdk: FakeSdk;
  state: OnbStateService;
  router: Router;
  el: HTMLElement;
  session$: BehaviorSubject<unknown>;
  flush(ms?: number): Promise<void>;
}

async function mount(opts: { role?: 'owner' | 'member'; query?: Record<string, string>; state?: OnbState; api?: Partial<Api>; sdk?: Partial<FakeSdk> } = {}): Promise<Rig> {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const api = { ...makeApi(), ...(opts.api ?? {}) } as Api;
  const sdk = Object.assign(new FakeSdk(), opts.sdk ?? {});
  const session$ = new BehaviorSubject<unknown>({ role: opts.role ?? 'owner', user: { name: 'Sara' }, workspace: { name: 'W' } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'dashboard', component: Blank }, { path: 'setup/customers', component: Blank }, { path: 'setup/approvals', component: Blank },
        { path: 'setup/number', component: Blank }, { path: 'setup/number/migrate', component: Blank }, { path: 'setup/connect', component: Blank },
        { path: 'setup/connect/no-facebook', component: Blank }, { path: 'setup/billing', component: Blank }, { path: 'setup/products', component: Blank },
        { path: 'legal-acceptance', component: Blank }, { path: 'setup/business/cr', component: Blank },
      ]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: api },
      { provide: FacebookSdkService, useValue: sdk },
      { provide: AuthService, useValue: { session: session$.asObservable(), get sessionSnapshot() { return session$.value; }, isLoggedIn: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.query ?? {}) } } },
    ],
  });
  const state = TestBed.inject(OnbStateService);
  // a test that scripts GET /connection for a LATER step (poll, verify after a lost answer) starts from a state that names no partial run
  state.state.set(opts.state ?? (opts.api?.connection ? { ...ACTIVE, connection: { level: null, status: 'not_connected' } } : ACTIVE));
  state.loaded.set(true);
  vi.spyOn(state, 'reloadNow').mockResolvedValue(null);
  await TestBed.inject(I18nService).init();
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ConnectScreen);
  const el = fixture.nativeElement as HTMLElement;
  const rig: Rig = {
    fixture, cmp: fixture.componentInstance, api, sdk, state, router, el, session$,
    async flush(ms = 0) {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    },
  };
  fixture.detectChanges();
  await rig.flush();
  return rig;
}

const q = (r: Rig, sel: string): HTMLElement | null => r.el.querySelector<HTMLElement>(sel);
const txt = (r: Rig, sel: string): string => (q(r, sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const primary = (r: Rig): HTMLElement | null => q(r, '.onb-bar .onb-btn-primary');
const send = (event: string, data: Record<string, unknown> | undefined, origin = WWW): void => {
  window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, ...(data ? { data } : {}) }) }));
};
const click = (r: Rig): void => (primary(r) as HTMLButtonElement).click();

async function clickFinishThenCode(r: Rig, code = CODE): Promise<void> {
  click(r);
  send('FINISH', IDS);
  r.sdk.cb!({ authResponse: { code } });
  await r.flush();
}

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

describe('ConnectScreen: loading and the ready state', () => {
  it('fetches the config, loads the SDK with the config and shows the connect button (owner)', async () => {
    const r = await mount();
    expect(r.api.connectConfig).toHaveBeenCalledTimes(1);
    expect(r.api.reconnect).not.toHaveBeenCalled();
    expect(r.sdk.load).toHaveBeenCalledWith({ appId: '1234567890', graphVersion: 'v25.0', sdkLocale: 'en_US' });
    expect(txt(r, 'h1')).toBe('[onboarding.connect.title]');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.cta]');
    expect(txt(r, '.onb-lead')).toBe('[onboarding.connect.note]');
    expect(r.cmp.phase()).toBe('ready');
  });

  it('shows a preparing state (disabled button, status role) until the SDK is ready', async () => {
    let done!: () => void;
    const r = await mount({ sdk: { load: vi.fn(() => new Promise<void>((res) => (done = res))) } });
    expect(r.cmp.phase()).toBe('loading');
    expect((primary(r) as HTMLButtonElement).disabled).toBe(true);
    expect(q(r, '[role="status"]')).not.toBeNull();
    done();
    await r.flush();
    expect(r.cmp.phase()).toBe('ready');
  });

  it('a member never loads the SDK or asks for a config and sees "ask the account owner"', async () => {
    const r = await mount({ role: 'member' });
    expect(r.api.connectConfig).not.toHaveBeenCalled();
    expect(r.sdk.load).not.toHaveBeenCalled();
    expect(r.cmp.phase()).toBe('member');
    expect(r.el.textContent).toContain('[onboarding.strip.askOwner]');
    expect(primary(r)).toBeNull();
  });

  it('a member is treated as owner-less until the session says otherwise (unknown session = no connect button)', async () => {
    const r = await mount({ role: 'member' });
    r.session$.next({ role: 'owner', user: { name: 'Sara' } });
    await r.flush();
    await r.flush();
    expect(r.cmp.phase()).toBe('ready');
    expect(r.api.connectConfig).toHaveBeenCalledTimes(1);
  });

  it('the no-Facebook link and the help button are present; the help button opens the sheet', async () => {
    const r = await mount();
    expect(txt(r, '.onb-bar-links')).toContain('[onboarding.connect.noFb]');
    expect(q(r, 'app-onb-help')).not.toBeNull();
  });

  it('coexistence and landline hints come from the number answers', async () => {
    const co = await mount({ state: { ...ACTIVE, number: { businessAppChoice: 'coexistence' } } });
    expect(co.el.textContent).toContain('[onboarding.connect.appSteps]');
    expect(co.el.textContent).not.toContain('[onboarding.connect.landlineHint]');
    TestBed.resetTestingModule();
    const ll = await mount({ state: { ...ACTIVE, number: { usage: 'landline' } } });
    expect(ll.el.textContent).toContain('[onboarding.connect.landlineHint]');
    expect(ll.el.textContent).not.toContain('[onboarding.connect.appSteps]');
  });

  it('an in-app browser gets a notice with a copy-link button and one step_fail event', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit/605 [FBAN/FBIOS;FBAV/430.0]');
    const r = await mount();
    expect(r.el.textContent).toContain('[onboarding.connect.inapp]');
    expect(r.el.textContent).toContain('[onboarding.common.copyLink]');
    expect(r.api.event.mock.calls.map((c) => (c[0] as { type: string; code?: string }))).toContainEqual({ type: 'step_fail', step: 'connect', code: 'ONB_IN_APP_BROWSER' });
    // the merchant can still try
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.cta]');
  });

  it('a normal browser shows no in-app notice', async () => {
    const r = await mount();
    expect(r.el.textContent).not.toContain('[onboarding.connect.inapp]');
  });
});

describe('ConnectScreen: the click opens the popup synchronously', () => {
  it('calls FB.login in the same tick as the click, with the options of the config, before anything else happens', async () => {
    const r = await mount();
    const before = r.api.event.mock.calls.length;
    click(r);
    // no await: a popup blocker would block anything that runs after a microtask
    expect(r.sdk.login).toHaveBeenCalledTimes(1);
    expect(r.sdk.options).toEqual({ config_id: 'cfg-1', response_type: 'code', override_default_response_type: true, extras: {} });
    expect(r.api.connectEvent).not.toHaveBeenCalled();
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    expect(r.api.event.mock.calls.length).toBe(before);
    expect(r.cmp.phase()).toBe('popup');
  });

  it('a double click (button or method) opens one popup only', async () => {
    const r = await mount();
    click(r);
    r.cmp.connect();
    r.cmp.connect();
    expect(r.sdk.login).toHaveBeenCalledTimes(1);
    await r.flush();
    expect(r.sdk.login).toHaveBeenCalledTimes(1);
  });

  it('while the popup is open the screen says so and offers "window closed? try again"', async () => {
    const r = await mount();
    click(r);
    await r.flush();
    expect(txt(r, 'h1')).toBe('[onboarding.connect.waiting.title]');
    expect(r.el.textContent).toContain('[onboarding.connect.waiting.body]');
    expect(txt(r, '.onb-bar-links')).toContain('[onboarding.connect.waiting.reopen]');
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.connect.waiting.title]');
  });

  it('"window closed? try again" lets the merchant click again and ignores the old popup late callback', async () => {
    const r = await mount();
    click(r);
    const oldCb = r.sdk.cb!;
    await r.flush();
    (r.el.querySelector('.onb-bar-links .onb-link') as HTMLButtonElement).click();
    await r.flush();
    expect(r.cmp.phase()).toBe('ready');
    click(r);
    expect(r.sdk.login).toHaveBeenCalledTimes(2);
    oldCb({ authResponse: { code: 'STALE-CODE' } });
    await r.flush(CONNECT_TIMING.signalWaitMs + 100);
    expect(r.api.connectComplete).not.toHaveBeenCalled();
  });

  it('a login() that throws (SDK not ready after all) becomes the ONB_SDK_BLOCKED failure', async () => {
    const r = await mount();
    r.sdk.login.mockImplementation(() => {
      throw Object.assign(new Error('ONB_SDK_BLOCKED'), { code: 'ONB_SDK_BLOCKED' });
    });
    click(r);
    await r.flush();
    expect(r.cmp.phase()).toBe('failure');
    expect(r.cmp.errorCode()).toBe('ONB_SDK_BLOCKED');
  });
});

describe('ConnectScreen: orderings of the code and the finish message', () => {
  it('finish message, then code: the POST leaves at once with the session ids', async () => {
    const r = await mount();
    click(r);
    send('FINISH', IDS);
    r.sdk.cb!({ authResponse: { code: CODE } });
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1); // synchronously, no timer needed
    expect(r.api.connectComplete.mock.calls[0][0]).toEqual({
      attemptId: 'att-1', code: CODE,
      session: { event: 'FINISH', phone_number_id: IDS.phone_number_id, waba_id: IDS.waba_id, business_id: IDS.business_id },
    });
  });

  it('code, then finish message: waits for the message (up to 1.5 s) and posts as soon as it arrives', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } });
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    await r.flush(500);
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    send('FINISH', IDS);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect((r.api.connectComplete.mock.calls[0][0] as { session: { waba_id: string } }).session.waba_id).toBe(IDS.waba_id);
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1); // the wait timer was cancelled
  });

  it('code without any message: posts after 1.5 s with an empty session (the server falls back to the token)', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } });
    await r.flush(CONNECT_TIMING.signalWaitMs - 1);
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    await r.flush(1);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.api.connectComplete.mock.calls[0][0]).toEqual({ attemptId: 'att-1', code: CODE, session: {} });
  });

  it('a message from a look-alike origin is ignored: the session stays empty', async () => {
    const r = await mount();
    click(r);
    send('FINISH', IDS, 'https://facebook.com.evil.test');
    send('FINISH', IDS, 'http://facebook.com');
    r.sdk.cb!({ authResponse: { code: CODE } });
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect((r.api.connectComplete.mock.calls[0][0] as { session: unknown }).session).toEqual({});
  });

  it('a finish message that arrives before any click is ignored (stale or foreign)', async () => {
    const r = await mount();
    send('FINISH', IDS);
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } });
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect((r.api.connectComplete.mock.calls[0][0] as { session: unknown }).session).toEqual({});
  });

  it('shows the finishing state while the request runs', async () => {
    const complete$ = new Subject<unknown>();
    const r = await mount({ api: { connectComplete: vi.fn(() => complete$) } });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('finishing');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.finishing.title]');
    expect(q(r, '[role="status"]')).not.toBeNull();
    complete$.next(CONNECTED);
    complete$.complete();
    await r.flush();
    expect(r.cmp.phase()).toBe('success');
  });
});

describe('ConnectScreen: the code never leaks', () => {
  it('goes only to POST /connect/complete: not to logs, other requests, storage, the URL or the DOM, and is cleared from memory', async () => {
    const r = await mount();
    await clickFinishThenCode(r);
    await r.flush(CONNECT_TIMING.signalWaitMs * 2);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.api.connectComplete.mock.calls)).toContain(CODE);
    for (const [name, fn] of Object.entries(r.api)) {
      if (name === 'connectComplete') continue;
      expect(JSON.stringify(fn.mock.calls), name).not.toContain(CODE);
    }
    expect(JSON.stringify(consoleSpies.map((s) => s.mock.calls))).not.toContain(CODE);
    expect(JSON.stringify({ ...localStorage })).not.toContain(CODE);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(CODE);
    expect(window.location.href).not.toContain(CODE);
    expect(JSON.stringify((r.router.navigateByUrl as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(CODE);
    expect(document.body.innerHTML).not.toContain(CODE);
    expect((r.cmp as unknown as { code: string | null }).code).toBeNull();
    expect((r.cmp as unknown as { lastBody: unknown }).lastBody).toBeNull();
  });

  it('is not logged or kept on a failed POST either', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(422, 'CONNECT_CODE_INVALID_OR_EXPIRED')) } });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('failure');
    expect(JSON.stringify(consoleSpies.map((s) => s.mock.calls))).not.toContain(CODE);
    expect((r.cmp as unknown as { code: string | null }).code).toBeNull();
    expect((r.cmp as unknown as { lastBody: unknown }).lastBody).toBeNull();
    expect(document.body.innerHTML).not.toContain(CODE);
    for (const [name, fn] of Object.entries(r.api)) {
      if (name !== 'connectComplete') expect(JSON.stringify(fn.mock.calls), name).not.toContain(CODE);
    }
  });

  it('step_fail analytics never carry the code (a slow hand-off)', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } });
    vi.setSystemTime(Date.now() + CONNECT_TIMING.codeTtlMs + 1000);
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect(JSON.stringify(r.api.event.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(r.api.event.mock.calls)).toContain('ONB_CODE_HANDOFF_SLOW');
  });
});

describe('ConnectScreen: no code (cancel, error, blocked)', () => {
  it('a callback without a code in under 700 ms and without any message = pop-ups blocked (a notice, a step_fail event, no request to /connect/event)', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ status: 'unknown' });
    await r.flush();
    expect(r.cmp.phase()).toBe('ready');
    expect(r.el.textContent).toContain('[onboarding.errors.ONB_POPUP_BLOCKED]');
    expect(r.api.connectEvent).not.toHaveBeenCalled();
    expect(r.api.event.mock.calls.map((c) => c[0])).toContainEqual({ type: 'step_fail', step: 'connect', code: 'ONB_POPUP_BLOCKED' });
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.cta]');
  });

  it('exactly 700 ms is no longer "blocked": it is a cancel', async () => {
    const r = await mount();
    click(r);
    await r.flush(CONNECT_TIMING.popupBlockedMs);
    r.sdk.cb!({ status: 'unknown' });
    await r.flush(CONNECT_TIMING.noCodeGraceMs);
    expect(r.api.connectEvent).toHaveBeenCalledTimes(1);
    expect(r.el.textContent).not.toContain('ONB_POPUP_BLOCKED');
  });

  it('a plain close after 700 ms or more waits 300 ms for a late message, then reports CANCEL and shows the info notice (not an error)', async () => {
    const r = await mount();
    click(r);
    await r.flush(900);
    r.sdk.cb!({ status: 'unknown' });
    expect(r.api.connectEvent).not.toHaveBeenCalled();
    await r.flush(CONNECT_TIMING.noCodeGraceMs);
    expect(r.api.connectEvent).toHaveBeenCalledTimes(1);
    expect(r.api.connectEvent.mock.calls[0][0]).toEqual({ attemptId: 'att-1', event: 'CANCEL' });
    expect(r.cmp.phase()).toBe('ready');
    const alert = q(r, '.onb-alert-info[role="status"]');
    expect(alert?.textContent).toContain('[onboarding.errors.CONNECT_CANCELLED]');
    expect(q(r, '.onb-alert-error')).toBeNull();
  });

  it('a CANCEL message with its step, seen before the callback, is reported right away', async () => {
    const r = await mount();
    click(r);
    await r.flush(900);
    send('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' });
    r.sdk.cb!({});
    expect(r.api.connectEvent).toHaveBeenCalledTimes(1);
    expect(r.api.connectEvent.mock.calls[0][0]).toEqual({ attemptId: 'att-1', event: 'CANCEL', currentStep: 'PHONE_NUMBER_SETUP' });
  });

  it('a popup error that arrives a moment after the callback explains why (reported as ERROR with its code and text)', async () => {
    const r = await mount({ api: { connectEvent: vi.fn(() => of({ outcome: 'failed', code: 'CONNECT_VERIFICATION_FAILED', nextStep: 'connect' })) } });
    click(r);
    await r.flush(900);
    r.sdk.cb!({});
    await r.flush(100);
    send('CANCEL', { error_message: 'Could not send the code', error_code: 2388091, session_id: 'abc' });
    expect(r.api.connectEvent).toHaveBeenCalledTimes(1);
    expect(r.api.connectEvent.mock.calls[0][0]).toEqual({ attemptId: 'att-1', event: 'ERROR', errorCode: '2388091', errorMessage: 'Could not send the code' });
    await r.flush();
    expect(r.cmp.phase()).toBe('failure');
    expect(txt(r, '[role="alert"]')).toContain('[onboarding.errors.CONNECT_VERIFICATION_FAILED]');
    // "reopen the window": a fresh attempt
    (primary(r) as HTMLButtonElement).click();
    await r.flush();
    expect(r.api.connectConfig).toHaveBeenCalledTimes(2);
    expect(r.cmp.phase()).toBe('ready');
  });

  it('the server naming the number as registered elsewhere sends the merchant back to Step 2 (and keeps a quiet "try again")', async () => {
    const r = await mount({ api: { connectEvent: vi.fn(() => of({ outcome: 'failed', code: 'CONNECT_NUMBER_REGISTERED_ELSEWHERE', nextStep: 'number' })) } });
    click(r);
    send('CANCEL', { error_code: 3441030, error_message: 'registered' });
    r.sdk.cb!({});
    await r.flush();
    expect(txt(r, '[role="alert"]')).toContain('[onboarding.errors.CONNECT_NUMBER_REGISTERED_ELSEWHERE]');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.toNumber]');
    expect(r.el.querySelector('.onb-bar .onb-btn-secondary')?.textContent).toContain('[onboarding.common.tryAgain]');
    click(r);
    expect(r.router.navigateByUrl).toHaveBeenCalledWith('/setup/number');
  });

  it('the server answering "no Facebook account" opens the dedicated page', async () => {
    const r = await mount({ api: { connectEvent: vi.fn(() => of({ code: 'CONNECT_NO_FACEBOOK_ACCOUNT', nextStep: 'connect' })) } });
    click(r);
    await r.flush(900);
    r.sdk.cb!({});
    await r.flush(CONNECT_TIMING.noCodeGraceMs);
    expect(r.router.navigateByUrl).toHaveBeenCalledWith('/setup/connect/no-facebook');
  });

  it('"I don\'t have a Facebook account" reports NO_FACEBOOK (best effort) and opens the page', async () => {
    const r = await mount();
    (r.el.querySelector('.onb-bar-links .onb-link') as HTMLButtonElement).click();
    expect(r.api.connectEvent).toHaveBeenCalledWith({ attemptId: 'att-1', event: 'NO_FACEBOOK' });
    expect(r.router.navigateByUrl).toHaveBeenCalledWith('/setup/connect/no-facebook');
  });

  it('a failing /connect/event after a plain cancel is still just a cancel; after an error message it shows the mapped failure', async () => {
    const a = await mount({ api: { connectEvent: vi.fn(() => httpErr(0)) } });
    click(a);
    await a.flush(900);
    a.sdk.cb!({});
    await a.flush(CONNECT_TIMING.noCodeGraceMs);
    expect(a.cmp.phase()).toBe('ready');
    expect(a.el.textContent).toContain('[onboarding.errors.CONNECT_CANCELLED]');
    TestBed.resetTestingModule();

    const b = await mount({ api: { connectEvent: vi.fn(() => httpErr(0)) } });
    click(b);
    send('ERROR', { error_code: 99 });
    b.sdk.cb!({});
    await b.flush();
    expect(b.cmp.phase()).toBe('failure');
    expect(b.cmp.errorCode()).toBe('ONB_NETWORK');
  });

  it('a finish message with no code at all cannot be completed: "try once more"', async () => {
    const r = await mount();
    click(r);
    send('FINISH', IDS);
    r.sdk.cb!({});
    await r.flush();
    expect(r.cmp.errorCode()).toBe('CONNECT_CODE_INVALID_OR_EXPIRED');
    expect(r.api.connectComplete).not.toHaveBeenCalled();
  });

  it('120 s with neither a callback nor a message: back to ready with "still there?"; a late callback with a code is still honoured', async () => {
    const r = await mount();
    click(r);
    await r.flush(CONNECT_TIMING.watchdogMs);
    expect(r.cmp.phase()).toBe('ready');
    expect(r.el.textContent).toContain('[onboarding.connect.stillThere]');
    r.sdk.cb!({ authResponse: { code: CODE } });
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('success');
  });

  it('the watchdog is cancelled by the callback', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ status: 'unknown' });
    await r.flush(CONNECT_TIMING.watchdogMs * 2);
    expect(r.el.textContent).not.toContain('[onboarding.connect.stillThere]');
  });
});

describe('ConnectScreen: the 30-second code rule and network failures', () => {
  it('more than 25 s between the code and the POST discards the code: ONB_CODE_HANDOFF_SLOW, nothing is sent', async () => {
    const r = await mount();
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } });
    vi.setSystemTime(Date.now() + CONNECT_TIMING.codeTtlMs + 1);
    await r.flush(CONNECT_TIMING.signalWaitMs);
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    expect(r.cmp.errorCode()).toBe('ONB_CODE_HANDOFF_SLOW');
    expect(txt(r, '[role="alert"]')).toContain('[onboarding.errors.ONB_CODE_HANDOFF_SLOW]');
    expect(r.api.event.mock.calls.map((c) => c[0])).toContainEqual({ type: 'step_fail', step: 'connect', code: 'ONB_CODE_HANDOFF_SLOW' });
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.common.tryAgain]');
  });

  it('status 0 after the POST: asks GET /connection BEFORE any retry; connected -> success with no second POST', async () => {
    const r = await mount({
      api: { connectComplete: vi.fn(() => httpErr(0)), connection: vi.fn(() => of({ status: 'connected', level: 'connected' })) },
    });
    await clickFinishThenCode(r);
    await r.flush(5000);
    expect(r.api.connection).toHaveBeenCalledTimes(1);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('success');
  });

  it('status 0 and the connection is not there: one retry of the same POST after 1 s, then success', async () => {
    let n = 0;
    const r = await mount({
      api: {
        connectComplete: vi.fn(() => (++n === 1 ? httpErr(0) : of(CONNECTED))),
        connection: vi.fn(() => of({ level: 'not_connected' })),
      },
    });
    await clickFinishThenCode(r);
    expect(r.api.connection).toHaveBeenCalledTimes(1);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    await r.flush(CONNECT_TIMING.networkRetryMs - 1);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    await r.flush(1);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(2);
    expect(r.api.connectComplete.mock.calls[1][0]).toEqual(r.api.connectComplete.mock.calls[0][0]);
    expect(r.api.connection.mock.invocationCallOrder[0]).toBeGreaterThan(r.api.connectComplete.mock.invocationCallOrder[0]);
    expect(r.api.connection.mock.invocationCallOrder[0]).toBeLessThan(r.api.connectComplete.mock.invocationCallOrder[1]);
    expect(r.cmp.phase()).toBe('success');
  });

  it('status 0 twice and no connection: ONB_NETWORK with try again (and a 502 gateway answer behaves the same)', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(502)), connection: vi.fn(() => httpErr(0)) } });
    await clickFinishThenCode(r);
    await r.flush(CONNECT_TIMING.networkRetryMs);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(2);
    expect(r.cmp.errorCode()).toBe('ONB_NETWORK');
    expect(txt(r, '[role="alert"]')).toContain('[onboarding.errors.ONB_NETWORK]');
    expect((r.cmp as unknown as { lastBody: unknown }).lastBody).toBeNull();
  });

  it('no retry when the 25 s window of the code has passed', async () => {
    const complete$ = new Subject<unknown>();
    const r = await mount({ api: { connectComplete: vi.fn(() => complete$), connection: vi.fn(() => of({ level: 'not_connected' })) } });
    await clickFinishThenCode(r);
    vi.setSystemTime(Date.now() + CONNECT_TIMING.codeTtlMs + 1);
    complete$.error(new HttpErrorResponse({ status: 0 }));
    await r.flush(CONNECT_TIMING.networkRetryMs * 3);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.cmp.errorCode()).toBe('ONB_NETWORK');
  });

  it('an answer WITH a code (a real refusal) is shown as it is: no GET /connection, no retry', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(503, 'META_UNREACHABLE')) } });
    await clickFinishThenCode(r);
    await r.flush(CONNECT_TIMING.networkRetryMs * 3);
    expect(r.api.connection).toHaveBeenCalledTimes(1); // only the one read when the screen opened (nothing after the refusal)
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.cmp.errorCode()).toBe('META_UNREACHABLE');
  });
});

const FAILURE_CODES = [
  'CONNECT_NOT_CONFIGURED', 'ENCRYPTION_NOT_CONFIGURED', 'CONNECT_IN_PROGRESS', 'CONNECT_ATTEMPT_INVALID', 'CONNECT_CODE_INVALID_OR_EXPIRED',
  'CONNECT_WABA_MISMATCH', 'CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT', 'CONNECT_NUMBER_REGISTERED_ELSEWHERE', 'CONNECT_VERIFICATION_FAILED',
  'CONNECT_COEXISTENCE_UNAVAILABLE', 'CONNECT_REGISTER_RATE_LIMITED', 'CONNECT_AMBIGUOUS_WABA', 'META_UNREACHABLE', 'META_ERROR',
  'META_TOKEN_REVOKED', 'META_PERMISSION_MISSING', 'META_RATE_LIMITED', 'META_NOT_CONFIGURED', 'WHATSAPP_RECONNECT_REQUIRED',
  'LEGAL_ACCEPTANCE_REQUIRED', 'OWNER_ONLY', 'RATE_LIMITED', 'SUBSCRIPTION_REQUIRED', 'PAYMENT_PAST_DUE', 'PAYMENT_PENDING', 'SUBSCRIPTION_CANCELLED',
  'VALIDATION_FAILED', 'STEP_PREREQUISITE',
];

describe('ConnectScreen: every backend code renders its copy and its recovery action', () => {
  it.each(FAILURE_CODES)('%s', async (code) => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(409, code)) } });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('failure');
    expect(r.cmp.errorCode()).toBe(code);
    expect(txt(r, '[role="alert"]')).toContain(`[onboarding.errors.${code}]`);
    const rec = connectRecovery(code, true);
    if (rec) expect(txt(r, '.onb-bar .onb-btn-primary')).toBe(`[${rec.labelKey}]`);
    else expect(primary(r)).toBeNull();
    // "Need help?" is always reachable: as the primary action or as the link
    expect(q(r, 'app-onb-help') !== null || rec?.action === 'help').toBe(true);
  });

  it.each([
    ['CONNECT_IN_PROGRESS', 15], ['RATE_LIMITED', 30], ['META_RATE_LIMITED', 60],
  ])('%s: the retry button is disabled with a countdown of %d s', async (code, secs) => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(429, code)) } });
    await clickFinishThenCode(r);
    expect((primary(r) as HTMLButtonElement).disabled).toBe(true);
    expect(r.el.textContent).toContain(`[onboarding.common.waitSeconds|n=${secs}]`);
    await r.flush((secs - 1) * 1000);
    expect((primary(r) as HTMLButtonElement).disabled).toBe(true);
    await r.flush(1000);
    expect((primary(r) as HTMLButtonElement).disabled).toBe(false);
    click(r);
    await r.flush();
    expect(r.api.connectConfig).toHaveBeenCalledTimes(2);
  });

  it('the countdown is NOT a live region (no role="status", aria-live="off"); its start and its end are announced once each (R6-10)', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(429, 'RATE_LIMITED')) } });
    await clickFinishThenCode(r);
    const count = q(r, '[data-countdown]')!;
    expect(count.getAttribute('role')).toBeNull();
    expect(count.getAttribute('aria-live')).toBe('off');
    expect(count.closest('[role="status"], [aria-live="polite"], [aria-live="assertive"]')).toBeNull();
    const said = TestBed.inject(OnbAnnouncer);
    expect(said.message()).toContain('[onboarding.common.waitSeconds|n=30]'); // the start
    const start = said.message();
    await r.flush(20_000);
    expect(said.message()).toBe(start); // nothing is said while the number goes down
    expect(count.textContent).toContain('n=10');
    await r.flush(10_000);
    expect(said.message()).toContain('[onboarding.common.waitOver]'); // the end
    expect(q(r, '[data-countdown]')).toBeNull();
  });

  it('a failure without a wait announces no countdown at all', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(409, 'CONNECT_VERIFICATION_FAILED')) } });
    await clickFinishThenCode(r);
    expect(q(r, '[data-countdown]')).toBeNull();
    expect(TestBed.inject(OnbAnnouncer).message()).not.toContain('waitSeconds');
  });

  it('the recovery buttons do what they say', async () => {
    const go = async (code: string, url: string): Promise<void> => {
      const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(409, code)) } });
      await clickFinishThenCode(r);
      click(r);
      await r.flush();
      expect(r.router.navigateByUrl, code).toHaveBeenCalledWith(url);
      TestBed.resetTestingModule();
    };
    await go('CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT', '/setup/number');
    await go('CONNECT_COEXISTENCE_UNAVAILABLE', '/setup/number/migrate?reason=coexistence');
    await go('SUBSCRIPTION_REQUIRED', '/setup/billing');

    const legal = await mount({ api: { connectComplete: vi.fn(() => httpErr(403, 'LEGAL_ACCEPTANCE_REQUIRED')) } });
    await clickFinishThenCode(legal);
    click(legal);
    expect(legal.router.navigate).toHaveBeenCalledWith(['/legal-acceptance'], { queryParams: { returnUrl: '/setup/connect' } });
    TestBed.resetTestingModule();

    const rec = await mount({ api: { connectComplete: vi.fn(() => httpErr(409, 'META_TOKEN_REVOKED')) } });
    await clickFinishThenCode(rec);
    click(rec);
    await rec.flush();
    expect(rec.api.reconnect).toHaveBeenCalledTimes(1); // reconnect mode: the reconnect config
    expect(rec.el.textContent).toContain('[onboarding.connect.reconnect.body]');
  });

  it('a help-only failure makes "Need help?" the main button and opens the sheet', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(503, 'CONNECT_NOT_CONFIGURED')) } });
    await clickFinishThenCode(r);
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.help.cta]');
    expect(q(r, '.onb-bar-links app-onb-help')).toBeNull();
    click(r);
    expect(r.api.helpContext).toHaveBeenCalled();
  });

  it('the failure sets the help pre-fill code (so the help message carries it)', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => httpErr(409, 'CONNECT_VERIFICATION_FAILED')) } });
    await clickFinishThenCode(r);
    expect(TestBed.inject(OnbHelpService).lastError()).toBe('CONNECT_VERIFICATION_FAILED');
  });

  it('a member is not offered owner-only actions (WABA mismatch goes to help, reconnect goes to help)', () => {
    expect(connectRecovery('CONNECT_WABA_MISMATCH', false)).toEqual({ action: 'help', labelKey: 'onboarding.help.cta' });
    expect(connectRecovery('CONNECT_WABA_MISMATCH', true)?.action).toBe('disconnect');
    expect(connectRecovery('META_TOKEN_REVOKED', false)?.action).toBe('help');
    expect(connectRecovery('META_TOKEN_REVOKED', true)?.action).toBe('reconnect');
    expect(connectRecovery('OWNER_ONLY', true)).toBeNull();
    expect(connectRecovery('VALIDATION_FAILED', true)).toBeNull();
  });
});

describe('ConnectScreen: config and SDK failures', () => {
  it.each(['ONB_SDK_BLOCKED', 'ONB_SDK_TIMEOUT'])('%s: copy, a step_fail event, and "try again" starts a clean attempt', async (code) => {
    const load = vi.fn((): Promise<void> => Promise.reject(Object.assign(new Error(code), { code })));
    const r = await mount({ sdk: { load } });
    expect(r.cmp.phase()).toBe('failure');
    expect(txt(r, '[role="alert"]')).toContain(`[onboarding.errors.${code}]`);
    expect(r.api.event.mock.calls.map((c) => c[0])).toContainEqual({ type: 'step_fail', step: 'connect', code });
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.common.tryAgain]');
    load.mockImplementation(() => Promise.resolve());
    click(r);
    await r.flush();
    expect(r.api.connectConfig).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(r.cmp.phase()).toBe('ready');
  });

  it('a blocked SDK inside an in-app browser also offers copy link', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Instagram 300.0 Android');
    const r = await mount({ sdk: { load: vi.fn(() => Promise.reject(Object.assign(new Error('x'), { code: 'ONB_SDK_BLOCKED' }))) } });
    expect(r.el.textContent).toContain('[onboarding.common.copyLink]');
  });

  it('copy link copies the page address (no query, no token) and says so', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Instagram 300.0 Android');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const r = await mount();
    const btn = Array.from(r.el.querySelectorAll('button')).find((b) => b.textContent?.includes('copyLink')) as HTMLButtonElement;
    btn.click();
    await r.flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}`);
    expect(r.el.textContent).toContain('[onboarding.common.copied]');
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.common.copied]');
  });

  it('a config request that fails shows the mapped error; "not configured" (503 or enabled:false) offers help', async () => {
    const a = await mount({ api: { connectConfig: vi.fn(() => httpErr(503, 'CONNECT_NOT_CONFIGURED')) } });
    expect(a.cmp.errorCode()).toBe('CONNECT_NOT_CONFIGURED');
    expect(a.sdk.load).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const b = await mount({ api: { connectConfig: vi.fn(() => of(CFG({ enabled: false }))) } });
    expect(b.cmp.errorCode()).toBe('CONNECT_NOT_CONFIGURED');
    TestBed.resetTestingModule();
    const c = await mount({ api: { connectConfig: vi.fn(() => of(CFG({ configId: '' }))) } });
    expect(c.cmp.errorCode()).toBe('CONNECT_NOT_CONFIGURED');
    TestBed.resetTestingModule();
    const d = await mount({ api: { connectConfig: vi.fn(() => httpErr(409, 'STEP_PREREQUISITE')) }, state: { ...ACTIVE, nextStep: 'number' } });
    expect(d.cmp.errorCode()).toBe('STEP_PREREQUISITE');
    click(d);
    expect(d.router.navigateByUrl).toHaveBeenCalledWith('/setup/number');
  });

  it('the attempt id is renewed quietly after 10 minutes and the new one is used', async () => {
    let n = 0;
    const r = await mount({ api: { connectConfig: vi.fn(() => of(CFG({ attemptId: `att-${++n}` }))) } });
    await r.flush(CONNECT_TIMING.configRefreshMs);
    expect(r.api.connectConfig).toHaveBeenCalledTimes(2);
    expect(r.cmp.phase()).toBe('ready');
    await clickFinishThenCode(r);
    expect((r.api.connectComplete.mock.calls[0][0] as { attemptId: string }).attemptId).toBe('att-2');
  });
});

describe('ConnectScreen: results', () => {
  it('connected: success state with the full number in an LTR isolate, the name, the two prompt cards at once, Next + approvals', async () => {
    const r = await mount();
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('success');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.success.title]');
    const phone = q(r, '[appPhone]');
    expect(phone?.getAttribute('dir')).toBe('ltr');
    expect(phone?.textContent?.trim()).toBe('+966501234567');
    expect(r.el.textContent).toContain("Sara's Cafe");
    expect(r.el.querySelectorAll('.onb-card')).toHaveLength(2);
    expect(r.el.textContent).toContain('[onboarding.home.card.customers.title]');
    expect(r.el.textContent).toContain('[onboarding.home.card.products.title]');
    expect(q(r, '.onb-bar .onb-btn-primary')?.getAttribute('href')).toBe('/setup/customers');
    expect(r.el.querySelector('.onb-bar .onb-btn-secondary')?.getAttribute('href')).toBe('/setup/approvals');
    expect(r.state.reloadNow).toHaveBeenCalled();
    expect(r.api.event.mock.calls.map((c) => c[0])).toContainEqual(expect.objectContaining({ type: 'step_complete', step: 'connect' }));
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.connect.success.title]');
  });

  it('a prompt that is already done is not offered again', async () => {
    const r = await mount({ state: { ...ACTIVE, prompts: { customers: { state: 'done' }, products: { state: 'pending' } } } });
    await clickFinishThenCode(r);
    expect(r.el.querySelectorAll('.onb-card')).toHaveLength(1);
    expect(r.el.textContent).toContain('[onboarding.home.card.products.title]');
  });

  it('waba_only: the "add my number" state, whose button asks for the reconnect config and reopens the popup', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => of({ status: 'waba_only' })) } });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('wabaOnly');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.waba.title]');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.waba.cta]');
    click(r);
    await r.flush();
    expect(r.api.reconnect).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('ready');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.waba.title]');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.waba.cta]');
  });

  it('a state saved as waba_only shows the same screen after a reload', async () => {
    const r = await mount({ state: { ...ACTIVE, steps: { connect: { status: 'waba_only' } } } });
    expect(r.cmp.phase()).toBe('wabaOnly');
  });

  it('CONNECT_PARTIAL: resumes once, polls GET /connection every 5 s, and succeeds when connected', async () => {
    let polls = 0;
    const r = await mount({
      api: {
        connectComplete: vi.fn(() => httpErr(503, 'CONNECT_PARTIAL')),
        connection: vi.fn(() => of(++polls < 2 ? { status: 'connecting' } : { status: 'connected' })),
      },
    });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('partial');
    expect(r.api.connectResume).toHaveBeenCalledTimes(1);
    expect(txt(r, 'h1')).toBe('[onboarding.connect.partial.title]');
    await r.flush(CONNECT_TIMING.pollMs - 1);
    expect(r.api.connection).not.toHaveBeenCalled();
    await r.flush(1);
    expect(r.api.connection).toHaveBeenCalledTimes(1);
    await r.flush(CONNECT_TIMING.pollMs);
    expect(r.api.connection).toHaveBeenCalledTimes(2);
    expect(r.cmp.phase()).toBe('success');
    await r.flush(CONNECT_TIMING.pollMs * 3);
    expect(r.api.connection).toHaveBeenCalledTimes(2);
    expect(r.api.connectResume).toHaveBeenCalledTimes(1);
  });

  it('still partial after 2 minutes: the CONNECT_PARTIAL failure with a "finish now" button that resumes again', async () => {
    const r = await mount({
      api: { connectComplete: vi.fn(() => httpErr(503, 'CONNECT_PARTIAL')), connection: vi.fn(() => of({ status: 'connecting' })) },
    });
    await clickFinishThenCode(r);
    await r.flush(CONNECT_TIMING.pollMaxMs + CONNECT_TIMING.pollMs);
    expect(r.cmp.phase()).toBe('failure');
    expect(r.cmp.errorCode()).toBe('CONNECT_PARTIAL');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.partial.cta]');
    click(r);
    await r.flush();
    expect(r.api.connectResume).toHaveBeenCalledTimes(2);
    expect(r.cmp.phase()).toBe('partial');
  });

  it('a connecting answer starts the resume + poll flow; a resume that connects is a success', async () => {
    const r = await mount({
      api: { connectComplete: vi.fn(() => of({ status: 'connecting' })), connectResume: vi.fn(() => of({ status: 'connected', connection: { numberMasked: '+966 5** *** 4567' } })) },
    });
    await clickFinishThenCode(r);
    expect(r.cmp.phase()).toBe('success');
    expect(r.api.connectResume).toHaveBeenCalledTimes(1);
  });

  it('an answer without a readable status is checked with GET /connection before anything is shown', async () => {
    const r = await mount({ api: { connectComplete: vi.fn(() => of({})), connection: vi.fn(() => of({ level: 'connected' })) } });
    await clickFinishThenCode(r);
    expect(r.api.connection).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('success');
  });

  it('the state saved as connecting resumes on open', async () => {
    const r = await mount({ state: { ...ACTIVE, steps: { connect: { status: 'connecting' } } } });
    expect(r.cmp.phase()).toBe('partial');
    expect(r.api.connectResume).toHaveBeenCalledTimes(1);
    expect(r.api.connectConfig).not.toHaveBeenCalled();
  });

  // The REAL backend never writes waba_only / connecting on steps.connect (statuses: todo, in_progress, done, skipped):
  // the connection status lives on the connection, so a step that is not done asks GET /connection once.
  it('a step that is not done asks GET /connection once; nothing stored = a fresh attempt', async () => {
    const r = await mount();
    expect(r.api.connection).toHaveBeenCalledTimes(1);
    expect(r.api.connectConfig).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('ready');
  });

  it('the real shape of a pending number (/state: level needs_attention, cause NUMBER_PENDING) shows the "add my number" screen with no extra request', async () => {
    const r = await mount({ state: { ...ACTIVE, connection: { level: 'needs_attention', causeCode: 'NUMBER_PENDING', causePath: '/setup/connect' } } });
    expect(r.cmp.phase()).toBe('wabaOnly');
    expect(r.api.connection).not.toHaveBeenCalled();
    expect(r.api.connectConfig).not.toHaveBeenCalled();
  });

  it('a partial run is found through GET /connection (status connecting): resume, then the screen follows the server', async () => {
    const r = await mount({ state: ACTIVE, api: { connection: vi.fn(() => of({ status: 'connecting', level: 'not_connected' })) } });
    expect(r.cmp.phase()).toBe('partial');
    expect(r.api.connectResume).toHaveBeenCalledTimes(1);
    expect(r.api.connectConfig).not.toHaveBeenCalled();
  });

  it('GET /connection says waba_only: the "add my number" screen', async () => {
    const r = await mount({ state: ACTIVE, api: { connection: vi.fn(() => of({ status: 'waba_only', level: 'needs_attention' })) } });
    expect(r.cmp.phase()).toBe('wabaOnly');
    expect(r.api.connectConfig).not.toHaveBeenCalled();
  });

  it('GET /connection says connected while the step is not marked done: the connected view, and the state is re-read', async () => {
    const r = await mount({ state: ACTIVE, api: { connection: vi.fn(() => of({ status: 'connected', level: 'connected', numberMasked: '+966 5** *** 4567' })) } });
    expect(r.cmp.phase()).toBe('connected');
    expect(r.state.reloadNow).toHaveBeenCalled();
    expect(r.api.connectConfig).not.toHaveBeenCalled();
  });

  it('a failing GET /connection never blocks the screen: a fresh attempt starts', async () => {
    const r = await mount({ state: ACTIVE, api: { connection: vi.fn(() => httpErr(500)) } });
    expect(r.cmp.phase()).toBe('ready');
    expect(r.api.connectConfig).toHaveBeenCalledTimes(1);
  });

  it('a status the state itself carries is used without the extra read', async () => {
    const r = await mount({ state: { ...ACTIVE, connection: { level: null, status: 'connecting' } } });
    expect(r.cmp.phase()).toBe('partial');
    expect(r.api.connection).not.toHaveBeenCalled();
  });
});

describe('ConnectScreen: reconnect mode', () => {
  it('?reconnect=1 asks for the reconnect config (not the plain one) and uses the reconnect copy', async () => {
    const r = await mount({ query: { reconnect: '1' }, state: { ...ACTIVE, steps: { connect: { status: 'done' } }, connection: { level: 'reconnect_needed' } } });
    expect(r.api.reconnect).toHaveBeenCalledTimes(1);
    expect(r.api.connectConfig).not.toHaveBeenCalled();
    expect(txt(r, 'h1')).toBe('[onboarding.connect.reconnect.title]');
    expect(r.el.textContent).toContain('[onboarding.connect.reconnect.body]');
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.strip.reconnectBtn]');
    expect(txt(r, '.onb-bar-links')).not.toContain('[onboarding.connect.noFb]');
  });

  it('a connection that needs a reconnect gets the reconnect screen even without the query', async () => {
    const r = await mount({ state: { ...ACTIVE, steps: { connect: { status: 'done' } }, connection: { level: 'reconnect_needed' } } });
    expect(r.api.reconnect).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('ready');
  });

  it('completing a reconnect uses the same POST and ends in the success state', async () => {
    const r = await mount({ query: { reconnect: '1' }, state: { ...ACTIVE, steps: { connect: { status: 'done' } } } });
    await clickFinishThenCode(r);
    expect(r.api.connectComplete).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('success');
  });

  it('a WABA mismatch on reconnect offers disconnect to the owner only', async () => {
    const r = await mount({ query: { reconnect: '1' }, state: { ...ACTIVE, steps: { connect: { status: 'done' } } }, api: { connectComplete: vi.fn(() => httpErr(409, 'CONNECT_WABA_MISMATCH')) } });
    await clickFinishThenCode(r);
    expect(txt(r, '.onb-bar .onb-btn-primary')).toBe('[onboarding.connect.disconnect.cta]');
  });

  it('a member on ?reconnect=1 only sees "ask the owner" (no config request)', async () => {
    const r = await mount({ role: 'member', query: { reconnect: '1' }, state: { ...ACTIVE, steps: { connect: { status: 'todo' } } } });
    expect(r.api.reconnect).not.toHaveBeenCalled();
    expect(r.cmp.phase()).toBe('member');
  });
});

describe('ConnectScreen: already connected, disconnect', () => {
  const CONNECTED_STATE: OnbState = {
    ...ACTIVE, nextStep: 'approvals', steps: { connect: { status: 'done' } },
    connection: { level: 'connected', numberMasked: '+966 5** *** 4567', numberFull: '+966501234567', verifiedName: "Sara's Cafe" },
  };

  it('needs attention because of the CONNECTION (cause path /setup/connect): the owner gets a Reconnect button that opens the reconnect flow', async () => {
    const state: OnbState = { ...CONNECTED_STATE, connection: { ...CONNECTED_STATE.connection, level: 'needs_attention', causeCode: 'TOKEN_EXPIRING', causePath: '/setup/connect' } };
    const r = await mount({ state });
    expect(r.cmp.phase()).toBe('connected');
    const b = q(r, '[data-act="reconnect"]') as HTMLButtonElement;
    expect(b.textContent).toContain('onboarding.strip.reconnectBtn');
    b.click();
    await r.flush();
    expect(r.api.reconnect).toHaveBeenCalledTimes(1);
    expect(r.api.connectConfig).not.toHaveBeenCalled();
    expect(r.el.textContent).toContain('[onboarding.connect.reconnect.body]');
  });

  it('no Reconnect button when the cause is elsewhere (approvals) or the level is fine, and none for a member', async () => {
    const away: OnbState = { ...CONNECTED_STATE, connection: { ...CONNECTED_STATE.connection, level: 'needs_attention', causeCode: 'HEALTH_LIMITED', causePath: '/setup/approvals' } };
    expect(q(await mount({ state: away }), '[data-act="reconnect"]')).toBeNull();
    TestBed.resetTestingModule();
    expect(q(await mount({ state: CONNECTED_STATE }), '[data-act="reconnect"]')).toBeNull();
    TestBed.resetTestingModule();
    const mine: OnbState = { ...CONNECTED_STATE, connection: { ...CONNECTED_STATE.connection, level: 'needs_attention', causeCode: 'TOKEN_EXPIRING', causePath: '/setup/connect' } };
    expect(q(await mount({ state: mine, role: 'member' }), '[data-act="reconnect"]')).toBeNull();
  });

  it('owner: the connected view shows the full number, the name, the pill and the disconnect button; no SDK, no config', async () => {
    const r = await mount({ state: CONNECTED_STATE });
    expect(r.cmp.phase()).toBe('connected');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.connected.title]');
    expect(q(r, '[appPhone]')?.textContent?.trim()).toBe('+966501234567');
    expect(r.el.textContent).toContain("Sara's Cafe");
    expect(q(r, 'app-onb-status-pill')).not.toBeNull();
    expect(r.el.textContent).toContain('[onboarding.connect.disconnect.cta]');
    expect(r.sdk.load).not.toHaveBeenCalled();
    expect(r.api.connectConfig).not.toHaveBeenCalled();
    expect(q(r, '.onb-bar .onb-btn-primary')?.getAttribute('href')).toBe('/setup/approvals');
  });

  it('member: sees the number MASKED and has no disconnect control', async () => {
    const r = await mount({ role: 'member', state: CONNECTED_STATE });
    expect(r.cmp.phase()).toBe('connected');
    expect(q(r, '[appPhone]')?.textContent?.trim()).toBe('+966 5** *** 4567');
    expect(r.el.textContent).not.toContain('+966501234567');
    expect(r.el.textContent).not.toContain('[onboarding.connect.disconnect.cta]');
    expect(r.cmp.askDisconnect()).toBeUndefined();
    expect(r.api.disconnectRequest).not.toHaveBeenCalled();
  });

  const openDialog = async (r: Rig): Promise<void> => {
    (r.el.querySelector('.onb-conn-danger') as HTMLButtonElement).click();
    await r.flush();
  };
  const typeConfirm = async (r: Rig, v: string): Promise<void> => {
    const input = r.el.querySelector('#onb-conn-confirm') as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input'));
    await r.flush();
  };
  const confirmBtn = (r: Rig): HTMLButtonElement => r.el.querySelector('.onb-conn-danger-fill') as HTMLButtonElement;

  it('the dialog lists the known impacts (unknown keys are skipped) and needs the typed word before it enables the button', async () => {
    const r = await mount({ state: CONNECTED_STATE });
    await openDialog(r);
    expect(r.api.disconnectRequest).toHaveBeenCalledTimes(1);
    const dlg = q(r, '[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const items = Array.from(dlg.querySelectorAll('li')).map((li) => li.textContent?.trim());
    expect(items).toEqual([
      '[onboarding.connect.disconnect.impact.sending]', '[onboarding.connect.disconnect.impact.templates]', '[onboarding.connect.disconnect.impact.number]',
    ]);
    expect(dlg.textContent).toContain('[onboarding.connect.disconnect.type|word=DISCONNECT]');
    const input = dlg.querySelector('#onb-conn-confirm') as HTMLInputElement;
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(confirmBtn(r).disabled).toBe(true);
    await typeConfirm(r, 'DISCONNEC');
    expect(confirmBtn(r).disabled).toBe(true);
    await typeConfirm(r, 'something else');
    expect(confirmBtn(r).disabled).toBe(true);
    await typeConfirm(r, ' disconnect ');
    expect(confirmBtn(r).disabled).toBe(false);
  });

  it('confirming disconnects with the confirmation token, refreshes the state and returns to a ready connect screen', async () => {
    const r = await mount({ state: CONNECTED_STATE });
    await openDialog(r);
    await typeConfirm(r, 'DISCONNECT');
    confirmBtn(r).click();
    await r.flush();
    await r.flush();
    expect(r.api.disconnect).toHaveBeenCalledWith('tok-1');
    expect(r.state.reloadNow).toHaveBeenCalled();
    expect(q(r, '[role="dialog"]')).toBeNull();
    expect(r.api.connectConfig).toHaveBeenCalledTimes(1);
    expect(r.cmp.phase()).toBe('ready');
    expect(txt(r, 'h1')).toBe('[onboarding.connect.title]');
  });

  it('cancel closes the dialog and disconnects nothing; the confirm button cannot fire without the typed word', async () => {
    const r = await mount({ state: CONNECTED_STATE });
    await openDialog(r);
    confirmBtn(r).click(); // disabled: no effect
    r.cmp.confirmDisconnect();
    expect(r.api.disconnect).not.toHaveBeenCalled();
    (Array.from(r.el.querySelectorAll('.onb-sheet .onb-btn-secondary')).pop() as HTMLButtonElement).click();
    await r.flush();
    expect(q(r, '[role="dialog"]')).toBeNull();
    expect(r.api.disconnect).not.toHaveBeenCalled();
  });

  it('a refusal (OWNER_ONLY) is shown inside the dialog and the dialog stays; a failing request shows the error on the page', async () => {
    const r = await mount({ state: CONNECTED_STATE, api: { disconnect: vi.fn(() => httpErr(403, 'OWNER_ONLY')) } });
    await openDialog(r);
    await typeConfirm(r, 'DISCONNECT');
    confirmBtn(r).click();
    await r.flush();
    expect(txt(r, '[role="dialog"] [role="alert"]')).toBe('[onboarding.errors.OWNER_ONLY]');
    expect(r.state.reloadNow).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const r2 = await mount({ state: CONNECTED_STATE, api: { disconnectRequest: vi.fn(() => httpErr(403, 'OWNER_ONLY')) } });
    await openDialog(r2);
    expect(q(r2, '[role="dialog"]')).toBeNull();
    expect(txt(r2, '[role="alert"]')).toContain('[onboarding.errors.OWNER_ONLY]');
  });
});

describe('ConnectScreen: clean-up on destroy', () => {
  it('removes the message listener, clears every timer and ignores everything that arrives afterwards', async () => {
    const r = await mount();
    const remove = vi.spyOn(window, 'removeEventListener');
    click(r);
    r.sdk.cb!({ authResponse: { code: CODE } }); // starts the 1.5 s hand-off wait
    r.fixture.destroy();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    send('FINISH', IDS);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMING.watchdogMs * 2);
    r.sdk.cb!({ authResponse: { code: CODE } });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMING.signalWaitMs * 2);
    expect(r.api.connectComplete).not.toHaveBeenCalled();
    expect(r.api.connectEvent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect((r.cmp as unknown as { code: string | null }).code).toBeNull();
  });

  it('polling and countdown timers stop with the screen', async () => {
    const r = await mount({
      api: { connectComplete: vi.fn(() => httpErr(503, 'CONNECT_PARTIAL')), connection: vi.fn(() => of({ status: 'connecting' })) },
    });
    await clickFinishThenCode(r);
    r.fixture.destroy();
    const calls = r.api.connection.mock.calls.length;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMING.pollMaxMs);
    expect(r.api.connection.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pure helpers', () => {
  it('isInAppBrowser recognises the in-app user agents', () => {
    for (const ua of ['Mozilla/5.0 [FBAN/FBIOS;FBAV/1.0]', 'Mozilla/5.0 FB_IAB/FB4A', 'Instagram 300', 'WhatsApp/2.2', 'Line/12.0', 'Snapchat/11', 'musical_ly TikTok 30']) {
      expect(isInAppBrowser(ua), ua).toBe(true);
    }
    for (const ua of ['Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36', 'Mozilla/5.0 (iPhone) Version/17 Safari/604', '', null, undefined]) {
      expect(isInAppBrowser(ua as string), String(ua)).toBe(false);
    }
  });

  it('connectOutcome reads the status or the level and never throws', () => {
    expect(connectOutcome({ status: 'connected' })).toBe('connected');
    expect(connectOutcome({ status: 'needs_attention' })).toBe('connected');
    expect(connectOutcome({ status: 'waba_only' })).toBe('waba_only');
    expect(connectOutcome({ status: 'connecting' })).toBe('connecting');
    expect(connectOutcome({ connection: { status: 'connected' } })).toBe('connected');
    expect(connectOutcome({ level: 'connected' })).toBe('connected');
    expect(connectOutcome({ level: 'reconnect_needed' })).toBe('unknown');
    // a status wins over the level: an "error" or "disconnected" connection is not connected whatever the level says
    expect(connectOutcome({ status: 'error', level: 'needs_attention' })).toBe('unknown');
    expect(connectOutcome({ status: 'disconnected', level: 'not_connected' })).toBe('unknown');
    expect(connectOutcome({ status: 'reconnect_required' })).toBe('unknown');
    expect(connectOutcome({ level: 'not_connected' })).toBe('unknown');
    for (const bad of [null, undefined, 5, 'x', [], {}]) expect(connectOutcome(bad)).toBe('unknown');
  });
});

describe('stateConnectionHint', () => {
  it('reads the status when the state carries one, else the NUMBER_PENDING cause, else nothing', () => {
    expect(stateConnectionHint({ status: 'waba_only' })).toBe('waba_only');
    expect(stateConnectionHint({ status: 'connecting' })).toBe('connecting');
    expect(stateConnectionHint({ level: 'needs_attention', causeCode: 'NUMBER_PENDING' })).toBe('waba_only');
    expect(stateConnectionHint({ level: 'needs_attention', causeCode: 'TOKEN_EXPIRING' })).toBe('unknown');
    expect(stateConnectionHint({ level: null })).toBe('unknown');
    expect(stateConnectionHint(null)).toBe('unknown');
    expect(stateConnectionHint(undefined)).toBe('unknown');
  });
});

describe('ConnectNoFacebookScreen', () => {
  it('explains, offers the sign-up link (new tab, noopener) and "I can log in now"', async () => {
    const api = makeApi();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'setup/connect', component: Blank }]),
        { provide: I18nService, useClass: FakeI18n },
        { provide: OnbApiService, useValue: api },
      ],
    });
    await TestBed.inject(I18nService).init();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ConnectNoFacebookScreen);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('[onboarding.connect.nofb.title]');
    expect(el.textContent).toContain('[onboarding.errors.CONNECT_NO_FACEBOOK_ACCOUNT]');
    const link = el.querySelector('a.onb-btn-secondary') as HTMLAnchorElement;
    expect(link.href).toMatch(/^https:\/\/www\.facebook\.com\//);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    (el.querySelector('.onb-bar .onb-btn-primary') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith('/setup/connect');
    expect(el.querySelector('app-onb-help')).not.toBeNull();
  });
});
