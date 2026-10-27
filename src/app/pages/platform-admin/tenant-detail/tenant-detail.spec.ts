import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import { TenantDetail } from './tenant-detail';

vi.setConfig({ testTimeout: 30000 });

const WA = {
  mode: 'platform', phoneIdLast4: null, wabaId: null, displayPhoneNumber: null, verifiedName: null,
  tokenConfigured: false, tokenIsValid: null, checkedAt: null, enabled: true,
};
const TENANT = {
  id: 't2', name: 'MegaSun', createdAt: '2026-10-26T10:00:00Z', isPlatformDefault: false,
  owners: [{ userId: 'u2', name: 'Owner', contactMasked: '******1234' }], memberCount: 1, customerCount: 0,
  plan: { code: 'starter', status: 'active' }, arabicEnabled: false, whatsapp: WA,
};
const MEMBERS = [{ userId: 'u2', name: 'Owner One', contactMasked: '******1234', role: 'owner', createdAt: '2026-10-26T10:00:00Z' }];
const COUNTS = { customers: 12, products: 3, services: 1, promotions: 2 };
const AUDIT = [
  { id: 'a1', actorLabel: 'a***@d***.com', action: 'create_tenant', createdAt: '2026-10-26T10:00:00Z', detail: { name: 'MegaSun', secretObject: { x: 1 } } },
  { id: 'a2', actorLabel: 'a***@d***.com', action: 'set_whatsapp', createdAt: '2026-10-27T10:00:00Z', detail: null },
];

async function settle(fixture: ComponentFixture<TenantDetail>) {
  for (let i = 0; i < 3; i++) {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const isTenant = (r: TestRequest) => /\/api\/platform\/tenants\/t2$/.test(r.request.url) && r.request.method === 'GET';
const isAudit = (r: TestRequest) => /\/api\/platform\/audit/.test(r.request.url);

async function boot(opts: { tenantStatus?: number; auditStatus?: number } = {}) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const auth = { enterTenant: vi.fn().mockResolvedValue(undefined) };
  const dialog = { confirm: vi.fn().mockResolvedValue(true), error: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't2' }) } } },
      { provide: AuthService, useValue: auth }, { provide: DialogService, useValue: dialog },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TenantDetail);
  fixture.detectChanges();
  const t = http.expectOne((r) => isTenant({ request: r } as TestRequest));
  if (opts.tenantStatus) t.flush({ error: 'x' }, { status: opts.tenantStatus, statusText: 'err' });
  else t.flush({ tenant: TENANT, members: MEMBERS, counts: COUNTS });
  const a = http.expectOne((r) => /\/api\/platform\/audit/.test(r.url));
  expect(a.request.params.get('tenantId')).toBe('t2');
  if (opts.auditStatus) a.flush({}, { status: opts.auditStatus, statusText: 'err' });
  else a.flush({ entries: AUDIT });
  await settle(fixture);
  return { fixture, cmp: fixture.componentInstance, http, el: fixture.nativeElement as HTMLElement, auth, dialog };
}

describe('TenantDetail', () => {
  afterEach(() => localStorage.clear());

  it('shows the overview, the people, the WhatsApp number card and the audit list', async () => {
    const { el } = await boot();
    expect(el.querySelector('.page-title')?.textContent).toContain('MegaSun');
    expect(el.textContent).toContain('starter (active)');
    expect(el.textContent).toContain('Platform number');
    const stats = Array.from(el.querySelectorAll('.stat')).map((s) => `${s.querySelector('.stat-num')?.textContent} ${s.querySelector('.stat-label')?.textContent}`);
    expect(stats).toEqual(['12 Customers', '3 Products', '1 Services', '2 Promotions']);
    expect(el.querySelector('table')?.textContent).toContain('Owner One');
    expect(el.querySelector('table')?.textContent).toContain('******1234');
    expect(el.querySelector('app-tenant-whatsapp-form')).not.toBeNull();
    expect(el.textContent).toContain('Created the customer');
    expect(el.textContent).toContain('Saved the WhatsApp number');
  });

  it('audit detail shows only plain values (no nested objects) and a missing detail shows nothing extra', async () => {
    const { el } = await boot();
    expect(el.textContent).toContain('(name: MegaSun)');
    expect(el.textContent).not.toContain('secretObject');
  });

  it('shows a not-found message and a retry on 404', async () => {
    const { el } = await boot({ tenantStatus: 404 });
    expect(el.textContent).toContain('This customer was not found.');
    expect(el.textContent).toContain('Try again');
  });

  it('a failing audit list does not break the page', async () => {
    const { el } = await boot({ auditStatus: 500 });
    expect(el.querySelector('.page-title')?.textContent).toContain('MegaSun');
    expect(el.textContent).toContain('Could not load the activity list.');
  });

  it('renames with validation and updates the title', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.startRename();
    cmp.nameDraft = 'x';
    cmp.saveRename();
    http.expectNone((r) => r.method === 'PATCH');
    expect(cmp.nameError).toBeTruthy();
    cmp.nameDraft = ' MegaSun Arabia ';
    cmp.saveRename();
    const r = http.expectOne((x) => x.method === 'PATCH');
    expect(r.request.url).toMatch(/\/tenants\/t2$/);
    expect(r.request.body).toEqual({ name: 'MegaSun Arabia' });
    r.flush({ tenant: { ...TENANT, name: 'MegaSun Arabia' } });
    http.expectOne((x) => isAudit({ request: x } as TestRequest)).flush({ entries: [] });
    await settle(fixture);
    expect(el.querySelector('.page-title')?.textContent).toContain('MegaSun Arabia');
    expect(cmp.editingName).toBe(false);
  });

  it('renaming to the same name makes no call', async () => {
    const { cmp, http } = await boot();
    cmp.startRename();
    cmp.nameDraft = 'MegaSun';
    cmp.saveRename();
    http.expectNone((x) => x.method === 'PATCH');
    expect(cmp.editingName).toBe(false);
  });

  it('a rename failure keeps the form open with the server message', async () => {
    const { cmp, http } = await boot();
    cmp.startRename();
    cmp.nameDraft = 'Other';
    cmp.saveRename();
    http.expectOne((x) => x.method === 'PATCH').flush({ error: 'Name already taken.' }, { status: 409, statusText: 'x' });
    expect(cmp.nameError).toBe('Name already taken.');
    expect(cmp.editingName).toBe(true);
  });

  describe('adding a person', () => {
    it('validates the contact before calling the API', async () => {
      const { cmp, http } = await boot();
      cmp.memberContactType = 'email';
      cmp.memberContact = 'nope';
      cmp.addMember();
      http.expectNone((x) => /members$/.test(x.url));
      expect(cmp.memberContactError).toContain('email');
      cmp.memberContactType = 'phone';
      cmp.memberContact = '123';
      expect(cmp.memberContactError).toContain('phone');
      cmp.memberContact = '';
      expect(cmp.memberContactError).toBeTruthy();
    });

    it('adds an owner, reloads the people list and says whether a new account was made', async () => {
      const { cmp, http, fixture, el } = await boot();
      cmp.memberContactType = 'phone';
      cmp.memberContact = '966500000001';
      cmp.memberName = 'Second';
      cmp.memberRole = 'owner';
      cmp.addMember();
      const r = http.expectOne((x) => /\/tenants\/t2\/members$/.test(x.url));
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ contactType: 'phone', contact: '966500000001', role: 'owner', name: 'Second' });
      r.flush({ member: { userId: 'u3', name: 'Second', contactMasked: '******0001', role: 'owner', createdAt: '2026-10-27T10:00:00Z' }, created: true }, { status: 201, statusText: 'Created' });
      http.expectOne((x) => isTenant({ request: x } as TestRequest)).flush({
        tenant: TENANT, members: [...MEMBERS, { userId: 'u3', name: 'Second', contactMasked: '******0001', role: 'owner', createdAt: '2026-10-27T10:00:00Z' }], counts: COUNTS,
      });
      http.expectOne((x) => /\/audit/.test(x.url)).flush({ entries: [] });
      await settle(fixture);
      expect(el.querySelector('.note-ok')?.textContent).toContain('A new account was made for ******0001');
      expect(el.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(2);
      expect(cmp.memberContact).toBe('');
    });

    it('says when the person already had an account; leaves name out of the body when blank', async () => {
      const { cmp, http } = await boot();
      cmp.memberContactType = 'email';
      cmp.memberContact = 'x@example.com';
      cmp.memberRole = 'member';
      cmp.addMember();
      const r = http.expectOne((x) => /members$/.test(x.url));
      expect(r.request.body).toEqual({ contactType: 'email', contact: 'x@example.com', role: 'member' });
      r.flush({ member: { userId: 'u4', name: '', contactMasked: 'x***@e***.com', role: 'member', createdAt: '2026-10-27T10:00:00Z' }, created: false });
      expect(cmp.memberNotice).toContain('already had an account');
    });

    it('shows the server error and ignores a double click', async () => {
      const { cmp, http } = await boot();
      cmp.memberContact = '966500000001';
      cmp.addMember();
      cmp.addMember();
      const reqs = http.match((x) => /members$/.test(x.url));
      expect(reqs.length).toBe(1);
      reqs[0].flush({ error: 'Already a member.' }, { status: 409, statusText: 'x' });
      expect(cmp.memberError).toBe('Already a member.');
      expect(cmp.memberSaving).toBe(false);
    });
  });

  it('a WhatsApp change from the card updates the overview and refreshes the audit list', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.onWhatsAppChange({ ...WA, mode: 'own', phoneIdLast4: '5678', displayPhoneNumber: '+966 50 000 0000' } as never);
    http.expectOne((x) => /\/audit/.test(x.url)).flush({ entries: [] });
    await settle(fixture);
    expect(el.querySelector('.meta')?.textContent).toContain('+966 50 000 0000 (own)');
  });

  it('Enter customer confirms, then enters', async () => {
    const { cmp, auth, dialog } = await boot();
    await cmp.enter();
    expect(dialog.confirm.mock.calls[0][0]).toContain('MegaSun');
    expect(auth.enterTenant).toHaveBeenCalledWith('t2');
  });

  it('Enter customer reports a failure and lets the person try again', async () => {
    const { cmp, auth, dialog } = await boot();
    auth.enterTenant.mockRejectedValueOnce({ error: { error: 'Super admin only' } });
    await cmp.enter();
    expect(dialog.error).toHaveBeenCalledWith('Super admin only');
    expect(cmp.entering).toBe(false);
  });

  it('Enter customer does nothing when declined', async () => {
    const { cmp, auth, dialog } = await boot();
    dialog.confirm.mockResolvedValueOnce(false);
    await cmp.enter();
    expect(auth.enterTenant).not.toHaveBeenCalled();
  });
});
