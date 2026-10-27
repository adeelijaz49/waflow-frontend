import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PlatformApiService, SKIP_AUTO_LOGOUT } from './platform-api.service';

const BASE = 'http://localhost:3000/api/platform';

describe('PlatformApiService', () => {
  let api: PlatformApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(PlatformApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lists tenants, with the search only when there is one', () => {
    api.listTenants().subscribe();
    let r = http.expectOne(`${BASE}/tenants`);
    expect(r.request.method).toBe('GET');
    r.flush({ tenants: [] });

    api.listTenants('  mega  ').subscribe();
    r = http.expectOne(`${BASE}/tenants?search=mega`);
    r.flush({ tenants: [] });

    api.listTenants('   ').subscribe();
    http.expectOne(`${BASE}/tenants`).flush({ tenants: [] });
  });

  it('creates a tenant', () => {
    const body = { name: 'MegaSun', ownerContactType: 'email' as const, ownerContact: 'o@example.com' };
    api.createTenant(body).subscribe();
    const r = http.expectOne(`${BASE}/tenants`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual(body);
    r.flush({});
  });

  it('reads, renames and adds people to one tenant (id is URL-encoded)', () => {
    api.getTenant('a/b').subscribe();
    http.expectOne(`${BASE}/tenants/a%2Fb`).flush({});

    api.renameTenant('t1', 'New').subscribe();
    let r = http.expectOne(`${BASE}/tenants/t1`);
    expect(r.request.method).toBe('PATCH');
    expect(r.request.body).toEqual({ name: 'New' });
    r.flush({});

    api.addMember('t1', { contactType: 'phone', contact: '966500000000', role: 'owner' }).subscribe();
    r = http.expectOne(`${BASE}/tenants/t1/members`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body.role).toBe('owner');
    r.flush({});
  });

  it('puts the WhatsApp number in the request BODY only, and verifies / clears on their own routes', () => {
    api.setWhatsApp('t1', { phoneId: '123456', accessToken: 'SECRET', verify: true }).subscribe();
    let r = http.expectOne(`${BASE}/tenants/t1/whatsapp`);
    expect(r.request.method).toBe('PUT');
    expect(r.request.body).toEqual({ phoneId: '123456', accessToken: 'SECRET', verify: true });
    expect(r.request.urlWithParams).not.toContain('SECRET');
    r.flush({});

    api.verifyWhatsApp('t1').subscribe();
    r = http.expectOne(`${BASE}/tenants/t1/whatsapp/verify`);
    expect(r.request.method).toBe('POST');
    r.flush({});

    api.clearWhatsApp('t1').subscribe();
    r = http.expectOne(`${BASE}/tenants/t1/whatsapp`);
    expect(r.request.method).toBe('DELETE');
    r.flush({});
  });

  it('enter and exit; exit is marked so a 401 does not sign the person out', () => {
    api.enter('t1').subscribe();
    let r = http.expectOne(`${BASE}/tenants/t1/enter`);
    expect(r.request.method).toBe('POST');
    expect(r.request.context.get(SKIP_AUTO_LOGOUT)).toBe(false);
    r.flush({});

    api.exit().subscribe();
    r = http.expectOne(`${BASE}/exit`);
    expect(r.request.method).toBe('POST');
    expect(r.request.context.get(SKIP_AUTO_LOGOUT)).toBe(true);
    r.flush({ ok: true });
  });

  it('reads the audit list with tenantId and limit', () => {
    api.audit({ tenantId: 't1', limit: 25 }).subscribe();
    let r = http.expectOne(`${BASE}/audit?tenantId=t1&limit=25`);
    expect(r.request.method).toBe('GET');
    r.flush({ entries: [] });

    api.audit().subscribe();
    http.expectOne(`${BASE}/audit`).flush({ entries: [] });
  });
});
