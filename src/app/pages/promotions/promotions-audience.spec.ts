import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { Promotions } from './promotions';

// The consent side of the campaign panel: the audience filter, the "No opt-in" tag and disabled checkbox, the warning about
// selected customers who will be skipped, the skipped counters of a send, the preview of every button and the consent
// numbers of the Campaign Report. None of it adds a request on opening the page.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = { arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Handler = (req: TestRequest, path: string) => unknown;
const pathOf = (req: TestRequest) => req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/').replace(/^.*?(\/api\/)/, '$1');

async function boot() {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const fixture = TestBed.createComponent(Promotions);
  fixture.detectChanges();
  const settle = async (handler?: Handler) => {
    for (let i = 0; i < 5; i++) {
      for (const req of http.match(() => true)) {
        const path = pathOf(req);
        seen.push(`${req.request.method} ${path}`);
        const custom = handler ? handler(req, path) : undefined;
        if (custom !== undefined) req.flush(custom);
        else if (/localization\/settings/.test(path)) req.flush(SETTINGS);
        else if (/\/products\?/.test(path)) req.flush({ products: [], total: 0 });
        else if (/\/api\/customers\?/.test(path)) req.flush({ customers: [], total: 0 });
        else req.flush([]);
      }
      fixture.componentRef.changeDetectorRef.markForCheck(); // zoneless test bed: plain-field state changes need a dirty mark
      fixture.detectChanges();
      await fixture.whenStable();
      await sleep(0);
    }
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  await settle();
  const initial = [...seen];
  seen.length = 0;
  const el = fixture.nativeElement as HTMLElement;
  const text = () => (el.textContent || '').replace(/\s+/g, ' ');
  return { fixture, comp: fixture.componentInstance, el, seen, initial, settle, text, http };
}
type Ctx = Awaited<ReturnType<typeof boot>>;
const button = (el: HTMLElement, label: string) =>
  (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().includes(label));

const PROMO = { _id: 'p1', name: 'Eid sale', status: 'draft', sentCount: 0, customerType: 'cash', entryNodeId: null };
const CONSENT = { ...PROMO, _id: 'pc', name: 'Opt in', purpose: 'consent_request', campaignType: 'consent_request' };
const cust = (id: string, over: Record<string, unknown> = {}) => ({ _id: id, firstname: id.toUpperCase(), lastname: 'Test', phone: `+97150000${id.length}`, loyaltyPoints: 0, orderCount: 1, totalSpent: 10, segment: 'Best customers to target', rfmScore: 1, ...over });
const OPTED_IN = (id: string) => cust(id, { marketingConsent: true, optedOut: false });
const NO_OPT_IN = (id: string) => cust(id, { marketingConsent: false, optedOut: false });
const OPTED_OUT = (id: string) => cust(id, { marketingConsent: true, optedOut: true });

const recUrl = /^GET \/api\/promotions\/(p1|pc)\/recommended-customers/;
const WARN = /selected customers? (have|has) not opted in and will be skipped - create a Consent request to ask them/;

const rows = (ctx: Ctx) => Array.from(ctx.el.querySelectorAll('.rec-row')) as HTMLElement[];
const rowOf = (ctx: Ctx, name: string) => rows(ctx).find((r) => (r.textContent || '').includes(name))!;
const checkbox = (row: HTMLElement) => row.querySelector('input[type="checkbox"]') as HTMLInputElement;

async function openWithRecs(ctx: Ctx, promo: any, recs: any[]) {
  ctx.comp.openCampaign(promo);
  await ctx.settle((req, path) => (recUrl.test(`${req.request.method} ${path}`) ? recs : undefined));
}

describe('Promotions screen: consent audience', () => {
  describe('requests', () => {
    it('opening the page and a standard promotion asks for exactly what it always asked for', async () => {
      const ctx = await boot();
      expect(ctx.initial.some((s) => /consent|audience/.test(s))).toBe(false);
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      expect(ctx.seen).toContain('GET /api/promotions/p1/recommended-customers?limit=100');
      expect(ctx.seen.some((s) => /consent|audience/.test(s))).toBe(false);
    });

    it('a consent request starts on "Not yet responded"', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(CONSENT);
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('not_responded');
      expect(ctx.seen).toContain('GET /api/promotions/pc/recommended-customers?limit=100&audience=not_responded');
    });

    it('choosing an audience reloads the visible list with that filter, and the All Customers tab only when it is opened', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.seen.length = 0;
      ctx.comp.setAudienceFilter('opted_in');
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/promotions/p1/recommended-customers?limit=100&audience=opted_in']);

      ctx.seen.length = 0;
      ctx.comp.switchCustomerView('all');
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/customers?isDemo=false&page=1&limit=50&consent=opted_in']);

      ctx.seen.length = 0;
      ctx.comp.setAudienceFilter('not_responded'); // on the All tab now: reloads that list, page 1
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/customers?isDemo=false&page=1&limit=50&consent=not_responded']);

      ctx.seen.length = 0;
      ctx.comp.switchCustomerView('recommended'); // the Recommended list was left on the old filter: it reloads
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/promotions/p1/recommended-customers?limit=100&audience=not_responded']);
    });

    it('"All customers" goes back to the unfiltered requests, and an empty search is not sent as the word undefined', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.comp.setAudienceFilter('opted_in');
      await ctx.settle();
      ctx.seen.length = 0;
      ctx.comp.setAudienceFilter('');
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/promotions/p1/recommended-customers?limit=100']);
      ctx.comp.switchCustomerView('all');
      await ctx.settle();
      expect(ctx.seen).toContain('GET /api/customers?isDemo=false&page=1&limit=50');
      ctx.seen.length = 0;
      ctx.comp.allCustomersSearch = 'Sam';
      ctx.comp.searchAllCustomers();
      await ctx.settle();
      expect(ctx.seen).toEqual(['GET /api/customers?isDemo=false&page=1&limit=50&search=Sam']);
    });

    it('an unknown filter value is treated as "everyone"', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.comp.setAudienceFilter('bogus');
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('');
    });

    it('only the NEWEST request fills a list: a slow answer to an older audience filter arriving last cannot overwrite it (recommended list)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.comp.setAudienceFilter('opted_in');
      ctx.comp.setAudienceFilter('not_responded'); // changed again before the first answer came back
      const [older, newer] = ctx.http.match((r) => /recommended-customers/.test(r.url));
      expect(older.request.urlWithParams).toContain('audience=opted_in');
      expect(newer.request.urlWithParams).toContain('audience=not_responded');
      newer.flush([NO_OPT_IN('newer')]);
      older.flush([OPTED_IN('older')]); // late
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('not_responded');
      expect(ctx.comp.recommendedCustomers.map((c: any) => c._id)).toEqual(['newer']);
      expect(ctx.comp.loadingRecs).toBe(false);
    });

    it('the same for the All Customers list (filter and page)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.comp.switchCustomerView('all');
      await ctx.settle();
      ctx.comp.setAudienceFilter('opted_in');
      ctx.comp.setAudienceFilter('opted_out');
      const [older, newer] = ctx.http.match((r) => /\/api\/customers\?/.test(r.urlWithParams));
      expect(older.request.urlWithParams).toContain('consent=opted_in');
      expect(newer.request.urlWithParams).toContain('consent=opted_out');
      newer.flush({ customers: [OPTED_OUT('newer')], total: 1 });
      older.flush({ customers: [OPTED_IN('older'), OPTED_IN('older2')], total: 2 });
      await ctx.settle();
      expect(ctx.comp.allCustomers.map((c: any) => c._id)).toEqual(['newer']);
      expect(ctx.comp.allCustomersTotal).toBe(1);
      expect(ctx.comp.loadingAllCustomers).toBe(false);
    });

    // What the panel asks for when a promotion is opened: its customers, the message preview and (once sent) the report.
    const panelRequests = (promoId: string) => (r: { url: string }) => new RegExp(`/promotions/${promoId}/(recommended-customers|preview|report)`).test(r.url);

    it('opening another promotion drops what the previous one was still loading: its customers, preview and report cannot land on the new one', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...PROMO, _id: 'pold', name: 'Old', sentCount: 2 });
      const held = ctx.http.match(panelRequests('pold')); // all three still on their way
      expect(held).toHaveLength(3);
      ctx.comp.openCampaign({ ...PROMO, _id: 'pnew', name: 'New', sentCount: 0 }); // the merchant moved on
      expect(ctx.comp.loadingReport).toBe(false); // the old report's spinner is not left behind
      for (const req of held) {
        if (/recommended-customers/.test(req.request.url)) req.flush([NO_OPT_IN('old1')]);
        else if (/preview/.test(req.request.url)) req.flush({ message: 'OLD MESSAGE', buttons: [] });
        else req.flush({ messagesSent: 99, name: 'OLD REPORT' });
      }
      await ctx.settle((req, path) => (/\/promotions\/pnew\/recommended-customers/.test(path) ? [NO_OPT_IN('new1')] : /\/promotions\/pnew\/preview/.test(path) ? { message: 'NEW MESSAGE', buttons: [] } : undefined));
      expect(ctx.comp.recommendedCustomers.map((c: any) => c._id)).toEqual(['new1']);
      expect(ctx.comp.preview?.message).toBe('NEW MESSAGE');
      expect(ctx.comp.campaignReport).toBeNull(); // the new promotion has not been sent: the old one's numbers are not shown
      expect(ctx.text()).not.toContain('OLD MESSAGE');
      expect(ctx.comp.loadingRecs).toBe(false);
      expect(ctx.comp.loadingPreview).toBe(false);
    });

    it('an All Customers answer that arrives after another promotion was opened (or the audience went back to the recommended list) does not refill the list', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      ctx.comp.switchCustomerView('all');
      const [slow] = ctx.http.match((r) => /\/api\/customers\?/.test(r.urlWithParams));
      ctx.comp.openCampaign({ ...PROMO, _id: 'p2', name: 'Other' }); // all list emptied, view back to recommended
      slow.flush({ customers: [OPTED_IN('stale')], total: 1 });
      await ctx.settle();
      expect(ctx.comp.allCustomers).toEqual([]);
      expect(ctx.comp.loadingAllCustomers).toBe(false);
      ctx.comp.switchCustomerView('all'); // so the next click on "All" loads it for THIS promotion instead of showing a stale list
      await ctx.settle((req, path) => (/\/api\/customers\?/.test(path) ? { customers: [OPTED_IN('fresh')], total: 1 } : undefined));
      expect(ctx.comp.allCustomers.map((c: any) => c._id)).toEqual(['fresh']);

      // and the same when the audience filter is changed on the recommended tab while an All answer is still on its way
      ctx.comp.switchCustomerView('recommended');
      await ctx.settle();
      ctx.comp.allCustomers = [];
      ctx.comp.switchCustomerView('all');
      const [late] = ctx.http.match((r) => /\/api\/customers\?/.test(r.urlWithParams));
      ctx.comp.switchCustomerView('recommended');
      ctx.comp.setAudienceFilter('opted_in');
      late.flush({ customers: [OPTED_OUT('late')], total: 1 });
      await ctx.settle();
      expect(ctx.comp.allCustomers).toEqual([]);
      expect(ctx.comp.loadingAllCustomers).toBe(false);
    });

    it('closing the panel before the recommended list arrives is harmless (nothing throws, nothing is selected, no spinner is left)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...PROMO, campaignType: 'win_back' });
      const [held] = ctx.http.match((r) => /recommended-customers/.test(r.url));
      ctx.comp.closeCampaign();
      expect(() => held.flush([NO_OPT_IN('late')])).not.toThrow();
      await ctx.settle();
      expect(ctx.comp.activePromo).toBeNull();
      expect(ctx.comp.recommendedCustomers).toEqual([]);
      expect(ctx.comp.selectedCustomerIds.size).toBe(0);
      expect(ctx.comp.loadingRecs).toBe(false);
    });

    it('the preview and the report of the SAME promotion asked twice: only the newest answer counts', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...PROMO, sentCount: 1 });
      await ctx.settle();
      ctx.comp.loadPreview();
      ctx.comp.loadPreview();
      const [older, newer] = ctx.http.match((r) => /\/promotions\/p1\/preview/.test(r.url));
      newer.flush({ message: 'NEWER', buttons: [] });
      older.flush({ message: 'OLDER', buttons: [] });
      await ctx.settle();
      expect(ctx.comp.preview?.message).toBe('NEWER');
      ctx.comp.loadCampaignReport();
      ctx.comp.loadCampaignReport();
      const [r1, r2] = ctx.http.match((r) => /\/promotions\/p1\/report/.test(r.url));
      r2.flush({ messagesSent: 2 });
      r1.flush({ messagesSent: 1 });
      await ctx.settle();
      expect(ctx.comp.campaignReport?.messagesSent).toBe(2);
      expect(ctx.comp.loadingReport).toBe(false);
    });

    it('switching promotions resets the filter for that promotion', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(CONSENT);
      await ctx.settle();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('');
      expect(ctx.seen).toContain('GET /api/promotions/p1/recommended-customers?limit=100');
    });
  });

  describe('the filter control', () => {
    const options = (ctx: Ctx) => Array.from(ctx.el.querySelectorAll('#audience-filter option')) as HTMLOptionElement[];

    it('standard promotion: All customers, Opted in, Not yet responded and an Opted out option that is explained', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      expect(options(ctx).map((o) => (o.textContent || '').trim())).toEqual(['All customers', 'Opted in', 'Not yet responded', 'Opted out']);
      expect(options(ctx)[3].disabled).toBe(false);
      expect(options(ctx)[3].title).toContain('can never receive promotions');
      ctx.comp.setAudienceFilter('opted_out');
      await ctx.settle();
      expect(ctx.text()).toContain('cannot be selected');
      expect(ctx.text()).toContain('no promotion and no consent request will ever be sent to them');
      ctx.comp.setAudienceFilter('not_responded');
      await ctx.settle();
      expect(ctx.text()).toContain('Create a Consent request to ask them');
    });

    it('consent request: no "All customers", and Opted out is disabled (and cannot be chosen)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(CONSENT);
      await ctx.settle();
      expect(options(ctx).map((o) => (o.textContent || '').trim())).toEqual(['Opted in', 'Not yet responded', 'Opted out']);
      expect(options(ctx)[2].disabled).toBe(true);
      expect(options(ctx)[2].title).toContain('never asked again');
      ctx.seen.length = 0;
      ctx.comp.setAudienceFilter('opted_out');
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('not_responded');
      expect(ctx.seen).toEqual([]);
      expect(ctx.text()).toContain('the people to ask for permission');
    });

    it('changing the select in the page changes the filter', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle();
      const select = ctx.el.querySelector('#audience-filter') as HTMLSelectElement;
      select.value = 'opted_in';
      select.dispatchEvent(new Event('change'));
      await ctx.settle();
      expect(ctx.comp.audienceFilter).toBe('opted_in');
    });
  });

  describe('rows of customers without an opt-in (standard promotion)', () => {
    it('shows a "No opt-in" tag and a disabled checkbox on them, and leaves the others alone', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, PROMO, [OPTED_IN('ann'), NO_OPT_IN('bob'), OPTED_OUT('cy'), cust('dee')]);
      expect(rows(ctx)).toHaveLength(4);
      expect(ctx.text()).toContain('No opt-in');
      const tags = (r: HTMLElement) => r.querySelector('.consent-tag')?.textContent?.trim();
      expect(tags(rowOf(ctx, 'ANN'))).toBeUndefined();
      expect(tags(rowOf(ctx, 'BOB'))).toBe('No opt-in');
      expect(tags(rowOf(ctx, 'CY'))).toBe('No opt-in');
      expect(tags(rowOf(ctx, 'DEE'))).toBeUndefined(); // no consent information at all: the server decides
      expect(checkbox(rowOf(ctx, 'ANN')).disabled).toBe(false);
      expect(checkbox(rowOf(ctx, 'BOB')).disabled).toBe(true);
      expect(checkbox(rowOf(ctx, 'CY')).disabled).toBe(true);
      expect(checkbox(rowOf(ctx, 'DEE')).disabled).toBe(false);
      expect((rowOf(ctx, 'BOB').querySelector('.consent-tag') as HTMLElement).title).toContain('Create a Consent request');
      expect((rowOf(ctx, 'CY').querySelector('.consent-tag') as HTMLElement).title).toContain('opted out');
    });

    it('clicking such a row, or Select All, does not select them', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, PROMO, [OPTED_IN('ann'), NO_OPT_IN('bob'), OPTED_OUT('cy')]);
      rowOf(ctx, 'BOB').click();
      await ctx.settle();
      expect(ctx.comp.selectedCustomerIds.size).toBe(0);
      ctx.comp.selectAll();
      expect([...ctx.comp.selectedCustomerIds]).toEqual(['ann']);
    });

    it('also in the All Customers tab, using the consent status the list carries', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      ctx.comp.switchCustomerView('all');
      await ctx.settle((req, path) => (/^\/api\/customers\?/.test(path) ? { customers: [cust('eve', { consentStatus: 'opted_in' }), cust('fay', { consentStatus: 'not_responded' })], total: 2 } : undefined));
      expect(checkbox(rowOf(ctx, 'EVE')).disabled).toBe(false);
      expect(checkbox(rowOf(ctx, 'FAY')).disabled).toBe(true);
      expect(rowOf(ctx, 'FAY').querySelector('.consent-tag')?.textContent?.trim()).toBe('No opt-in');
    });

    it('a demo customer or a demo promotion is never blocked (it is simulated, as before)', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, PROMO, [cust('gus', { isDemo: true, marketingConsent: false })]);
      expect(checkbox(rowOf(ctx, 'GUS')).disabled).toBe(false);
      await openWithRecs(ctx, { ...PROMO, isDemo: true }, [NO_OPT_IN('hal')]);
      expect(checkbox(rowOf(ctx, 'HAL')).disabled).toBe(false);
    });

    it('a points promotion keeps its own "not enough points" rule next to the consent one', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, { ...PROMO, customerType: 'points', pointsPrice: 100 }, [OPTED_IN('ivy'), { ...OPTED_IN('jon'), loyaltyPoints: 500, hasEnoughPoints: true }]);
      expect(checkbox(rowOf(ctx, 'IVY')).disabled).toBe(true); // opted in but cannot afford it
      expect(ctx.text()).toContain('Not enough points');
      expect(checkbox(rowOf(ctx, 'JON')).disabled).toBe(false);
    });
  });

  describe('the "will be skipped" warning and the confirmation', () => {
    it('warns about selected customers who have not opted in, and the confirmation says so', async () => {
      const ctx = await boot();
      const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(false);
      await openWithRecs(ctx, PROMO, [OPTED_IN('ann'), NO_OPT_IN('bob'), NO_OPT_IN('cat')]);
      // customers selected by an earlier step (an insight, a blocked send) are selected whether or not they are opted in
      ['ann', 'bob', 'cat'].forEach((id) => ctx.comp.selectedCustomerIds.add(id));
      await ctx.settle();
      expect(ctx.comp.noOptInSelectedCount).toBe(2);
      expect(ctx.text()).toContain('2 selected customers have not opted in and will be skipped - create a Consent request to ask them');
      await ctx.comp.sendCampaign();
      expect(confirm.mock.calls[0][0]).toBe('Send WhatsApp promotion to 3 customers? 2 of them have not opted in and will be skipped.');
    });

    it('says "customer has" for one', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, PROMO, [NO_OPT_IN('bob')]);
      ctx.comp.selectedCustomerIds.add('bob');
      await ctx.settle();
      expect(ctx.text()).toContain('1 selected customer has not opted in and will be skipped - create a Consent request to ask them');
    });

    it('with nothing to warn about there is no warning and the confirmation is exactly today\'s text', async () => {
      const ctx = await boot();
      const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(false);
      await openWithRecs(ctx, PROMO, [OPTED_IN('ann'), OPTED_IN('ben'), cust('dee')]);
      ['ann', 'ben'].forEach((id) => ctx.comp.selectedCustomerIds.add(id));
      await ctx.settle();
      expect(ctx.text()).not.toMatch(WARN);
      await ctx.comp.sendCampaign();
      expect(confirm.mock.calls[0][0]).toBe('Send WhatsApp promotion to 2 customers?');
    });

    it('selected customers the lists never showed are not counted (the server reports them after the send)', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, PROMO, [OPTED_IN('ann')]);
      ctx.comp.selectedCustomerIds.add('someone-else');
      await ctx.settle();
      expect(ctx.comp.noOptInSelectedCount).toBe(0);
    });

    it('is not shown for a consent request (those customers are exactly who it is for)', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, CONSENT, [NO_OPT_IN('bob')]);
      ctx.comp.selectedCustomerIds.add('bob');
      await ctx.settle();
      expect(ctx.text()).not.toMatch(WARN);
      expect(ctx.comp.noOptInSelectedCount).toBe(0);
    });
  });

  describe('a consent request', () => {
    it('blocks customers who already opted in or opted out, and allows the ones who have not answered', async () => {
      const ctx = await boot();
      await openWithRecs(ctx, CONSENT, [NO_OPT_IN('new'), OPTED_IN('yes'), OPTED_OUT('out')]);
      expect(checkbox(rowOf(ctx, 'NEW')).disabled).toBe(false);
      expect(checkbox(rowOf(ctx, 'YES')).disabled).toBe(true);
      expect(checkbox(rowOf(ctx, 'OUT')).disabled).toBe(true);
      expect(rowOf(ctx, 'YES').querySelector('.consent-tag')?.textContent?.trim()).toBe('Already opted in');
      expect(rowOf(ctx, 'OUT').querySelector('.consent-tag')?.textContent?.trim()).toBe('Opted out');
      ctx.comp.selectAll();
      expect([...ctx.comp.selectedCustomerIds]).toEqual(['new']);
    });

    it('the send button says what is being sent', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(CONSENT);
      ctx.comp.selectedCustomerIds.add('x');
      await ctx.settle();
      expect(ctx.text()).toContain('Send opt-in request to 1 Customers');
    });
  });

  describe('what a send left out', () => {
    async function sendAndAnswer(ctx: Ctx, promo: any, answer: unknown) {
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign(promo);
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      await ctx.settle((req, path) => (new RegExp(`^POST /api/promotions/${promo._id}/send$`).test(`${req.request.method} ${path}`) ? answer : undefined));
    }

    it('lists the skipped counters of a standard promotion with the reason, and offers the way forward', async () => {
      const ctx = await boot();
      await sendAndAnswer(ctx, PROMO, { success: true, sentCount: 1, skippedOptedOut: 2, skippedNoConsent: 3, errors: [] });
      expect(ctx.text()).toContain('Not sent to everyone you selected');
      expect(ctx.text()).toContain('3 customers were skipped because they have not opted in. Create a Consent request to ask them.');
      expect(ctx.text()).toContain('2 customers were skipped because they opted out.');
      expect(ctx.text()).toContain('WhatsApp accepted 1 message.');
    });

    it('lists the counters of a consent request, singular and plural', async () => {
      const ctx = await boot();
      await sendAndAnswer(ctx, CONSENT, { success: true, sentCount: 0, skippedAlreadyOptedIn: 1, skippedAskedRecently: 4, errors: [] });
      expect(ctx.text()).toContain('1 customer was skipped because they have already opted in.');
      expect(ctx.text()).toContain('4 customers were skipped because they were asked recently.');
    });

    it('shows nothing extra when nothing was skipped', async () => {
      const ctx = await boot();
      await sendAndAnswer(ctx, PROMO, { success: true, sentCount: 1, skippedOptedOut: 0, skippedNoConsent: 0, errors: [] });
      expect(ctx.text()).not.toContain('Not sent to everyone you selected');
    });

    it('shows nothing extra after an error', async () => {
      const ctx = await boot();
      expect(ctx.comp.skippedLines({ error: true, message: 'x', skippedNoConsent: 5 })).toEqual([]);
      expect(ctx.comp.skippedLines(null)).toEqual([]);
    });
  });

  describe('the Campaign Report', () => {
    const report = (over: Record<string, unknown> = {}) => ({ promotionId: 'pc', name: 'Opt in', messagesSent: 10, messagesDelivered: 8, messagesRead: 5, messagesFailed: 0, clicked: 4, ordersCreated: 0, revenue: 0, pointsIssued: 0, conversionRate: 0, ...over });

    it('adds the consent numbers for a consent request', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...CONSENT, sentCount: 10 });
      await ctx.settle((req, path) => (/\/promotions\/pc\/report$/.test(path) ? report({ consent: { optIns: 5, optOuts: 1, interested: 2, otherTaps: 3, optInRate: 62.5, optOutRate: 12.5 } }) : undefined));
      expect(ctx.text()).toContain('Opt-in results');
      const stats = Array.from(ctx.el.querySelectorAll('.report-consent .report-stat')).map((s) => Array.from(s.children).map((c) => (c.textContent || '').trim()).join(' '));
      expect(stats).toEqual(['5 Opt-ins', '1 Opt-outs', '2 Interested', '3 Other taps', '62.5% Opt-in rate', '12.5% Opt-out rate']);
    });

    it('missing numbers show 0 and a dash rather than blanks', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...CONSENT, sentCount: 10 });
      await ctx.settle((req, path) => (/\/promotions\/pc\/report$/.test(path) ? report({ consent: { optIns: 0 } }) : undefined));
      const stats = Array.from(ctx.el.querySelectorAll('.report-consent .report-stat')).map((s) => Array.from(s.children).map((c) => (c.textContent || '').trim()).join(' '));
      expect(stats).toEqual(['0 Opt-ins', '0 Opt-outs', '0 Interested', '0 Other taps', '- Opt-in rate', '- Opt-out rate']);
    });

    it('a report without a consent object looks exactly as before', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...PROMO, sentCount: 10 });
      await ctx.settle((req, path) => (/\/promotions\/p1\/report$/.test(path) ? report() : undefined));
      expect(ctx.el.querySelector('.report-consent')).toBeNull();
      expect(ctx.text()).not.toContain('Opt-in results');
      expect(ctx.text()).toContain('Campaign Report');
    });
  });

  describe('the preview', () => {
    const chipText = (b: Element) => [(b.childNodes[0].textContent || '').trim(), (b.querySelector('.wa-bubble-action')?.textContent || '').trim()].filter(Boolean).join(' ');
    const preview = (over: Record<string, unknown> = {}) => ({ body: 'Hi Sam, want offers on WhatsApp?', buttonLabel: 'Shop', isCustomEntryNode: true, templateStatus: 'approved', ...over });

    it('lists every button of a custom message with what it does, and the footer', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(CONSENT);
      await ctx.settle((req, path) => (/\/promotions\/pc\/preview$/.test(path) ? preview({
        isConsentRequest: true, footer: 'Reply STOP to unsubscribe',
        buttons: [{ position: 0, label: 'Yes, send me offers', action: 'opt_in' }, { position: 1, label: 'No thanks', action: 'opt_out' }, { position: 2, label: 'Tell me more', action: 'interested' }],
      }) : undefined));
      const chips = Array.from(ctx.el.querySelectorAll('.wa-bubble .wa-bubble-button')).map(chipText);
      expect(chips).toEqual(['Yes, send me offers Opt in', 'No thanks Opt out', 'Tell me more Interested']);
      expect(ctx.el.querySelector('.wa-bubble-footer')?.textContent?.trim()).toBe('Reply STOP to unsubscribe');
      expect(ctx.text()).toContain('A test message does not record anyone\'s consent');
    });

    it('a custom message of a standard promotion shows all its buttons, with no action tag when nothing special happens', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle((req, path) => (/\/promotions\/p1\/preview$/.test(path) ? preview({ buttons: [{ position: 0, label: 'Shop now', action: 'end_flow' }, { position: 1, label: 'Later', action: 'end_flow' }] }) : undefined));
      const chips = Array.from(ctx.el.querySelectorAll('.wa-bubble .wa-bubble-button')).map(chipText);
      expect(chips).toEqual(['Shop now', 'Later']);
      expect(ctx.el.querySelector('.wa-bubble-footer')).toBeNull();
    });

    it('the default message keeps its single button and the fixed Opt Out chip (unchanged)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle((req, path) => (/\/promotions\/p1\/preview$/.test(path) ? { body: 'Big sale', buttonLabel: 'Shop now', isCustomEntryNode: false } : undefined));
      const chips = Array.from(ctx.el.querySelectorAll('.wa-bubble .wa-bubble-button')).map((b) => (b.textContent || '').trim());
      expect(chips).toEqual(['Shop now', 'Opt Out']);
    });

    it('an old answer without buttons still shows the first button', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle((req, path) => (/\/promotions\/p1\/preview$/.test(path) ? preview() : undefined));
      const chips = Array.from(ctx.el.querySelectorAll('.wa-bubble .wa-bubble-button')).map((b) => (b.textContent || '').trim());
      expect(chips).toEqual(['Shop']);
    });

    it('says sending is paused (not "falls back to the default message") while the message is unapproved', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(PROMO);
      await ctx.settle((req, path) => (/\/promotions\/p1\/preview$/.test(path) ? preview({ templateStatus: 'pending' }) : undefined));
      expect(ctx.text()).toContain('sending is paused until it is approved');
      expect(ctx.text()).not.toContain('fall back to the default message');
    });
  });

  it('no "default message" wording is left for an unapproved custom message anywhere', async () => {
    const ctx = await boot();
    ctx.comp.promotions = [{ ...PROMO, entryNodeId: { _id: 'n1', templateStatus: 'pending' } }];
    ctx.comp.openCampaign(ctx.comp.promotions[0]);
    await ctx.settle();
    ctx.comp.openViewEdit(ctx.comp.promotions[0]);
    await ctx.settle((req, path) => (/message-nodes\/n1$/.test(path) ? { _id: 'n1', bodyText: 'Hi', templateStatus: 'pending', buttons: [] } : undefined));
    expect(ctx.text()).not.toMatch(/default message instead|fall back to the default|silently fall back/);
    expect(button(ctx.el, 'Refresh Status')).toBeDefined();
  });
});
