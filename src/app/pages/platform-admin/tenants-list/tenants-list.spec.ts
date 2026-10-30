import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import { PlatformNumber, Tenant } from '../../../shared/platform-api.service';
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

const NOT_REGISTERED_TEXT = "Meta shows this number's status as PENDING, not CONNECTED, so it is not ready to send: WhatsApp is likely to refuse its messages with error 133010 (Account not registered). Check its status in Meta, then check again.";
const TOKEN_TEXT = 'WhatsApp says the platform access token is not valid or has expired.';
const EFFECT_133010 = 'Customers that send from the shared number are likely to see (#133010) Account not registered while the number is in this state.';
const EFFECT_OTHER = 'Customers that send from the shared number are likely to have their messages refused until this is fixed.';
const NUMBER = (over: Partial<PlatformNumber> = {}): PlatformNumber => ({
  phoneIdLast4: '1618', displayPhoneNumber: '+1 555-643-3808', verifiedName: 'Test Number', status: 'PENDING',
  registered: false, message: NOT_REGISTERED_TEXT, checkedAt: '2026-10-30T09:00:00Z', ...over,
});
const isNumber = (r: { url: string }) => /\/api\/platform\/whatsapp\/platform-number/.test(r.url);

// `number` is what the shared-number request answers; left out, that request stays pending (as while it loads).
async function boot(tenants: Tenant[] | { status: number } = TENANTS, number?: PlatformNumber | { status: number }) {
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
  const numberReq = http.expectOne((r) => isNumber(r));
  if (number && 'phoneIdLast4' in number) numberReq.flush({ number });
  else if (number) numberReq.flush({ error: 'nope' }, { status: number.status, statusText: 'err' });
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, http, auth, dialog, cmp: fixture.componentInstance, numberReq };
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

describe('TenantsList: the shared number warning', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  const banner = (el: HTMLElement) => el.querySelector('[data-test=number-warning]') as HTMLElement | null;
  const failedLine = (el: HTMLElement) => el.querySelector('[data-test=number-check-failed]') as HTMLElement | null;
  const compact = (e: Element | null) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const checkAgain = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Check again') || (b.textContent || '').includes('Checking')) as HTMLButtonElement;

  it('asks for the shared number without fresh on load, and shows no banner while it is still loading', async () => {
    const { el, numberReq } = await boot();
    expect(numberReq.request.method).toBe('GET');
    expect(numberReq.request.params.has('fresh')).toBe(false);
    expect(banner(el)).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  it.each([
    ['registered', NUMBER({ status: 'CONNECTED', registered: true, message: null })],
    ['unknown', NUMBER({ status: null, registered: null, message: null })],
  ])('shows no banner when the number is %s', async (_name, number) => {
    const { el } = await boot(TENANTS, number);
    expect(banner(el)).toBeNull();
  });

  it('a failing number request shows no banner, says the check failed, and the customer table still works', async () => {
    const { el } = await boot(TENANTS, { status: 502 });
    expect(banner(el)).toBeNull();
    expect(compact(failedLine(el))).toContain('Could not check the shared WhatsApp number just now.');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('[role=alert]')).toBeNull();
    // under the page header, above the search and the table
    const line = failedLine(el)!;
    expect(el.querySelector('.page-header')!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(el.querySelector('.search-bar')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no could-not-check line when the number was read fine, or is still loading', async () => {
    expect(failedLine((await boot(TENANTS, NUMBER())).el)).toBeNull();
    TestBed.resetTestingModule();
    expect(failedLine((await boot()).el)).toBeNull();
  });

  it('Try again after a failed first read asks with fresh, and the line goes when the answer is good', async () => {
    const { el, http, fixture } = await boot(TENANTS, { status: 502 });
    const tryAgain = failedLine(el)!.querySelector('button') as HTMLButtonElement;
    expect(tryAgain.textContent?.trim()).toBe('Try again');
    expect(tryAgain.className).toContain('btn-outline');
    expect(tryAgain.className).toContain('btn-sm');
    tryAgain.click();
    const r = http.expectOne((x) => isNumber(x));
    expect(r.request.params.get('fresh')).toBe('1');
    r.flush({ number: NUMBER() });
    await settle(fixture);
    expect(failedLine(el)).toBeNull();
    expect(banner(el)).not.toBeNull();
  });

  it('a failed Try again keeps the line, so the person can try once more', async () => {
    const { el, http, fixture } = await boot(TENANTS, { status: 502 });
    (failedLine(el)!.querySelector('button') as HTMLButtonElement).click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(failedLine(el)).not.toBeNull();
    expect(banner(el)).toBeNull();
  });

  it('an unusable number (expired platform token) still gets a banner, with its own title, the server message and the other consequence line', async () => {
    const { el } = await boot(TENANTS, NUMBER({ status: null, registered: null, message: TOKEN_TEXT }));
    const text = compact(banner(el)!);
    expect(text).toContain('WaFlow cannot use its shared WhatsApp number');
    expect(text).not.toContain('is not connected to WhatsApp');
    expect(text).toContain('+1 555-643-3808 (Test Number)');
    expect(text).toContain(TOKEN_TEXT);
    expect(text).toContain(EFFECT_OTHER);
    expect(text).not.toContain('(#133010)');
  });

  it('shows no banner when the answer is unknown and has no message', async () => {
    const { el } = await boot(TENANTS, NUMBER({ status: null, registered: null, message: null }));
    expect(banner(el)).toBeNull();
  });

  it('role="alert" sits on the text block only: not on the banner, and the Check again button is outside it', async () => {
    const { el } = await boot(TENANTS, NUMBER());
    const b = banner(el)!;
    expect(b.getAttribute('role')).toBeNull();
    const alerts = b.querySelectorAll('[role=alert]');
    expect(alerts.length).toBe(1);
    expect(alerts[0].getAttribute('data-test')).toBe('number-warning-text');
    expect(alerts[0].textContent).toContain('The shared WaFlow number is not connected to WhatsApp');
    expect(alerts[0].querySelector('button')).toBeNull();
    expect(checkAgain(el).closest('[role=alert]')).toBeNull();
  });

  it('a failing customer list does not hide the warning about the number', async () => {
    const { el } = await boot({ status: 500 }, NUMBER());
    expect(banner(el)).not.toBeNull();
  });

  it('warns, with the number, the server message and the 133010 consequence, when it is not connected', async () => {
    const { el } = await boot(TENANTS, NUMBER());
    const b = banner(el)!;
    expect(b).not.toBeNull();
    const text = (b.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('The shared WaFlow number is not connected to WhatsApp');
    expect(text).not.toContain('WaFlow cannot use its shared WhatsApp number');
    expect(text).toContain('+1 555-643-3808 (Test Number)');
    expect(text).toContain(NOT_REGISTERED_TEXT);
    expect(text).toContain(EFFECT_133010);
    expect(text).not.toContain(EFFECT_OTHER);
    // above the table
    expect(b.compareDocumentPosition(el.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the number by its id when Meta gave no display number, and leaves out a missing verified name', async () => {
    const { el } = await boot(TENANTS, NUMBER({ displayPhoneNumber: null, verifiedName: null }));
    const text = (banner(el)!.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Phone number id ending 1618');
    expect(text).not.toContain('(Test Number)');
    expect(text).not.toContain('()');
  });

  it('Check again asks with fresh, is disabled while it runs, and removes the banner when the number is registered', async () => {
    const { el, http, fixture } = await boot(TENANTS, NUMBER());
    expect(checkAgain(el).disabled).toBe(false);
    checkAgain(el).click();
    const r = http.expectOne((x) => isNumber(x));
    expect(r.request.params.get('fresh')).toBe('1');
    await settle(fixture);
    expect(checkAgain(el).disabled).toBe(true);
    r.flush({ number: NUMBER({ status: 'CONNECTED', registered: true, message: null }) });
    await settle(fixture);
    expect(banner(el)).toBeNull();
  });

  it('Check again keeps the banner, with the new text, while the number is still not registered', async () => {
    const { el, http, fixture } = await boot(TENANTS, NUMBER());
    checkAgain(el).click();
    http.expectOne((x) => isNumber(x)).flush({ number: NUMBER({ status: 'UNVERIFIED', message: 'Still waiting for Meta.' }) });
    await settle(fixture);
    expect(banner(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain('Still waiting for Meta.');
    expect(banner(el)!.textContent).not.toContain('Meta shows its status as PENDING');
    expect(checkAgain(el).disabled).toBe(false);
  });

  it('a failed Check again keeps the warning (it may still be true), says the check failed, and lets the person try again', async () => {
    const { el, http, fixture } = await boot(TENANTS, NUMBER());
    expect(failedLine(el)).toBeNull();
    checkAgain(el).click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy', code: 'VERIFY_UNAVAILABLE' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(banner(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(NOT_REGISTERED_TEXT);
    expect(compact(failedLine(el))).toContain('Could not check the shared WhatsApp number just now.');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(checkAgain(el).disabled).toBe(false);
  });

  it('a Check again that answers well after a failure takes the could-not-check line away', async () => {
    const { el, http, fixture } = await boot(TENANTS, NUMBER());
    checkAgain(el).click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(failedLine(el)).not.toBeNull();
    checkAgain(el).click();
    http.expectOne((x) => isNumber(x)).flush({ number: NUMBER({ status: 'CONNECTED', registered: true, message: null }) });
    await settle(fixture);
    expect(failedLine(el)).toBeNull();
    expect(banner(el)).toBeNull();
  });

  it('Check again that finds a token problem swaps the banner to the other title instead of removing it', async () => {
    const { el, http, fixture } = await boot(TENANTS, NUMBER());
    checkAgain(el).click();
    http.expectOne((x) => isNumber(x)).flush({ number: NUMBER({ status: null, registered: null, message: TOKEN_TEXT }) });
    await settle(fixture);
    expect(compact(banner(el)!)).toContain('WaFlow cannot use its shared WhatsApp number');
    expect(compact(banner(el)!)).toContain(TOKEN_TEXT);
  });

  it('a second click while a check runs sends nothing more', async () => {
    const { cmp, http } = await boot(TENANTS, NUMBER());
    cmp.loadNumber(true);
    cmp.loadNumber(true);
    expect(http.match((x) => isNumber(x)).length).toBe(1);
  });
});
