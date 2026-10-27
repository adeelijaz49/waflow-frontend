import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, Subject, map, of, throwError } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { Customers } from './customers';

// Consent column, consent filter, consent history and consent-log export on the Customers screen.
// ApiService is stubbed: the consent methods are added to the real service by the Promotions work
// (getCustomers(consent), downloadConsentLogCsv, getCustomerConsentEvents).

vi.setConfig({ testTimeout: 30000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROWS = [
  { _id: 'c1', firstname: 'Aisha', lastname: 'Khan', phone: '966500000001', orderCount: 1, totalSpent: 100, loyaltyPoints: 0,
    marketingConsent: true, optedOut: false, consentStatus: 'opted_in', consentAt: '2026-10-01T10:00:00.000Z', consentSource: 'Tapped "Yes, send me offers" on Eid offer' },
  { _id: 'c2', firstname: 'Omar', lastname: 'Ali', phone: '966500000002', orderCount: 0, totalSpent: 0, loyaltyPoints: 0,
    marketingConsent: true, optedOut: true, consentStatus: 'opted_out', consentAt: '2026-10-05T10:00:00.000Z', consentSource: 'Replied STOP' },
  { _id: 'c3', firstname: 'Sara', lastname: 'Noor', phone: '966500000003', orderCount: 0, totalSpent: 0, loyaltyPoints: 0,
    marketingConsent: false, optedOut: false, consentStatus: 'not_responded', consentAt: null, consentSource: null },
];

const DETAIL = (id = 'c3') => ({ ...ROWS.find((r) => r._id === id)!, orders: [] });

interface Stub {
  getCustomers: ReturnType<typeof vi.fn>;
  getCustomer: ReturnType<typeof vi.fn>;
  getInsights: ReturnType<typeof vi.fn>;
  getLoyaltySettings: ReturnType<typeof vi.fn>;
  markCustomerConsented: ReturnType<typeof vi.fn>;
  getCustomerWhatsAppHistory: ReturnType<typeof vi.fn>;
  getCustomerBookings: ReturnType<typeof vi.fn>;
  createCustomer: ReturnType<typeof vi.fn>;
  downloadConsentLogCsv: ReturnType<typeof vi.fn>;
  getCustomerConsentEvents: ReturnType<typeof vi.fn>;
}

function makeStub(over: Partial<Stub> = {}): Stub {
  return {
    getCustomers: vi.fn(() => of({ customers: ROWS.map((r) => ({ ...r })), total: ROWS.length, pages: 1 })),
    getCustomer: vi.fn((id: string) => of(DETAIL(id))),
    getInsights: vi.fn(() => of([])),
    getLoyaltySettings: vi.fn(() => of({})), // read by the currency pipe's SettingsService
    markCustomerConsented: vi.fn((id: string) => of({ ...DETAIL(id), marketingConsent: true, marketingConsentAt: '2026-10-26T09:00:00.000Z', marketingConsentMethod: 'manual_staff_entry' })),
    getCustomerWhatsAppHistory: vi.fn(() => of([])),
    getCustomerBookings: vi.fn(() => of([])),
    createCustomer: vi.fn(() => of({})),
    downloadConsentLogCsv: vi.fn(() => of(new Blob(['a,b'], { type: 'text/csv' }))),
    getCustomerConsentEvents: vi.fn(() => of([])),
    ...over,
  };
}

async function boot(stub: Stub) {
  localStorage.clear(); // no token: the language-flag service makes no request
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ApiService, useValue: stub }],
  });
  const fixture = TestBed.createComponent(Customers);
  fixture.detectChanges();
  const comp = fixture.componentInstance;
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      await fixture.whenStable();
      await sleep(0);
    }
  };
  await settle();
  return { fixture, comp, el, settle };
}

const lastParams = (stub: Stub) => stub.getCustomers.mock.calls[stub.getCustomers.mock.calls.length - 1][0];
const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Customers screen: consent column', () => {
  it('renders one badge per status with the date, and the source as a tooltip', async () => {
    const { el } = await boot(makeStub());
    const rows = Array.from(el.querySelectorAll('tbody tr'));
    expect(rows.length).toBe(3);
    expect(Array.from(el.querySelectorAll('thead th')).map((t) => text(t))).toEqual(['Name', 'Phone', 'Consent', 'Orders', 'Total Spent', 'Loyalty Pts', 'Last Order']);

    const cells = rows.map((r) => r.querySelector('td.consent-cell')!);
    expect(text(cells[0].querySelector('.badge'))).toBe('Opted in');
    expect(text(cells[0].querySelector('.consent-date'))).toBe('1 Oct 2026');
    expect(cells[0].querySelector('.badge')!.classList.contains('badge-success')).toBe(true);
    expect(cells[0].getAttribute('title')).toBe('Opted in - Tapped "Yes, send me offers" on Eid offer');

    expect(text(cells[1].querySelector('.badge'))).toBe('Opted out');
    expect(text(cells[1].querySelector('.consent-date'))).toBe('5 Oct 2026');
    expect(cells[1].querySelector('.badge')!.classList.contains('badge-danger')).toBe(true);
    expect(cells[1].getAttribute('title')).toBe('Opted out - Replied STOP');

    expect(text(cells[2])).toBe('Not responded');
    expect(cells[2].querySelector('.badge')!.classList.contains('badge-neutral')).toBe(true);
    expect(cells[2].querySelector('.consent-date')).toBeNull();
    expect(cells[2].getAttribute('title')).toContain('not agreed to or declined');
  });

  it('falls back to the customer flags when a row carries no consentStatus', async () => {
    const stub = makeStub({
      getCustomers: vi.fn(() => of({
        customers: [
          { _id: 'a', firstname: 'A', phone: '1', marketingConsent: true },
          { _id: 'b', firstname: 'B', phone: '2', optedOut: true, marketingConsent: true },
          { _id: 'd', firstname: 'D', phone: '3' },
        ], total: 3, pages: 1,
      })),
    });
    const { el } = await boot(stub);
    const labels = Array.from(el.querySelectorAll('td.consent-cell .badge')).map((b) => text(b));
    expect(labels).toEqual(['Opted in', 'Opted out', 'Not responded']);
    expect(el.querySelectorAll('td.consent-date, .consent-date').length).toBe(0); // no date when the row has none
  });

  it('keeps the existing "Opted Out" badge next to the name and a seven column empty state', async () => {
    const { el } = await boot(makeStub());
    expect(text(el.querySelectorAll('tbody tr')[1].querySelector('td.fw-600'))).toBe('Omar Ali Opted Out');
    const { el: el2 } = await boot(makeStub({ getCustomers: vi.fn(() => of({ customers: [], total: 0, pages: 1 })) }));
    expect(el2.querySelector('td.empty-state')!.getAttribute('colspan')).toBe('7');
  });
});

describe('Customers screen: consent filter', () => {
  it('opens with no consent parameter and the select offers the four choices', async () => {
    const stub = makeStub();
    const { el } = await boot(stub);
    expect(stub.getCustomers).toHaveBeenCalledTimes(1);
    expect(stub.getCustomers.mock.calls[0][0]).toEqual({ page: 1, limit: 50 });
    const select = el.querySelector<HTMLSelectElement>('.search-bar select.consent-filter')!;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['all', 'opted_in', 'opted_out', 'not_responded']);
    expect(select.value).toBe('all');
  });

  it('choosing a status sends the consent param and goes back to page 1', async () => {
    const stub = makeStub({ getCustomers: vi.fn(() => of({ customers: ROWS, total: 120, pages: 3 })) });
    const { comp, el, settle } = await boot(stub);
    comp.nextPage();
    comp.nextPage();
    await settle();
    expect(lastParams(stub).page).toBe(3);
    const before = stub.getCustomers.mock.calls.length;

    const select = el.querySelector<HTMLSelectElement>('select.consent-filter')!;
    select.value = 'opted_out';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(stub.getCustomers.mock.calls.length).toBe(before + 1);
    expect(lastParams(stub)).toEqual({ page: 1, limit: 50, consent: 'opted_out' });
    expect(comp.page).toBe(1);
  });

  it('keeps the search text and the Smart Insights ids alongside the consent filter, and drops consent for "all"', async () => {
    const stub = makeStub();
    const { comp, settle } = await boot(stub);
    (comp as any).filterIds = ['x1', 'x2'];
    comp.search = 'ais';
    comp.consentFilter = 'not_responded';
    comp.onConsentFilter();
    await settle();
    expect(lastParams(stub)).toEqual({ page: 1, limit: 50, search: 'ais', ids: 'x1,x2', consent: 'not_responded' });
    comp.consentFilter = 'all';
    comp.onConsentFilter();
    await settle();
    expect('consent' in lastParams(stub)).toBe(false);
  });

  it('typing in the search box keeps the chosen consent filter', async () => {
    const stub = makeStub();
    const { comp, settle } = await boot(stub);
    comp.consentFilter = 'opted_in';
    comp.search = 'sa';
    comp.onSearch();
    await settle();
    expect(lastParams(stub)).toEqual({ page: 1, limit: 50, search: 'sa', consent: 'opted_in' });
  });

  it('ignores a slow answer that arrives after a newer filter answer', async () => {
    const slow = new Subject<any>();
    const fast = new Subject<any>();
    const queue = [of({ customers: ROWS, total: 3, pages: 1 }), slow, fast];
    const stub = makeStub({ getCustomers: vi.fn(() => queue.shift() as Observable<any>) });
    const { comp, settle } = await boot(stub);
    comp.consentFilter = 'opted_in';
    comp.onConsentFilter(); // -> slow
    comp.consentFilter = 'opted_out';
    comp.onConsentFilter(); // -> fast
    fast.next({ customers: [ROWS[1]], total: 1, pages: 1 });
    await settle();
    slow.next({ customers: [ROWS[0]], total: 1, pages: 1 });
    await settle();
    expect(comp.customers.map((c) => c._id)).toEqual(['c2']);
    expect(comp.loading).toBe(false);
  });

  it('a failing list call stops the spinner', async () => {
    const queue: Observable<any>[] = [of({ customers: ROWS, total: 3, pages: 1 }), throwError(() => new Error('boom'))];
    const stub = makeStub({ getCustomers: vi.fn(() => queue.shift() as Observable<any>) });
    const { comp, settle } = await boot(stub);
    comp.consentFilter = 'opted_in';
    comp.onConsentFilter();
    await settle();
    expect(comp.loading).toBe(false);
  });
});

describe('Customers screen: consent history in the detail panel', () => {
  // The rows exactly as GET /api/customers/:id/consent-events returns them (shared/operations.js consentLogRow): ids as `id`, times as
  // eventTimeUtc (when the customer tapped, else when it was recorded) and recordedAtUtc, every text field present (empty when unused).
  const row = (over: Record<string, unknown>) => ({ id: '', eventTimeUtc: null, recordedAtUtc: null, customerId: 'c3', customerName: 'Sara Test', phone: '966500000003', type: '', method: '', source: '',
    promotionId: '', promotionName: '', messageText: '', buttonLabel: '', buttonAction: '', sourceWamid: '', inboundWamid: '', signature: '', ...over });
  const EVENTS = [
    row({ id: 'e3', type: 'consent_reinstated', method: 'whatsapp_start_command', source: 'WhatsApp START reply', messageText: 'START',
      eventTimeUtc: '2026-10-06T10:00:00.000Z', recordedAtUtc: '2026-10-06T10:00:01.000Z' }),
    row({ id: 'e2', type: 'consent_withdrawn', method: 'whatsapp_stop_command', source: 'Replied STOP', eventTimeUtc: '2026-10-05T10:00:00.000Z', recordedAtUtc: '2026-10-05T10:00:00.000Z' }),
    row({ id: 'e1', type: 'consent_given', method: 'whatsapp_button', source: 'Promotion button', promotionName: 'Eid offer', buttonLabel: 'Yes, send me offers', buttonAction: 'opt_in',
      messageText: 'Hi Sara, want offers on WhatsApp?', eventTimeUtc: '2026-10-01T10:00:00.000Z', recordedAtUtc: '2026-10-01T10:05:00.000Z' }),
  ];

  it('opening a profile does not ask for the history; the tab does, once', async () => {
    const stub = makeStub({ getCustomerConsentEvents: vi.fn(() => of(EVENTS)) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    expect(stub.getCustomerConsentEvents).not.toHaveBeenCalled();
    expect(el.querySelector('.consent-events')).toBeNull();

    const tab = Array.from(el.querySelectorAll<HTMLButtonElement>('.detail-tabs .tab-btn')).find((b) => text(b) === 'Consent History')!;
    tab.click();
    await settle();
    expect(stub.getCustomerConsentEvents).toHaveBeenCalledTimes(1);
    expect(stub.getCustomerConsentEvents).toHaveBeenCalledWith('c3');

    const cards = Array.from(el.querySelectorAll('.consent-event'));
    expect(cards.length).toBe(3);
    // newest first, as the server sends them: a START after a STOP is "Opted in again" (a fresh opt-in), shown like an opt-in
    expect(text(cards[0])).toContain('Opted in again');
    expect(text(cards[0])).toContain('WhatsApp START reply');
    expect(cards[0].querySelector('.badge')!.className).toContain('badge-success');
    expect(text(cards[1])).toContain('Opted out');
    expect(text(cards[1])).toContain('Replied STOP');
    expect(cards[1].querySelector('.badge')!.className).toContain('badge-danger');
    expect(text(cards[2])).toContain('Opted in');
    expect(text(cards[2])).not.toContain('Opted in again');
    expect(text(cards[2])).toContain('Eid offer');
    expect(text(cards[2])).toContain('Tapped: “Yes, send me offers”');
    expect(text(cards[2])).toContain('Hi Sara, want offers on WhatsApp?');
    expect(text(cards[2])).toContain('01 Oct 2026'); // eventTimeUtc (the tap time) is what is shown, not the record time

    // leaving and coming back does not reload
    comp.openDetailTab('orders');
    comp.openDetailTab('consent');
    await settle();
    expect(stub.getCustomerConsentEvents).toHaveBeenCalledTimes(1);
  });

  it('shows an empty message, and the event text is rendered as plain text (not HTML)', async () => {
    const stub = makeStub();
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    comp.openDetailTab('consent');
    await settle();
    expect(text(el.querySelector('.consent-events'))).toContain('No consent events recorded for this customer yet');

    const evil = makeStub({ getCustomerConsentEvents: vi.fn(() => of([{ _id: 'x', type: 'consent_given', messageText: '<img src=x onerror=alert(1)>' }])) });
    const b = await boot(evil);
    b.comp.viewDetail(ROWS[2]);
    await b.settle();
    b.comp.openDetailTab('consent');
    await b.settle();
    expect(b.el.querySelector('.consent-event img')).toBeNull();
    expect(text(b.el.querySelector('.consent-message'))).toContain('<img src=x');
  });

  it('a failed load shows a retry that asks again', async () => {
    const queue: Observable<any[]>[] = [throwError(() => new Error('500')), of(EVENTS)];
    const stub = makeStub({ getCustomerConsentEvents: vi.fn(() => queue.shift()!) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    comp.openDetailTab('consent');
    await settle();
    expect(text(el)).toContain('Consent history could not be loaded.');
    expect(el.querySelectorAll('.consent-event').length).toBe(0);
    const retry = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === 'Try again')!;
    retry.click();
    await settle();
    expect(stub.getCustomerConsentEvents).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('.consent-event').length).toBe(3);
  });

  it('a history that arrives after another customer was opened is dropped', async () => {
    const slow = new Subject<any[]>();
    const stub = makeStub({ getCustomerConsentEvents: vi.fn((id: string) => (id === 'c3' ? slow : of([{ _id: 'mine', type: 'consent_given' }]))) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    comp.openDetailTab('consent'); // c3, still loading
    comp.viewDetail(ROWS[0]);
    await settle();
    comp.openDetailTab('consent'); // c1
    await settle();
    slow.next([{ _id: 'late', type: 'consent_withdrawn' }]);
    await settle();
    expect(comp.consentEvents.map((e) => e._id)).toEqual(['mine']);
    expect(el.querySelectorAll('.consent-event').length).toBe(1);
  });
});

describe('Customers screen: export consent log', () => {
  let click: ReturnType<typeof vi.spyOn>;
  let created: Blob[];
  let anchors: HTMLAnchorElement[];
  const urlApi = URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
  const realCreate = urlApi.createObjectURL;
  const realRevoke = urlApi.revokeObjectURL;
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    anchors = [];
    revoke = vi.fn();
    urlApi.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:consent-log'; });
    urlApi.revokeObjectURL = revoke;
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this); });
  });
  afterEach(() => {
    click.mockRestore();
    urlApi.createObjectURL = realCreate;
    urlApi.revokeObjectURL = realRevoke;
  });

  it('sits in the header between Import CSV and Add Customer', async () => {
    const { el } = await boot(makeStub());
    const items = Array.from(el.querySelectorAll('.page-header .btn')).map((b) => text(b));
    expect(items).toEqual(['⬆ Import CSV', '⬇ Export consent log (CSV)', '+ Add Customer']);
  });

  it('clicking downloads the blob from the API as a dated CSV file', async () => {
    const blob = new Blob(['eventTimeUtc,customerName\n'], { type: 'text/csv' });
    const stub = makeStub({ downloadConsentLogCsv: vi.fn(() => of(blob)) });
    const { el, settle } = await boot(stub);
    el.querySelector<HTMLButtonElement>('#export-consent-log')!.click();
    await settle();
    expect(stub.downloadConsentLogCsv).toHaveBeenCalledTimes(1);
    expect(stub.downloadConsentLogCsv).toHaveBeenCalledWith();
    expect(created).toEqual([blob]);
    expect(anchors.length).toBe(1);
    expect(anchors[0].download).toMatch(/^consent-log-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(anchors[0].getAttribute('href')).toBe('blob:consent-log');
    expect(revoke).toHaveBeenCalledWith('blob:consent-log');
    expect(el.querySelector('.export-error')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('#export-consent-log')!.disabled).toBe(false);
  });

  it('is disabled while the file is being fetched, so a double click asks once', async () => {
    const pending = new Subject<Blob>();
    const stub = makeStub({ downloadConsentLogCsv: vi.fn(() => pending) });
    const { comp, el, settle } = await boot(stub);
    const btn = el.querySelector<HTMLButtonElement>('#export-consent-log')!;
    btn.click();
    await settle();
    expect(btn.disabled).toBe(true);
    expect(text(btn)).toBe('Exporting...');
    comp.exportConsentLog(); // a second trigger while in flight is ignored
    expect(stub.downloadConsentLogCsv).toHaveBeenCalledTimes(1);
    pending.next(new Blob(['x']));
    pending.complete();
    await settle();
    expect(anchors.length).toBe(1);
    expect(btn.disabled).toBe(false);
  });

  it('shows a message and re-enables the button when the download fails, and clears it on the next try', async () => {
    const queue: Observable<Blob>[] = [throwError(() => ({ status: 500 })), of(new Blob(['ok']))];
    const stub = makeStub({ downloadConsentLogCsv: vi.fn(() => queue.shift()!) });
    const { el, settle } = await boot(stub);
    el.querySelector<HTMLButtonElement>('#export-consent-log')!.click();
    await settle();
    expect(anchors.length).toBe(0);
    expect(text(el.querySelector('.export-error'))).toBe('The consent log could not be downloaded. Please try again.');
    expect(el.querySelector<HTMLButtonElement>('#export-consent-log')!.disabled).toBe(false);

    el.querySelector<HTMLButtonElement>('#export-consent-log')!.click();
    await settle();
    expect(anchors.length).toBe(1);
    expect(el.querySelector('.export-error')).toBeNull();
  });

  it('shows a message when the browser cannot save the file', async () => {
    urlApi.createObjectURL = vi.fn(() => { throw new Error('no blob urls'); });
    const { el, settle } = await boot(makeStub());
    el.querySelector<HTMLButtonElement>('#export-consent-log')!.click();
    await settle();
    expect(text(el.querySelector('.export-error'))).toBe('The consent log could not be saved. Please try again.');
    expect(el.querySelector<HTMLButtonElement>('#export-consent-log')!.disabled).toBe(false);
  });
});

describe('Customers screen: Mark as consented is unchanged', () => {
  const markButton = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('.customer-meta button')).find((b) => /Mark(ing)?/.test(text(b)));

  it('is offered only for a customer who has not consented', async () => {
    const { comp, el, settle } = await boot(makeStub());
    comp.viewDetail(ROWS[0]);
    await settle();
    expect(markButton(el)).toBeUndefined();
    expect(text(el.querySelector('.customer-meta'))).toContain('Consented');
    comp.viewDetail(ROWS[1]);
    await settle();
    expect(markButton(el)).toBeUndefined();
    expect(text(el.querySelector('.customer-meta'))).toContain('Opted out');
    comp.viewDetail(ROWS[2]);
    await settle();
    expect(text(markButton(el))).toBe('Mark as consented');
    expect(el.querySelectorAll('.customer-meta .meta-item').length).toBe(4);
  });

  it('calls the same endpoint once, updates the profile and the list row, and makes no consent-history request', async () => {
    const saving = new Subject<any>();
    const stub = makeStub({ markCustomerConsented: vi.fn((id: string) => saving.pipe(map(() => ({ ...DETAIL(id), marketingConsent: true, marketingConsentAt: '2026-10-26T09:00:00.000Z', marketingConsentMethod: 'manual_staff_entry' })))) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    markButton(el)!.click();
    await settle();
    expect(text(markButton(el))).toBe('Marking...');
    expect(markButton(el)!.disabled).toBe(true);
    comp.markConsented(); // a second trigger while saving is ignored
    saving.next(null);
    await settle();
    expect(stub.markCustomerConsented).toHaveBeenCalledTimes(1);
    expect(stub.markCustomerConsented).toHaveBeenCalledWith('c3');
    expect(text(el.querySelector('.customer-meta'))).toContain('Consented');
    expect(markButton(el)).toBeUndefined();
    expect(comp.markingConsented).toBe(false);
    expect(stub.getCustomerConsentEvents).not.toHaveBeenCalled();
    // the list row now reads Opted in with the new date
    const cell = el.querySelectorAll('tbody tr')[2].querySelector('td.consent-cell')!;
    expect(text(cell.querySelector('.badge'))).toBe('Opted in');
    expect(text(cell.querySelector('.consent-date'))).toBe('26 Oct 2026');
  });

  it('reloads the consent history afterwards when that tab is open', async () => {
    const queue: Observable<any[]>[] = [of([]), of([{ _id: 'new', type: 'consent_given', source: 'Marked by staff' }])];
    const stub = makeStub({ getCustomerConsentEvents: vi.fn(() => queue.shift()!) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    comp.openDetailTab('consent');
    await settle();
    expect(el.querySelectorAll('.consent-event').length).toBe(0);
    markButton(el)!.click();
    await settle();
    expect(stub.getCustomerConsentEvents).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('.consent-event').length).toBe(1);
  });

  it('a failure leaves the customer as it was and re-enables the button', async () => {
    const stub = makeStub({ markCustomerConsented: vi.fn(() => throwError(() => ({ status: 500 }))) });
    const { comp, el, settle } = await boot(stub);
    comp.viewDetail(ROWS[2]);
    await settle();
    markButton(el)!.click();
    await settle();
    expect(comp.markingConsented).toBe(false);
    expect(text(markButton(el))).toBe('Mark as consented');
    expect(text(el.querySelectorAll('tbody tr')[2].querySelector('td.consent-cell'))).toBe('Not responded');
  });
});
