import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TenantCreateDialog } from './tenant-create-dialog';

vi.setConfig({ testTimeout: 30000 });

async function settle(fixture: ComponentFixture<TenantCreateDialog>) {
  for (let i = 0; i < 3; i++) {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function boot() {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TenantCreateDialog);
  const cmp = fixture.componentInstance;
  const events = { closed: vi.fn(), created: vi.fn(), open: vi.fn() };
  cmp.closed.subscribe(events.closed);
  cmp.created.subscribe(events.created);
  cmp.open.subscribe(events.open);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, cmp, http, events, el: fixture.nativeElement as HTMLElement };
}

const CREATED = {
  tenant: { id: 't9', name: 'MegaSun' },
  owner: { userId: 'u9', created: true },
  signInHint: 'Tell the owner to sign in with 966501234567.',
};

describe('TenantCreateDialog validation', () => {
  afterEach(() => localStorage.clear());

  it('starts with sensible defaults (SAR, +966, phone) and is invalid until a name and contact are given', async () => {
    const { cmp } = await boot();
    expect(cmp.currency).toBe('SAR');
    expect(cmp.defaultCountryCode).toBe('966');
    expect(cmp.ownerContactType).toBe('phone');
    expect(cmp.valid).toBe(false);
    expect(Object.keys(cmp.errors).sort()).toEqual(['name', 'ownerContact']);
  });

  it('does not call the API when invalid, and shows the messages after a submit attempt', async () => {
    const { cmp, http, fixture, el } = await boot();
    expect(el.textContent).not.toContain('business name');
    cmp.submit();
    http.expectNone(() => true);
    await settle(fixture);
    expect(el.textContent).toContain('Enter the customer\'s business name.');
    expect(el.textContent).toContain('Enter the owner\'s phone number.');
  });

  it.each([
    ['a', false], ['MegaSun', true], ['  ', false],
  ])('name %j valid=%s', async (name, ok) => {
    const { cmp } = await boot();
    cmp.name = name;
    cmp.ownerContact = '966501234567';
    expect(cmp.valid).toBe(ok);
  });

  it.each([
    ['phone', '966501234567', true],
    ['phone', '+966 50 123 4567', true],
    ['phone', '\u{0669}\u{0666}\u{0666}\u{0665}\u{0660}\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}', true], // Arabic-Indic digits
    ['phone', '12345', false],
    ['phone', '1234567890123456', false],
    ['phone', 'owner@example.com', false],
    ['email', 'owner@example.com', true],
    ['email', 'owner@example', false],
    ['email', 'not an email', false],
    ['email', '966501234567', false],
  ] as const)('%s contact %j valid=%s', async (type, contact, ok) => {
    const { cmp } = await boot();
    cmp.name = 'MegaSun';
    cmp.ownerContactType = type;
    cmp.ownerContact = contact;
    expect(!cmp.errors.ownerContact).toBe(ok);
  });

  it('rejects a currency that is not 3 letters but allows it to be blank', async () => {
    const { cmp } = await boot();
    cmp.name = 'MegaSun';
    cmp.ownerContact = '966501234567';
    cmp.currency = 'SA';
    expect(cmp.errors.currency).toBeTruthy();
    cmp.currency = 'sar';
    expect(cmp.errors.currency).toBeUndefined();
    cmp.currency = '';
    expect(cmp.valid).toBe(true);
  });

  it('switching the contact type clears the half-typed contact', async () => {
    const { cmp } = await boot();
    cmp.ownerContact = '9665';
    cmp.onTypeChange();
    expect(cmp.ownerContact).toBe('');
  });
});

describe('TenantCreateDialog submit', () => {
  afterEach(() => localStorage.clear());

  it('posts the trimmed values (currency upper-cased, blank optionals left out) and shows the sign-in hint', async () => {
    const { cmp, http, fixture, el, events } = await boot();
    cmp.name = '  MegaSun ';
    cmp.ownerContact = ' 966501234567 ';
    cmp.currency = 'sar';
    cmp.submit();
    const r = http.expectOne((x) => x.url.endsWith('/api/platform/tenants'));
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ name: 'MegaSun', ownerContactType: 'phone', ownerContact: '966501234567', currency: 'SAR', defaultCountryCode: '966' });
    r.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle(fixture);
    expect(events.created).toHaveBeenCalledWith(CREATED);
    expect(el.textContent).toContain('MegaSun is ready.');
    expect(el.textContent).toContain('Tell the owner to sign in with 966501234567.');
    (Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Open customer')) as HTMLButtonElement).click();
    expect(events.open).toHaveBeenCalledWith('t9');
  });

  it('includes the owner name when given and writes its own hint when the server sends none', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.name = 'MegaSun';
    cmp.ownerContactType = 'email';
    cmp.ownerContact = 'o@example.com';
    cmp.ownerName = 'Sara';
    cmp.submit();
    const r = http.expectOne((x) => x.url.endsWith('/api/platform/tenants'));
    expect(r.request.body.ownerName).toBe('Sara');
    r.flush({ tenant: { id: 't9', name: 'MegaSun' }, owner: { userId: 'u', created: false } });
    await settle(fixture);
    expect(el.textContent).toContain('Ask Sara to open Waflow and sign in with o@example.com');
    expect(el.textContent).toContain('already had an account');
  });

  it('shows the server error and stays open so nothing typed is lost', async () => {
    const { cmp, http, fixture, el, events } = await boot();
    cmp.name = 'MegaSun';
    cmp.ownerContact = '966501234567';
    cmp.submit();
    http.expectOne((x) => x.url.endsWith('/api/platform/tenants')).flush({ error: 'That phone number is not valid.' }, { status: 400, statusText: 'Bad' });
    await settle(fixture);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('That phone number is not valid.');
    expect(cmp.name).toBe('MegaSun');
    expect(cmp.saving).toBe(false);
    expect(events.created).not.toHaveBeenCalled();
  });

  it('ignores a second submit while the first is in flight (no duplicate customer)', async () => {
    const { cmp, http } = await boot();
    cmp.name = 'MegaSun';
    cmp.ownerContact = '966501234567';
    cmp.submit();
    cmp.submit();
    expect(http.match((x) => x.url.endsWith('/api/platform/tenants')).length).toBe(1);
  });

  it('closes from the x button and the backdrop but not from a click inside the dialog', async () => {
    const { el, events, fixture } = await boot();
    (el.querySelector('.modal') as HTMLElement).click();
    expect(events.closed).not.toHaveBeenCalled();
    (el.querySelector('.close-btn') as HTMLButtonElement).click();
    expect(events.closed).toHaveBeenCalledTimes(1);
    (el.querySelector('.modal-overlay') as HTMLElement).click();
    expect(events.closed).toHaveBeenCalledTimes(2);
    await settle(fixture);
  });
});
