import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

const SETTINGS_URL = /\/api\/settings\/loyalty$/;
const ME_URL = /\/api\/auth\/me$/;
const session = (id: string) => ({ user: { id: 'u' }, workspace: { id, name: id }, role: 'owner' });

function setup(token: string | null) {
  localStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', token);
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const auth = TestBed.inject(AuthService);
  const svc = TestBed.inject(SettingsService);
  return { http, auth, svc };
}

describe('SettingsService and workspace changes', () => {
  afterEach(() => localStorage.clear());

  it('fetches once on start; the first session of the page load does not fetch again', () => {
    const { http, svc } = setup('tok');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'SAR' });
    expect(svc.currencySnapshot).toBe('SAR');
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w1'));
    http.expectNone((r) => SETTINGS_URL.test(r.url));
    expect(svc.currencySnapshot).toBe('SAR');
  });

  it('resets to the defaults and refetches when the workspace changes (no lingering currency)', () => {
    const { http, auth, svc } = setup('tok');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'SAR' });
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w1'));

    auth.refresh();
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w2'));
    // defaults while the new customer's settings are on their way
    expect(svc.currencySnapshot).toBe('AUD');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'USD' });
    expect(svc.currencySnapshot).toBe('USD');
  });

  it('does nothing when the same workspace is emitted again, on logout, or for a half-loaded session', () => {
    const { http, auth, svc } = setup('tok');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'SAR' });
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w1'));

    auth.refresh();
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w1'));
    auth.refresh();
    http.expectOne((r) => ME_URL.test(r.url)).flush([]); // no workspace in it
    auth.logout();
    http.expectNone((r) => SETTINGS_URL.test(r.url));
    expect(svc.currencySnapshot).toBe('SAR');
  });

  it('signing in after a logged-out start fetches the settings then (the start-up fetch had no token)', () => {
    const { http, auth, svc } = setup(null);
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({});
    auth.completeLogin('fresh');
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w9'));
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'EUR' });
    expect(svc.currencySnapshot).toBe('EUR');
  });

  it('after logout, a different customer signing in gets fresh settings, not the previous ones', () => {
    const { http, auth, svc } = setup('tok');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'SAR' });
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w1'));
    auth.logout();
    auth.completeLogin('other');
    http.expectOne((r) => ME_URL.test(r.url)).flush(session('w2'));
    expect(svc.currencySnapshot).toBe('AUD');
    http.expectOne((r) => SETTINGS_URL.test(r.url)).flush({ currency: 'GBP' });
    expect(svc.currencySnapshot).toBe('GBP');
  });
});
