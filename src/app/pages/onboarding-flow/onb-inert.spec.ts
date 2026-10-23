import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../shared/auth.service';
import { LegalService } from '../../shared/legal.service';
import { ONBOARDING_FLOW_ROUTES } from './onb.routes';
import { provideOnboardingFlow } from './onb.provider';

// Characterisation INSIDE the repo: with the real routes, the real pages and every "not enrolled" answer the
// legacy pages issue exactly the requests they issue today (the old route set, without the feature), plus the single
// GET /api/onboarding/state. The DOM-level parity run lives in the parity harness outside the repo.
vi.setConfig({ testTimeout: 60000 });

const STATE_URL = 'http://localhost:3000/api/onboarding/state';
const authStub = {
  get isLoggedIn(): boolean { return !!localStorage.getItem('waflow_auth_token'); },
  get token(): string | null { return localStorage.getItem('waflow_auth_token'); },
  session: of(null),
  sessionSnapshot: null,
};
const legalStub = { status: () => of({ requiresCombinedAcceptance: false, requiresDpaAcceptance: false }), refresh: () => undefined };
const legacyRoutes = routes.filter((r) => !ONBOARDING_FLOW_ROUTES.includes(r));

type Answer = { status: number; body?: object } | { error: true };

const ANSWERS: [string, Answer][] = [
  ['404 (backend flag off)', { status: 404 }],
  ['{enrolled:false}', { status: 200, body: { enrolled: false } }],
  ['500', { status: 500 }],
  ['network error', { error: true }],
];

async function pause(ms = 40): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Boots the app routes (with or without the feature), opens `url`, and returns every request the page made.
async function visit(withFeature: boolean, url: string, answer: Answer, token = true): Promise<{ requests: string[]; stateCalls: number; dom: { host: boolean; inertOrHidden: boolean; bodyClass: string } }> {
  TestBed.resetTestingModule();
  localStorage.clear();
  sessionStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(withFeature ? routes : legacyRoutes), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: authStub }, { provide: LegalService, useValue: legalStub },
      ...(withFeature ? [provideOnboardingFlow()] : []),
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  let stateCalls = 0;
  const answerState = (): void => {
    for (const req of http.match(STATE_URL)) {
      stateCalls++;
      if ('error' in answer) req.error(new ProgressEvent('error'), { status: 0 });
      else if (answer.status === 200) req.flush(answer.body ?? null);
      else req.flush({}, { status: answer.status, statusText: 'x' });
    }
  };
  const harness = await RouterTestingHarness.create();
  const nav = harness.navigateByUrl(url);
  // answer the state request whenever it shows up (initializer and/or guard), while the navigation is pending
  const pump = setInterval(answerState, 5);
  try {
    await nav;
    await pause();
    answerState();
    await pause();
  } finally {
    clearInterval(pump);
  }
  const requests = http.match(() => true).map((r) => `${r.request.method} ${r.request.urlWithParams}`).sort();
  const dom = {
    host: !!document.querySelector('.onb-shell-host'),
    inertOrHidden: !!document.querySelector('[inert], [aria-hidden]'),
    bodyClass: document.body.className,
  };
  return { requests, stateCalls, dom };
}

describe('inert: legacy pages issue exactly today\'s requests plus ONE state call', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  const pages = ['/dashboard', '/settings', '/customers', '/promotions', '/onboarding'];
  const cases = pages.flatMap((p) => ANSWERS.map(([name, a]) => [p, name, a] as const));

  it.each(cases)('%s with state answer %s', async (url, _name, answer) => {
    const before = await visit(false, url, answer);
    const after = await visit(true, url, answer);
    expect(before.stateCalls).toBe(0);
    expect(after.stateCalls).toBe(1);
    // the data pages really rendered and loaded their data (not a vacuous comparison); the old wizard asks for nothing on load
    if (url !== '/onboarding') expect(before.requests.length).toBeGreaterThan(0);
    expect(after.requests).toEqual(before.requests);
    expect(after.dom).toEqual(before.dom);
    expect(after.dom).toEqual({ host: false, inertOrHidden: false, bodyClass: '' });
  });

  it.each(pages)('%s without a token: no onboarding request at all (the route redirects to /login as today)', async (url) => {
    const before = await visit(false, url, { status: 404 }, false);
    const after = await visit(true, url, { status: 404 }, false);
    expect(after.stateCalls).toBe(0);
    expect(after.requests).toEqual(before.requests);
  });
});
