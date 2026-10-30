import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogService } from '../../../shared/dialog.service';
import { PlatformNumber, Registration, WhatsAppStatus } from '../../../shared/platform-api.service';
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

const NOT_REGISTERED_TEXT = "Meta shows this number's status as PENDING, not CONNECTED, so it is not ready to send: WhatsApp is likely to refuse its messages with error 133010 (Account not registered). Check its status in Meta, then check again.";
const NUMBER = (over: Partial<PlatformNumber> = {}): PlatformNumber => ({
  phoneIdLast4: '1618', displayPhoneNumber: '+1 555-643-3808', verifiedName: 'Test Number', status: 'PENDING',
  registered: false, message: NOT_REGISTERED_TEXT, checkedAt: '2026-10-30T09:00:00Z', ...over,
});
const CONNECTED = NUMBER({ status: 'CONNECTED', registered: true, message: null });
const REG_FALSE: Registration = { status: 'PENDING', registered: false };
const REG_TRUE: Registration = { status: 'CONNECTED', registered: true };
const isNumber = (r: { url: string }) => /\/api\/platform\/whatsapp\/platform-number/.test(r.url);

// `number` is what the shared-number request (made only in platform mode) answers; left out, it stays pending.
async function boot(initial: WhatsAppStatus | null = status(), number?: PlatformNumber | { status: number }) {
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
  if (number) {
    const nr = http.expectOne((r) => isNumber(r));
    if ('phoneIdLast4' in number) nr.flush({ number });
    else nr.flush({ error: 'nope' }, { status: number.status, statusText: 'err' });
  }
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
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-ok');
    expect(el.querySelector('[data-test=wa-notice]')?.className).not.toContain('wa-warn');
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
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-warn');
    expect(el.querySelector('[data-test=wa-notice]')?.className).not.toContain('wa-ok');
  });

  it('unchecked result: says the connection has not been checked yet', async () => {
    const { cmp, http, fixture, el } = await boot();
    cmp.phoneId = '555666777';
    cmp.verifyAndSave();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: { ...OWN, tokenIsValid: null, checkedAt: null } });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Not checked yet');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('has not been checked yet');
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-ok');
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
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-warn');
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
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-warn');
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
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-ok');
    expect(el.querySelector('[data-test=wa-notice]')?.className).not.toContain('wa-warn');
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

describe('TenantWhatsappForm: is the number registered with WhatsApp?', () => {
  afterEach(() => localStorage.clear());

  const sharedRows = (el: HTMLElement) => ({
    number: el.querySelector('[data-test=wa-shared-number]') as HTMLElement | null,
    reg: el.querySelector('[data-test=wa-shared-registration]') as HTMLElement | null,
  });
  const ownReg = (el: HTMLElement) => el.querySelector('[data-test=wa-own-registration]') as HTMLElement | null;
  const compact = (e: Element | null) => (e?.textContent || '').replace(/\s+/g, ' ').trim();

  it('platform mode asks for the shared number (not fresh) and shows it next to "Sending from"', async () => {
    const { http, el, fixture } = await boot(status());
    const r = http.expectOne((x) => isNumber(x));
    expect(r.request.method).toBe('GET');
    expect(r.request.params.has('fresh')).toBe(false);
    r.flush({ number: CONNECTED });
    await settle(fixture);
    expect(compact(sharedRows(el).number!.querySelector('span:not(.wa-label)'))).toBe('+1 555-643-3808 (Test Number)');
  });

  it('shows nothing about the shared number while it loads', async () => {
    const pending = await boot(status());
    expect(sharedRows(pending.el).number).toBeNull();
    expect(sharedRows(pending.el).reg).toBeNull();
    expect(pending.el.textContent).not.toContain('Could not check');
  });

  it('when the first read fails: a neutral "Could not check" Registration row with a working Check again, and no number row', async () => {
    const { http, btn, el, fixture } = await boot(status(), { status: 502 });
    expect(sharedRows(el).number).toBeNull();
    const badge = sharedRows(el).reg!.querySelector('.badge')!;
    expect(badge.className).toContain('badge-neutral');
    expect(badge.textContent?.trim()).toBe('Could not check');
    expect(sharedRows(el).reg!.querySelector('[data-test=wa-shared-message]')).toBeNull();
    expect(el.querySelector('[data-test=wa-shared-failed]')).toBeNull(); // no earlier result to point at
    expect(el.textContent).toContain('The shared platform WhatsApp number');
    expect(el.querySelector('[data-test=wa-error]')).toBeNull();
    btn('Check again').click();
    const r = http.expectOne((x) => isNumber(x));
    expect(r.request.params.get('fresh')).toBe('1');
    r.flush({ number: CONNECTED });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Connected');
    expect(sharedRows(el).number).not.toBeNull();
    expect(btn('Check again').disabled).toBe(false);
  });

  it('a Check again that fails again after a failed first read keeps the "Could not check" row', async () => {
    const { http, btn, el, fixture } = await boot(status(), { status: 502 });
    btn('Check again').click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Could not check');
    expect(btn('Check again').disabled).toBe(false);
  });

  it('own mode does not ask for the shared number at all', async () => {
    const { http, el } = await boot(OWN);
    http.expectNone((r) => isNumber(r));
    expect(sharedRows(el).number).toBeNull();
  });

  it('shared number, not registered: red badge in the status word Meta gave, plus the message', async () => {
    const { el } = await boot(status(), NUMBER());
    const badge = sharedRows(el).reg!.querySelector('.badge')!;
    expect(badge.className).toContain('badge-danger');
    expect(badge.textContent?.trim()).toBe('Not connected (PENDING)');
    expect(sharedRows(el).reg!.querySelector('[data-test=wa-shared-message]')?.textContent).toContain(NOT_REGISTERED_TEXT);
  });

  it('shared number, connected: green badge and no message', async () => {
    const { el } = await boot(status(), CONNECTED);
    const badge = sharedRows(el).reg!.querySelector('.badge')!;
    expect(badge.className).toContain('badge-success');
    expect(badge.textContent?.trim()).toBe('Connected');
    expect(sharedRows(el).reg!.querySelector('[data-test=wa-shared-message]')).toBeNull();
  });

  it('shared number, unknown: neutral badge, and the display number falls back to the id', async () => {
    const { el } = await boot(status(), NUMBER({ status: null, registered: null, message: null, displayPhoneNumber: null, verifiedName: null }));
    const badge = sharedRows(el).reg!.querySelector('.badge')!;
    expect(badge.className).toContain('badge-neutral');
    expect(badge.textContent?.trim()).toBe('Unknown');
    expect(compact(sharedRows(el).number!.querySelector('span:not(.wa-label)'))).toBe('Phone number id ending 1618');
  });

  it('Check again asks with fresh, is disabled meanwhile, and updates the badge', async () => {
    const { http, btn, el, fixture } = await boot(status(), NUMBER());
    btn('Check again').click();
    const r = http.expectOne((x) => isNumber(x));
    expect(r.request.params.get('fresh')).toBe('1');
    await settle(fixture);
    expect(btn('Checking').disabled).toBe(true);
    r.flush({ number: CONNECTED });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Connected');
    expect(btn('Check again').disabled).toBe(false);
  });

  it('a failed Check again keeps the earlier result and adds a muted line saying so', async () => {
    const { http, btn, el, fixture } = await boot(status(), NUMBER());
    expect(el.querySelector('[data-test=wa-shared-failed]')).toBeNull();
    btn('Check again').click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy', code: 'VERIFY_UNAVAILABLE' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Not connected (PENDING)');
    expect(sharedRows(el).number).not.toBeNull();
    expect(compact(el.querySelector('[data-test=wa-shared-failed]'))).toBe('Could not check just now; showing the earlier result.');
    expect(btn('Check again').disabled).toBe(false);
  });

  it('the muted "could not check just now" line goes away after a good Check again', async () => {
    const { http, btn, el, fixture } = await boot(status(), NUMBER());
    btn('Check again').click();
    http.expectOne((x) => isNumber(x)).flush({ error: 'busy' }, { status: 502, statusText: 'Bad Gateway' });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-shared-failed]')).not.toBeNull();
    btn('Check again').click();
    http.expectOne((x) => isNumber(x)).flush({ number: CONNECTED });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-shared-failed]')).toBeNull();
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Connected');
  });

  it.each([
    ['connected', { status: 'CONNECTED', registered: true }, 'Connected', 'badge-success'],
    ['not connected, with a status', { status: 'PENDING', registered: false }, 'Not connected (PENDING)', 'badge-danger'],
    ['not connected, no status', { status: null, registered: false }, 'Not connected', 'badge-danger'],
    ['unknown but Meta said a status', { status: 'RESTRICTED', registered: null }, 'Status: RESTRICTED', 'badge-neutral'],
    ['unknown, no status', { status: null, registered: null }, 'Unknown', 'badge-neutral'],
  ])('registration badge, %s', async (_name, reg, text, cls) => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: reg });
    await settle(fixture);
    const badge = ownReg(el)!.querySelector('.badge')!;
    expect(badge.textContent?.trim()).toBe(text);
    expect(badge.className).toContain(cls);
    // the same words for the shared number
    TestBed.resetTestingModule();
    const shared = await boot(status(), NUMBER({ status: reg.status, registered: reg.registered, message: null }));
    const sb = sharedRows(shared.el).reg!.querySelector('.badge')!;
    expect(sb.textContent?.trim()).toBe(text);
    expect(sb.className).toContain(cls);
  });

  it('a registration problem reaches the notice in amber, and an accepted connection stays green', async () => {
    const warn = await boot(OWN);
    warn.btn('Test connection').click();
    warn.http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_FALSE, message: NOT_REGISTERED_TEXT });
    await settle(warn.fixture);
    const wn = warn.el.querySelector('[data-test=wa-notice]')!;
    expect(wn.className).toContain('wa-msg');
    expect(wn.className).toContain('wa-warn');
    expect(wn.className).not.toContain('wa-ok');
    expect(wn.getAttribute('role')).toBe('status');
    TestBed.resetTestingModule();

    const ok = await boot(OWN);
    ok.btn('Test connection').click();
    ok.http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_TRUE });
    await settle(ok.fixture);
    const on = ok.el.querySelector('[data-test=wa-notice]')!;
    expect(on.textContent).toContain('WhatsApp accepted the connection');
    expect(on.className).toContain('wa-ok');
    expect(on.className).not.toContain('wa-warn');
  });

  it('a warning notice turns green again after the next clean result', async () => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: { ...OWN, tokenIsValid: false } });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-warn');
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_TRUE });
    await settle(fixture);
    expect(el.querySelector('[data-test=wa-notice]')?.className).toContain('wa-ok');
    expect(el.querySelector('[data-test=wa-notice]')?.className).not.toContain('wa-warn');
  });

  it('a different customer opened in the same component keeps nothing of the previous customer\'s registration', async () => {
    const { http, btn, el, fixture, cmp } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_FALSE });
    await settle(fixture);
    expect(ownReg(el)).not.toBeNull();
    // another customer with the same mode and the same last four digits
    fixture.componentRef.setInput('tenantId', 't2');
    fixture.componentRef.setInput('status', { ...OWN });
    await settle(fixture);
    expect(cmp.registration).toBeNull();
    expect(ownReg(el)).toBeNull();
  });

  it('a different customer on the platform number asks for the shared number again', async () => {
    const { http, el, fixture } = await boot(status(), NUMBER());
    http.expectNone((x) => isNumber(x));
    fixture.componentRef.setInput('tenantId', 't2');
    fixture.componentRef.setInput('status', status());
    await settle(fixture);
    http.expectOne((x) => isNumber(x)).flush({ number: CONNECTED });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Connected');
  });

  it('own mode shows no Registration row before the first check', async () => {
    const { el } = await boot(OWN);
    expect(ownReg(el)).toBeNull();
  });

  it('own mode: Test connection shows the Registration badge, and the warning reaches the notice', async () => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_FALSE, message: NOT_REGISTERED_TEXT });
    await settle(fixture);
    const badge = ownReg(el)!.querySelector('.badge')!;
    expect(badge.className).toContain('badge-danger');
    expect(badge.textContent?.trim()).toBe('Not connected (PENDING)');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain(NOT_REGISTERED_TEXT);
  });

  it('own mode: Verify and save shows the badge and the warning in the notice even though the token is valid', async () => {
    const { http, type, btn, el, fixture } = await boot(status());
    await type('wa-phone-id', '555666777');
    btn('Verify and save').click();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: OWN, registration: REG_FALSE, message: NOT_REGISTERED_TEXT });
    await settle(fixture);
    const notice = el.querySelector('[data-test=wa-notice]')?.textContent || '';
    expect(notice).toContain('Saved.');
    expect(notice).toContain(NOT_REGISTERED_TEXT);
    expect(notice).not.toContain('WhatsApp accepted the connection');
    expect(ownReg(el)!.querySelector('.badge')?.textContent?.trim()).toBe('Not connected (PENDING)');
    expect(el.querySelector('[data-test=wa-validity]')?.textContent).toContain('Valid');
  });

  it('own mode: a registered number gets the green badge and the usual success sentence', async () => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_TRUE });
    await settle(fixture);
    expect(ownReg(el)!.querySelector('.badge')?.className).toContain('badge-success');
    expect(el.querySelector('[data-test=wa-notice]')?.textContent).toContain('WhatsApp accepted the connection');
  });

  it('own mode: an unknown registration shows a neutral badge', async () => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: { status: null, registered: null } });
    await settle(fixture);
    expect(ownReg(el)!.querySelector('.badge')?.className).toContain('badge-neutral');
    expect(ownReg(el)!.querySelector('.badge')?.textContent?.trim()).toBe('Unknown');
  });

  it('switching back to the platform number drops the own registration and shows the shared number rows', async () => {
    const { http, btn, el, fixture, cmp } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_FALSE });
    await settle(fixture);
    expect(ownReg(el)).not.toBeNull();
    btn('Use platform number').click();
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((x) => x.url.endsWith('/api/platform/tenants/t1/whatsapp') && x.method === 'DELETE').flush({ whatsapp: status() });
    await settle(fixture);
    expect(cmp.registration).toBeNull();
    expect(ownReg(el)).toBeNull();
    http.expectOne((x) => isNumber(x)).flush({ number: CONNECTED });
    await settle(fixture);
    expect(sharedRows(el).reg!.querySelector('.badge')?.textContent?.trim()).toBe('Connected');
  });

  it('when the parent changes the status to another mode, the rows follow (no stale registration, shared number asked for)', async () => {
    const { http, btn, el, fixture } = await boot(OWN);
    btn('Test connection').click();
    http.expectOne((x) => x.url.endsWith('/whatsapp/verify')).flush({ whatsapp: OWN, registration: REG_TRUE });
    await settle(fixture);
    expect(ownReg(el)).not.toBeNull();
    fixture.componentRef.setInput('status', status());
    await settle(fixture);
    expect(ownReg(el)).toBeNull();
    http.expectOne((x) => isNumber(x)).flush({ number: NUMBER() });
    await settle(fixture);
    expect(sharedRows(el).reg).not.toBeNull();
    // and back to an own number: the shared rows go away and nothing is claimed about the new own number yet
    fixture.componentRef.setInput('status', OWN);
    await settle(fixture);
    expect(sharedRows(el).reg).toBeNull();
    expect(ownReg(el)).toBeNull();
  });

  it('the parent echoing our own saved status back does not wipe the registration we just learned', async () => {
    const { http, type, btn, el, fixture } = await boot(status());
    await type('wa-phone-id', '555666777');
    btn('Verify and save').click();
    http.expectOne((x) => PUT(x)).flush({ whatsapp: OWN, registration: REG_TRUE });
    await settle(fixture);
    fixture.componentRef.setInput('status', OWN); // what tenant-detail does with the statusChange event
    await settle(fixture);
    expect(ownReg(el)).not.toBeNull();
  });

  it('the token stays write-only when a registration warning comes back', async () => {
    const { cmp, http, type, btn, el, fixture } = await boot(status());
    await type('wa-phone-id', '555666777');
    await type('wa-waba-id', '111222333');
    await type('wa-token', SECRET);
    btn('Verify and save').click();
    expect(cmp.accessToken).toBe('');
    http.expectOne((x) => PUT(x)).flush({ whatsapp: OWN, registration: REG_FALSE, message: NOT_REGISTERED_TEXT });
    await settle(fixture);
    expect(el.innerHTML).not.toContain(SECRET);
    expect(cmp.accessToken).toBe('');
  });
});
