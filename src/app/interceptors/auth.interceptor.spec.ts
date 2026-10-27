import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../shared/auth.service';
import { SKIP_AUTO_LOGOUT } from '../shared/platform-api.service';
import { authInterceptor } from './auth.interceptor';

function setup(token: string | null) {
  localStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', token);
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl } },
      // A stand-in: constructing the real one would send its own /me request.
      { provide: AuthService, useValue: { logout } },
    ],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController), logout, navigateByUrl };
}

describe('authInterceptor', () => {
  afterEach(() => localStorage.clear());

  it('adds the bearer token', () => {
    const { http, ctl } = setup('tok');
    http.get('/api/x').subscribe();
    const r = ctl.expectOne('/api/x');
    expect(r.request.headers.get('Authorization')).toBe('Bearer tok');
    r.flush({});
  });

  it('sends no Authorization header without a token and does not log out on a 401 (a wrong login code)', () => {
    const { http, ctl, logout, navigateByUrl } = setup(null);
    let status = 0;
    http.get('/api/x').subscribe({ error: (e) => (status = e.status) });
    const r = ctl.expectOne('/api/x');
    expect(r.request.headers.has('Authorization')).toBe(false);
    r.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('on a 401 with a token it goes through AuthService.logout() and to /login, and still surfaces the error', () => {
    const { http, ctl, logout, navigateByUrl } = setup('tok');
    let status = 0;
    http.get('/api/x').subscribe({ error: (e) => (status = e.status) });
    ctl.expectOne('/api/x').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it.each([403, 404, 500])('does not log out on a %s', (code) => {
    const { http, ctl, logout } = setup('tok');
    http.get('/api/x').subscribe({ error: () => {} });
    ctl.expectOne('/api/x').flush({}, { status: code, statusText: 'err' });
    expect(logout).not.toHaveBeenCalled();
  });

  it('a request marked SKIP_AUTO_LOGOUT does not sign the person out on a 401', () => {
    const { http, ctl, logout, navigateByUrl } = setup('tok');
    http.post('/api/platform/exit', {}, { context: new HttpContext().set(SKIP_AUTO_LOGOUT, true) }).subscribe({ error: () => {} });
    ctl.expectOne('/api/platform/exit').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
