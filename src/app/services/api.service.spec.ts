import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';

// The ApiService calls behind the consent / opt-in screens. Nothing here reaches a network: every request is answered by
// the testing controller.

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { api: TestBed.inject(ApiService), http: TestBed.inject(HttpTestingController) };
}
const urlOf = (r: { request: { urlWithParams: string } }) => r.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/').replace(/^.*?(\/api\/)/, '$1');

describe('ApiService: consent and opt-in calls', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('getRecommendedCustomers', () => {
    it('without an audience asks for exactly what it always asked for', () => {
      const { api, http } = setup();
      api.getRecommendedCustomers('p1').subscribe();
      const req = http.expectOne((r) => /recommended-customers/.test(r.url));
      expect(urlOf(req)).toBe('/api/promotions/p1/recommended-customers?limit=100');
      req.flush([]);
      api.getRecommendedCustomers('p1', 25).subscribe();
      const req2 = http.expectOne((r) => /recommended-customers/.test(r.url));
      expect(urlOf(req2)).toBe('/api/promotions/p1/recommended-customers?limit=25');
      req2.flush([]);
    });

    it('with an audience adds it as a parameter', () => {
      const { api, http } = setup();
      api.getRecommendedCustomers('p1', 50, 'not_responded').subscribe();
      const req = http.expectOne((r) => /recommended-customers/.test(r.url));
      expect(urlOf(req)).toBe('/api/promotions/p1/recommended-customers?limit=50&audience=not_responded');
      req.flush([]);
    });

    it('an empty audience is the same as none', () => {
      const { api, http } = setup();
      api.getRecommendedCustomers('p1', 100, '').subscribe();
      const req = http.expectOne((r) => /recommended-customers/.test(r.url));
      expect(urlOf(req)).toBe('/api/promotions/p1/recommended-customers?limit=100');
      req.flush([]);
    });
  });

  describe('getCustomers', () => {
    it('passes the consent filter through', () => {
      const { api, http } = setup();
      api.getCustomers({ page: 1, limit: 50, consent: 'opted_out' }).subscribe();
      const req = http.expectOne((r) => /\/api\/customers/.test(r.url));
      expect(urlOf(req)).toBe('/api/customers?page=1&limit=50&consent=opted_out');
      req.flush({ customers: [], total: 0 });
    });
  });

  describe('getConsentLog', () => {
    it('GETs /customers/consent-log with only the filters that are set', () => {
      const { api, http } = setup();
      let got: any;
      api.getConsentLog({ status: 'opted_in', promotionId: 'p1', page: 2, limit: 100 }).subscribe((r) => (got = r));
      const req = http.expectOne((r) => /consent-log/.test(r.url));
      expect(req.request.method).toBe('GET');
      expect(urlOf(req)).toBe('/api/customers/consent-log?status=opted_in&promotionId=p1&page=2&limit=100');
      req.flush({ events: [{ type: 'consent_given' }], total: 1 });
      expect(got).toEqual({ events: [{ type: 'consent_given' }], total: 1 });
    });

    it('drops empty, null and undefined filters (they must not travel as the text "undefined")', () => {
      const { api, http } = setup();
      api.getConsentLog({ status: '', promotionId: undefined, page: null, limit: 20 }).subscribe();
      const req = http.expectOne((r) => /consent-log/.test(r.url));
      expect(urlOf(req)).toBe('/api/customers/consent-log?limit=20');
      req.flush({});
    });

    it('with no filter at all asks for the bare log', () => {
      const { api, http } = setup();
      api.getConsentLog().subscribe();
      const req = http.expectOne((r) => /consent-log/.test(r.url));
      expect(urlOf(req)).toBe('/api/customers/consent-log');
      req.flush({});
    });

    it('keeps a zero or false value (they are real values)', () => {
      const { api, http } = setup();
      api.getConsentLog({ page: 0, flag: false }).subscribe();
      const req = http.expectOne((r) => /consent-log/.test(r.url));
      expect(urlOf(req)).toBe('/api/customers/consent-log?page=0&flag=false');
      req.flush({});
    });
  });

  describe('downloadConsentLogCsv', () => {
    it('fetches the CSV as a Blob (a Bearer-auth export cannot be a plain link) with the filters', async () => {
      const { api, http } = setup();
      let got: Blob | undefined;
      api.downloadConsentLogCsv({ status: 'opted_out', promotionId: 'p1' }).subscribe((b) => (got = b));
      const req = http.expectOne((r) => /consent-log\.csv/.test(r.url));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      expect(urlOf(req)).toBe('/api/customers/consent-log.csv?status=opted_out&promotionId=p1');
      req.flush(new Blob(['a,b\n'], { type: 'text/csv' }));
      expect(got).toBeInstanceOf(Blob);
      expect(await got!.text()).toBe('a,b\n');
    });

    it('with no filter (or empty values) asks for the whole log', () => {
      const { api, http } = setup();
      api.downloadConsentLogCsv().subscribe();
      const a = http.expectOne((r) => /consent-log\.csv/.test(r.url));
      expect(urlOf(a)).toBe('/api/customers/consent-log.csv');
      a.flush(new Blob(['']));
      api.downloadConsentLogCsv({ status: '', promotionId: undefined }).subscribe();
      const b = http.expectOne((r) => /consent-log\.csv/.test(r.url));
      expect(urlOf(b)).toBe('/api/customers/consent-log.csv');
      b.flush(new Blob(['']));
    });
  });

  describe('getCustomerConsentEvents', () => {
    it('GETs the events of one customer and returns a plain array', () => {
      const { api, http } = setup();
      let got: any;
      api.getCustomerConsentEvents('c1').subscribe((r) => (got = r));
      const req = http.expectOne((r) => /consent-events/.test(r.url));
      expect(req.request.method).toBe('GET');
      expect(urlOf(req)).toBe('/api/customers/c1/consent-events');
      req.flush([{ type: 'consent_given' }, { type: 'consent_withdrawn' }]);
      expect(got).toEqual([{ type: 'consent_given' }, { type: 'consent_withdrawn' }]);
    });

    it('also accepts the events wrapped in an object, and an empty answer', () => {
      const { api, http } = setup();
      const results: any[] = [];
      api.getCustomerConsentEvents('c1').subscribe((r) => results.push(r));
      http.expectOne((r) => /consent-events/.test(r.url)).flush({ events: [{ type: 'consent_given' }] });
      api.getCustomerConsentEvents('c1').subscribe((r) => results.push(r));
      http.expectOne((r) => /consent-events/.test(r.url)).flush({});
      api.getCustomerConsentEvents('c1').subscribe((r) => results.push(r));
      http.expectOne((r) => /consent-events/.test(r.url)).flush(null);
      expect(results).toEqual([[{ type: 'consent_given' }], [], []]);
    });

    it('passes a failure on to the caller', () => {
      const { api, http } = setup();
      let status = 0;
      api.getCustomerConsentEvents('c1').subscribe({ error: (e) => (status = e.status) });
      http.expectOne((r) => /consent-events/.test(r.url)).flush({ error: 'nope' }, { status: 404, statusText: 'Not Found' });
      expect(status).toBe(404);
    });
  });

  describe('dismissSendRequest', () => {
    it('POSTs to the promotion\'s dismiss-send-request endpoint', () => {
      const { api, http } = setup();
      let got: any;
      api.dismissSendRequest('p1').subscribe((r) => (got = r));
      const req = http.expectOne((r) => /dismiss-send-request/.test(r.url));
      expect(req.request.method).toBe('POST');
      expect(urlOf(req)).toBe('/api/promotions/p1/dismiss-send-request');
      expect(req.request.body).toEqual({});
      req.flush({ success: true });
      expect(got).toEqual({ success: true });
    });
  });

  describe('existing calls the screens still rely on', () => {
    it('refreshMessageNodeTemplateStatus and submitMessageNodeTemplate keep their endpoints', () => {
      const { api, http } = setup();
      api.refreshMessageNodeTemplateStatus('n1').subscribe();
      const a = http.expectOne((r) => /refresh-status/.test(r.url));
      expect([a.request.method, urlOf(a)]).toEqual(['POST', '/api/message-nodes/n1/refresh-status']);
      a.flush({});
      api.submitMessageNodeTemplate('n1').subscribe();
      const b = http.expectOne((r) => /submit-template/.test(r.url));
      expect([b.request.method, urlOf(b)]).toEqual(['POST', '/api/message-nodes/n1/submit-template']);
      b.flush({});
    });

    it('getCampaignReport returns the consent block untouched', () => {
      const { api, http } = setup();
      let got: any;
      api.getCampaignReport('p1').subscribe((r) => (got = r));
      http.expectOne((r) => /\/report$/.test(r.url)).flush({ messagesSent: 3, consent: { optIns: 2, optOuts: 0, interested: 1, otherTaps: 0, optInRate: 66.7, optOutRate: 0 } });
      expect(got.consent).toEqual({ optIns: 2, optOuts: 0, interested: 1, otherTaps: 0, optInRate: 66.7, optOutRate: 0 });
    });
  });
});
