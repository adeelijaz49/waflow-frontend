import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogService } from '../../../shared/dialog.service';
import { WhatsAppStatus } from '../../../shared/platform-api.service';
import { ENCRYPTION_MESSAGE, TenantWhatsappForm } from './tenant-whatsapp-form';

vi.setConfig({ testTimeout: 30000 });

const SECRET = 'EAAG-super-secret-permanent-token-9d8f7a6b5c4d3e2f1a0b';
const status = (over: Partial<WhatsAppStatus> = {}): WhatsAppStatus => ({
  mode: 'platform', phoneIdLast4: null, wabaId: null, displayPhoneNumber: null, verifiedName: null,
  tokenConfigured: false, tokenIsValid: null, checkedAt: null, enabled: true, ...over,
});
const OWN = status({
  mode: 'own', phoneIdLast4: '5678', wabaId: '111222333', displayPhoneNumber: '+966 50 000 0000', verifiedName: 'MegaSun',
  tokenConfigured: true, tokenLast4: '1234', tokenIsValid: true, checkedAt: '2026-10-27T09:30:00Z',
});

async function settle(fixture: ComponentFixture<TenantWhatsappForm>) {
  for (let i = 0; i < 3; i++) {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function boot(initial: WhatsAppStatus | null = status()) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  const dialog = { confirm: vi.fn().mockResolvedValue(true), error: vi.fn() };
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: DialogService, useValue: dialog }] });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TenantWhatsappForm);
  fixture.componentRef.setInput('tenantId', 't1');
  fixture.componentRef.setInput('status', initial);
  const cmp = fixture.componentInstance;
  const changes = vi.fn();
  cmp.statusChange.subscribe(changes);
  fixture.detectChanges();
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
  const input = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement;
  const btn = (label: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(label)) as HTMLButtonElement;
  const type = async (id: string, value: string) => { const i = input(id); i.value = value; i.dispatchEvent(new Event('input')); await settle(fixture); };
  return { fixture, cmp, http, el, q, input, btn, type, dialog, changes };
}

const PUT = (r: { url: string; method: string }) => r.url.endsWith('/api/platform/tenants/t1/whatsapp') && r.method === 'PUT';

describe('TenantWhatsappForm: the access token is write-only', () => {
  afterEach(() => localStorage.clear());

  it('the token field is masked and is not offered to a password manager (browsers ignore autocomplete="off" on a password field; "new-password" and a non-credential name are honoured)', async () => {
    const { input } = await boot();
    const t = input('wa-token');
    expect(t.type).toBe('password');
    expect(t.getAttribute('autocomplete')).toBe('new-password');
    expect(t.getAttribute('name')).not.toMatch(/pass|pwd|user|login|token/i);
    expect(t.getAttribute('data-lpignore')).toBe('true');
    expect(t.getAttribute('data-1p-ignore')).toBe('true');
  });

  it('sends the token once, in the body, and clears it from the field and the model straight away', async () => {
    const { cmp, http, type, input, btn, fixture } = await boot();
    await type('wa-phone-id', '555666777');
    await type('wa-waba-id', '111222333');
    await type('wa-token', SECRET);
    expect(cmp.accessToken).toBe(SECRET);
    btn('Verify and save').click();
    // cleared before the answer comes back
    expect(cmp.accessToken).toBe('');
    const r = http.expectOne((x) => PUT(x));
    expect(r.request.body).toEqual({ phoneId: '555666777', wabaId: '111222333', accessToken: SECRET, verify: true });
    r.flush({ whatsapp: OWN });
    await settle(fixture);
    expect(input('wa-token').value).toBe('');
    expect(cmp.accessToken).toBe('');
  });

  it('never renders the token anywhere, before or after saving, and the saved status shows only the last four', async () => {
    const { http, type, btn, fixture, el } = await boot();
    await type('wa-phone-id', '555666777');
    await type('wa-waba-id', '111222333');
    await type('wa-token', SECRET);
    // typed but not sent: it lives only in the password input's value, never in the page text
    expect(el.textContent).not.toContain(SECRET);
    btn('Verify and save').click();
    // the answer (a well-behaved server) never contains the token
    http.expectOne((x) => PUT(x)).flush({ whatsapp: OWN });
    await settle(fixture);
    expect(el.innerHTML).not.toContain(SECRET);
    expect(el.querySelector('[data-test=wa-token-line]')?.textContent).toContain('Token saved ending 1234');
    expect(el.textContent).not.toContain('EAAG');
  });

  it('also clears the token when the save fails, so it never lingers in the page', async () => {
    const { cmp, http, type, btn, fixture, el } = await boot();
    await type('wa-phone-id', '555666777');
    await type('wa-waba-id', '111222333');
    await type('wa-token', SECRET);
    btn('Verify and save').click();
    http.expectOne((x) => PUT(x)).flush({ error: 'WhatsApp rejected that token.' }, { status: 400, statusText: 'Bad' });
    await settle(fixture);
    expect(cmp.accessToken).toBe('');
    expect(el.innerHTML).not.toContain(SECRET);
    expect(el.querySelector('[data-test=wa-error]')?.textContent).toContain('WhatsApp rejected that token.');
  });

  it('says only "Token saved" when the server gives no last digits, and never invents any', async () => {
    const { el } = await boot({ ...OWN, tokenLast4: undefined });
    const line = el.querySelector('[data-test=wa-token-line]')?.textContent || '';
    expect(line).toContain('Token saved');
    expect(line).not.toContain('ending');
  });

  it('says there is no own token when the number lives in the platform account', async () => {
    const { el } = await boot(status({ mode: 'own', phoneIdLast4: '5678', tokenConfigured: false }));
    expect(el.querySelector('[data-test=wa-token-line]')?.textContent).toContain('No own token');
  });

  it('omits the token and WABA id from the body when left blank (number inside the platform account)', async () => {
    const { http, type, btn } = await boot();
    await type('wa-phone-id', '555666777');
    btn('Verify and save').click();
    const r = http.expectOne((x) => PUT(x));
    expect(r.request.body).toEqual({ phoneId: '555666777', verify: true });
    r.flush({ whatsapp: status({ mode: 'own', phoneIdLast4: '6777', tokenIsValid: true }) });
  });
});

describe('TenantWhatsappForm: validation', () => {
  afterEach(() => localStorage.clear());

  it('needs the phone number id and sends nothing without it', async () => {
    const { http, btn, fixture, el } = await boot();
    btn('Verify and save').click();
    await settle(fixture);
    http.expectNone((x) => PUT(x));
    expect(el.textContent).toContain('Enter the phone number id');
  });

  it.each(['abc', '12 34', '123', '+966500000000x'])('rejects %j as a phone number id', async (v) => {
    const { cmp } = await boot();
    cmp.phoneId = v;
    expect(cmp.fieldErrors.phoneId).toBeTruthy();
  });

  it('asks for the WABA id when a token is given without one, and keeps the token off the wire', async () => {
    const { http, type, btn, fixture, el } = await boot();
    await type('wa-phone-id', '555666777');
    await type('wa-token', SECRET);
    btn('Verify and save').click();
    await settle(fixture);
    http.expectNone((x) => PUT(x));
    expect(el.textContent).toContain('needs their WhatsApp Business Account id');
  });

  it('rejects a non-numeric WABA id', async () => {
    const { cmp } = await boot();
    cmp.phoneId = '555666777';
    cmp.wabaId = 'abc';
    expect(cmp.fieldErrors.wabaId).toBeTruthy();
  });

  it('ignores a second save while one is in flight', async () => {
    const { cmp, http, btn } = await boot();
    cmp.phoneId = '555666777';
    btn('Verify and save').click();
    cmp.verifyAndSave();
    expect(http.match((x) => PUT(x)).length).toBe(1);
  });
});

describe('TenantWhatsappForm: server answers', () => {
  afterEach(() => localStorage.clear());

  it('503 ENCRYPTION_NOT_CONFIGURED explains that WA_TOKEN_ENCRYPTION_KEY must be set first', async () => {
    const { http, type, btn, fixture, el } = await boot();
    await type('wa-phone-id', '555666777');
    await type('wa-waba-id', '111222333');
    await type('wa-token', SECRET);
    btn('Verify and save').click();
    http.expectOne((x) => PUT(x)).flush({ error: 'ENCRYPTION_NOT_CONFIGURED' }, { status: 503, statusText: 'Service Unavailable' });
    await settle(fixture);
    const msg = el.querySelector('[data-test=wa-error]')?.textContent || '';
    expect(msg).toContain('WA_TOKEN_ENCRYPTION_KEY');
    expect(msg).toContain('Ask the platform owner');
    expect(msg.trim()).toBe(ENCRYPTION_MESSAGE);
  });

  it('a bare 503 and a code-only body get the same plain-language message', async () => {
    const a = await boot();
    a.cmp.phoneId = '555666777';
    a.cmp.verifyAndSave();
    a.http.expectOne((x) => PUT(x)).flush('down', { status: 503, statusText: 'x' });
    expect(a.cmp.error).toBe(ENCRYPTION_MESSAGE);
    TestBed.resetTestingModule();
    const b = await boot();
    b.cmp.phoneId = '555666777';
    b.cmp.verifyAndSave();
    b.http.expectOne((x) => PUT(x)).flush({ code: 'ENCRYPTION_NOT_CONFIGURED' }, { status: 500, statusText: 'x' });
    expect(b.cmp.error).toBe(ENCRYPTION_MESSAGE);
  });

  it('409 shows the server message, or a default that names the clash', async () => {
    const a = await boot();
    a.cmp.phoneId = '555666777';
    a.cmp.verifyAndSave();
    a.http.expectOne((x) => PUT(x)).flush({ error: 'That phone number id is already used by MegaSun.' }, { status: 409, statusText: 'Conflict' });
    expect(a.cmp.error).toBe('That phone number id is already used by MegaSun.');
    TestBed.resetTestingModule();
    const b = await boot();
    b.cmp.phoneId = '555666777';
    b.cmp.verifyAndSave();
    b.http.expectOne((x) => PUT(x)).flush({}, { status: 409, statusText: 'Conflict' });
    expect(b.cmp.error).toContain('Another customer already uses');
  });

  it('verified result: shows Valid, the last checked time and a success note, and tells the parent', async () => {
    const { http, type, btn, fixture, el, changes } = await boot();
    await type('wa-phone-id', '555666777');
    btn('Verify and save').click();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: OWN });
    await settle(fixture);
    expect(changes).toHaveBeenCalledWith(OWN);
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Valid');
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Last checked');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('WhatsApp accepted the connection');
    expect(el.textContent).toContain('+966 50 000 0000');
    expect(el.textContent).toContain('MegaSun');
  });

  it('rejected result: shows the red state and warns that messages will not send', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.phoneId = '555666777';
    cmp.verifyAndSave();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: { ...OWN, tokenIsValid: false } });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Rejected by WhatsApp');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('will not send until it is fixed');
  });

  it('unchecked result: says the connection has not been checked yet', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.phoneId = '555666777';
    cmp.verifyAndSave();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: { ...OWN, tokenIsValid: null, checkedAt: null } });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Not checked yet');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('has not been checked yet');
  });
});

describe('TenantWhatsappForm: test connection and platform number', () => {
  afterEach(() => localStorage.clear());

  it('Test connection posts to verify and shows the new state; it is disabled on the platform number', async () => {
    const platform = await boot(status());
    expect(platform.btn('Test connection').disabled).toBe(true);
    expect(platform.btn('Use platform number').disabled).toBe(true);
    expect(platform.el.textContent).toContain('The shared platform WhatsApp number');
    TestBed.resetTestingModule();

    const { http, btn, fixture, el, changes } = await boot(OWN);
    expect(btn('Test connection').disabled).toBe(false);
    btn('Test connection').click();
    const r = http.expectOne((x) => x.url.endsWith('/api/platform/tenants/t1/whatsapp/verify'));
    expect(r.request.method).toBe('POST');
    r.flush({ whatsapp: { ...OWN, tokenIsValid: false, checkedAt: '2026-10-27T10:00:00Z' } });
    await settle(fixture);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Rejected by WhatsApp');
  });

  it('Test connection shows the server error', async () => {
    const { http, btn, fixture, el } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ error: 'Could not reach WhatsApp.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-error]')?.textContent).toContain('Could not reach WhatsApp.');
  });

  it('Test connection says WHY a check failed (the server\'s own message), not only that it did', async () => {
    const { http, btn, fixture, el } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({
      whatsapp: { ...OWN, tokenIsValid: false },
      message: 'WhatsApp says this access token is not valid or has expired.',
    });
    await settle(fixture);
    const notice = el.querySelector('[data-test=wa-notice]')?.textContent || '';
    expect(notice).toContain('WhatsApp says this access token is not valid or has expired.');
    expect(notice).toContain('will not send until it is fixed');
    expect(notice).not.toContain('did not accept the token'); // the specific reason replaces the generic sentence
  });

  it('Test connection with a reason but no verdict on the token still shows the reason (e.g. the number was not found)', async () => {
    const { http, btn, fixture, el } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({
      whatsapp: { ...OWN, tokenIsValid: null },
      message: 'That phone number belongs to a different WhatsApp business account than the one entered.',
    });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('belongs to a different WhatsApp business account');
  });

  it('a "WhatsApp is busy" answer (502) is shown as an error and the saved state is left alone', async () => {
    const { http, btn, fixture, el, changes } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush(
      { error: 'WhatsApp is busy and did not give a clear answer just now. Nothing was changed. Try again in a moment.', code: 'VERIFY_UNAVAILABLE' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-error]')?.textContent).toContain('Nothing was changed');
    expect(changes).not.toHaveBeenCalled();
  });

  it('Use platform number asks first and then clears the own number', async () => {
    const { http, btn, fixture, el, dialog, changes } = await boot(OWN);
    btn('Use platform number').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    const r = http.expectOne((x) => x.url.endsWith('/api/platform/tenants/t1/whatsapp') && x.method === 'DELETE');
    r.flush({ whatsapp: status() });
    await settle(fixture);
    expect(changes).toHaveBeenCalledWith(status());
    expect(el.textContent).toContain('This customer now uses the platform number.');
    expect(el.textContent).toContain('The shared platform WhatsApp number');
  });

  it('Use platform number does nothing when declined', async () => {
    const { http, cmp, dialog } = await boot(OWN);
    dialog.confirm.mockResolvedValueOnce(false);
    await cmp.usePlatformNumber();
    http.expectNone(() => true);
  });

  it('a switched-off number is flagged', async () => {
    const { el } = await boot({ ...OWN, enabled: false });
    expect(el.textContent).toContain('Switched off');
  });

  it('explains both setups in plain language', async () => {
    const { el } = await boot();
    const text = el.querySelector('.help')?.textContent || '';
    expect(text).toContain('added inside the platform');
    expect(text).toContain('only need the phone number id');
    expect(text).toContain('WhatsApp Business Account id');
    expect(text).toContain('permanent access token');
  });
});
