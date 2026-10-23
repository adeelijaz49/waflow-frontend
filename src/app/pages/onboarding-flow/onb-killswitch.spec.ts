import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../shared/auth.service';
import { LegalService } from '../../shared/legal.service';
import { ONB_UI_ENABLED, ONB_UI_ENABLED_TOKEN } from './onb-links';
import { provideOnboardingFlow } from './onb.provider';

// The frontend kill switch (OD12): with ONB_UI_ENABLED = false there is no request, no mount and every guard answers
// "not mine" without a request. Flipped here through its injection token (the shipped constant is true).

vi.setConfig({ testTimeout: 30000 });

const authStub = {
  get isLoggedIn(): boolean { return !!localStorage.getItem('waflow_auth_token'); },
  session: of(null),
  sessionSnapshot: null,
};
const legalStub = { status: () => of({ requiresCombinedAcceptance: false, requiresDpaAcceptance: false }), refresh: () => undefined };

describe('frontend kill switch (ONB_UI_ENABLED = false)', () => {
  it('the shipped constant is true: the switch is only flipped by the token in this spec', () => {
    expect(ONB_UI_ENABLED).toBe(true);
  });

  it('makes no state request, mounts nothing, and the legacy routes resolve as today (even with a token)', async () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('waflow_auth_token', 'token-A');
    document.body.className = '';
    document.body.innerHTML = '<main class="main-content"><div class="legacy">x</div></main>';
    const before = document.body.innerHTML;
    TestBed.configureTestingModule({
      providers: [
        { provide: ONB_UI_ENABLED_TOKEN, useValue: false },
        provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), provideOnboardingFlow(),
        { provide: AuthService, useValue: authStub }, { provide: LegalService, useValue: legalStub },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/dashboard');
    expect(router.url).toBe('/dashboard');
    const cfg = router.routerState.snapshot.root.firstChild?.routeConfig;
    expect(cfg?.canMatch).toBeUndefined(); // the existing route, not the shadow
    await router.navigateByUrl('/onboarding');
    expect(router.routerState.snapshot.root.firstChild?.routeConfig?.canMatch).toBeUndefined();
    await router.navigateByUrl('/setup/connect'); // /setup is not reachable: back to the dashboard
    expect(router.url).toBe('/dashboard');
    http.expectNone(() => true);
    expect(document.body.innerHTML).toBe(before);
    expect(document.body.className).toBe('');
  });
});
