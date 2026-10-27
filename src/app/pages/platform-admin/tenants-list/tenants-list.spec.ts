import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import { Tenant } from '../../../shared/platform-api.service';
import { TenantsList } from './tenants-list';

vi.setConfig({ testTimeout: 30000 });

const wa = (over: Record<string, unknown> = {}) => ({
  mode: 'platform', phoneIdLast4: null, wabaId: null, displayPhoneNumber: null, verifiedName: null,
  tokenConfigured: false, tokenIsValid: null, checkedAt: null, enabled: true, ...over,
});
const TENANTS: Tenant[] = [
  {
    id: 't1', name: 'Demo Shop', createdAt: '2026-01-05T10:00:00Z', isPlatformDefault: true,
    owners: [{ userId: 'u1', name: 'Adeel', contactMasked: 'a***@d***.com' }], memberCount: 2, customerCount: 40,
    plan: { code: 'starter', status: 'active' }, arabicEnabled: false, whatsapp: wa() as Tenant['whatsapp'],
  },
  {
    id: 't2', name: 'MegaSun', createdAt: '2026-10-26T10:00:00Z', isPlatformDefault: false,
    owners: [{ userId: 'u2', name: 'Owner', contactMasked: '******1234' }, { userId: 'u3', name: 'Second', contactMasked: '******9999' }],
    memberCount: 2, customerCount: 0, plan: null, arabicEnabled: false,
    whatsapp: wa({ mode: 'own', phoneIdLast4: '5678', displayPhoneNumber: '+966 50 000 0000', tokenConfigured: true, tokenIsValid: false }) as Tenant['whatsapp'],
  },
];

async function settle(fixture: ComponentFixture<TenantsList>) {
  for (let i = 0; i < 3; i++) {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function boot(tenants: Tenant[] | { status: number } = TENANTS) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const auth = { enterTenant: vi.fn().mockResolvedValue(undefined) };
  const dialog = { confirm: vi.fn().mockResolvedValue(true), error: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: auth }, { provide: DialogService, useValue: dialog }],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TenantsList);
  fixture.detectChanges();
  const req = http.expectOne((r) => /\/api\/platform\/tenants/.test(r.url));
  if (Array.isArray(tenants)) req.flush({ tenants });
  else req.flush({ error: 'nope' }, { status: tenants.status, statusText: 'err' });
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, http, auth, dialog, cmp: fixture.componentInstance };
}

describe('TenantsList', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('lists customers with owner, created date, WhatsApp number and plan', async () => {
    const { el } = await boot();
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim());
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Demo Shop');
    expect(rows[0]).toContain('Platform default');
    expect(rows[0]).toContain('Adeel (a***@d***.com)');
    expect(rows[0]).toContain('Platform number');
    expect(rows[0]).toContain('starter');
    expect(rows[1]).toContain('MegaSun');
    expect(rows[1]).toContain('Owner (******1234) +1');
    expect(rows[1]).toContain('+966 50 000 0000 (own)');
    expect(rows[1]).toContain('Token rejected');
    expect(rows[1]).toContain('None'); // no plan
  });

  it('shows a masked own number by its last four digits when the display number is unknown', async () => {
    const t = { ...TENANTS[1], whatsapp: wa({ mode: 'own', phoneIdLast4: '5678' }) as Tenant['whatsapp'] };
    const { el } = await boot([t]);
    expect(el.querySelector('tbody')?.textContent).toContain('Own number ending 5678');
  });

  it('links Open to the customer page', async () => {
    const { el } = await boot();
    const hrefs = Array.from(el.querySelectorAll('tbody a.btn')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/platform/t1', '/platform/t2']);
  });

  it('says so when there are no customers, and when a search finds none', async () => {
    const { el, cmp, http, fixture } = await boot([]);
    expect(el.textContent).toContain('No customers yet');
    cmp.search = 'zzz';
    cmp.runSearch();
    http.expectOne((r) => r.url.endsWith('/tenants') && r.params.get('search') === 'zzz').flush({ tenants: [] });
    await settle(fixture);
    expect(el.textContent).toContain('No customers match that search.');
  });

  it('searches by name after a short pause (debounced), once', async () => {
    const { cmp, http, fixture } = await boot();
    vi.useFakeTimers();
    cmp.search = 'm';
    cmp.onSearchInput();
    cmp.search = 'meg';
    cmp.onSearchInput();
    http.expectNone((r) => r.params.has('search'));
    await vi.advanceTimersByTimeAsync(300);
    const r = http.expectOne((x) => x.params.get('search') === 'meg');
    r.flush({ tenants: [TENANTS[1]] });
    vi.useRealTimers();
    await settle(fixture);
    expect(cmp.tenants.map((t) => t.name)).toEqual(['MegaSun']);
  });

  it('a slow older search never overwrites a newer one', async () => {
    const { cmp, http } = await boot();
    cmp.search = 'a';
    cmp.runSearch();
    const first = http.expectOne((r) => r.params.get('search') === 'a');
    cmp.search = 'b';
    cmp.runSearch();
    const second = http.expectOne((r) => r.params.get('search') === 'b');
    second.flush({ tenants: [TENANTS[1]] });
    first.flush({ tenants: [TENANTS[0]] });
    expect(cmp.tenants.map((t) => t.id)).toEqual(['t2']);
  });

  it('shows a clear message on 403 and a retry', async () => {
    const { el } = await boot({ status: 403 });
    expect(el.textContent).toContain('You do not have access to the platform console.');
    expect(el.textContent).toContain('Try again');
  });

  it('Enter asks first, then enters the chosen customer', async () => {
    const { el, auth, dialog } = await boot();
    (el.querySelectorAll('tbody tr')[1].querySelector('button.btn-primary') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(dialog.confirm.mock.calls[0][0]).toContain('MegaSun');
    await Promise.resolve();
    expect(auth.enterTenant).toHaveBeenCalledWith('t2');
  });

  it('Enter does nothing when the confirmation is declined', async () => {
    const { cmp, auth, dialog } = await boot();
    dialog.confirm.mockResolvedValueOnce(false);
    await cmp.enter(TENANTS[1]);
    expect(auth.enterTenant).not.toHaveBeenCalled();
  });

  it('Enter reports a failure and lets the person try again', async () => {
    const { cmp, auth, dialog } = await boot();
    auth.enterTenant.mockRejectedValueOnce({ error: { error: 'Super admin only' } });
    await cmp.enter(TENANTS[1]);
    expect(dialog.error).toHaveBeenCalledWith('Super admin only');
    expect(cmp.enteringId).toBeNull();
  });

  it('opens and closes the create dialog; a created customer refreshes the list; Open customer navigates', async () => {
    const { el, cmp, http, fixture } = await boot();
    expect(el.querySelector('app-tenant-create-dialog')).toBeNull();
    (el.querySelector('.page-header button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('app-tenant-create-dialog')).not.toBeNull();
    cmp.onCreated();
    http.expectOne((r) => /\/api\/platform\/tenants/.test(r.url)).flush({ tenants: TENANTS });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    cmp.openCreated('t9');
    expect(nav).toHaveBeenCalledWith(['/platform', 't9']);
    await settle(fixture);
    expect(el.querySelector('app-tenant-create-dialog')).toBeNull();
  });
});
