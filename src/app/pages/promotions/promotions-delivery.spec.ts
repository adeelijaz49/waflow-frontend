import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { Promotions } from './promotions';

// After a send the screen must say what WhatsApp ACCEPTED, then what it actually did (delivered / waiting / refused, with the
// reasons) - not "Sent N WhatsApp messages successfully!" the moment WhatsApp says OK. Backend: GET /api/promotions/:id/delivery.
vi.setConfig({ testTimeout: 30000 });

const PROMO = { _id: 'p1', name: 'Eid sale', status: 'active', sentCount: 0, customerType: 'cash', entryNodeId: null };
const SETTINGS = { arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first' };
const WINDOW_LABEL = '24-hour window closed: this customer has not messaged your WhatsApp number in the last 24 hours, so only an approved template can reach them.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Handler = (req: TestRequest, path: string) => unknown;
const pathOf = (req: TestRequest) => req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/').replace(/^.*?(\/api\/)/, '$1');

// Only the three delivery-check timers are captured (and fired by hand); every other timer is the real one.
const checks: Array<() => void> = [];
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  checks.length = 0;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 3000 || ms === 7000 || ms === 15000) { checks.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; }
    return realSetTimeout(fn, ms, ...rest);
  }) as typeof setTimeout);
});
afterEach(() => { vi.restoreAllMocks(); });

async function boot() {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const fixture = TestBed.createComponent(Promotions);
  fixture.detectChanges();
  const settle = async (handler?: Handler) => {
    for (let i = 0; i < 4; i++) {
      for (const req of http.match(() => true)) {
        const path = pathOf(req);
        seen.push(`${req.request.method} ${path}`);
        const custom = handler ? handler(req, path) : undefined;
        if (custom !== undefined) req.flush(custom);
        else if (/localization\/settings/.test(path)) req.flush(SETTINGS);
        else if (/\/products\?/.test(path)) req.flush({ products: [], total: 0 });
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
  seen.length = 0;
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, seen, settle };
}

const delivery = (over: Record<string, unknown> = {}) => ({
  promotionId: 'p1', since: null, total: 2, accepted: 2, delivered: 0, read: 0, waiting: 0, failed: 0, rejectedImmediately: 0, failedAfterAccepted: 0, viaTemplate: 0, failures: [], ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  promotionId: 'p1', name: 'Eid sale', messagesSent: 2, messagesDelivered: 0, messagesRead: 0, messagesFailed: 0, clicked: 0, ordersCreated: 0, revenue: 0, pointsIssued: 0, conversionRate: 0, ...over,
});
const isSend = (req: TestRequest) => req.request.method === 'POST' && /\/promotions\/p1\/send$/.test(req.request.url);

async function pressSend(ctx: Awaited<ReturnType<typeof boot>>, sendAnswer: unknown, handler: Handler) {
  vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
  ctx.comp.openCampaign(PROMO);
  ctx.comp.selectedCustomerIds.add('c1');
  ctx.comp.selectedCustomerIds.add('c2');
  await ctx.settle();
  await ctx.comp.sendCampaign();
  await ctx.settle((req, path) => (isSend(req) ? sendAnswer : handler(req, path)));
}

describe('Promotions screen: what WhatsApp did with a send', () => {
  it('says WhatsApp ACCEPTED the messages (never "sent successfully"), then shows delivery and the reasons for refusals', async () => {
    const ctx = await boot();
    const none: Handler = () => undefined;
    await pressSend(ctx, { success: true, sentCount: 2, skippedOptedOut: 0, skippedNoConsent: 0, errors: [], demoCount: 0 }, none);
    const text = () => ctx.el.textContent || '';
    expect(text()).toContain('WhatsApp accepted 2 messages.');
    expect(text()).toContain('Checking delivery');
    expect(text()).not.toMatch(/Sent 2 WhatsApp messages successfully/);
    expect(checks).toHaveLength(1); // the first look at what happened is scheduled

    ctx.seen.length = 0;
    checks.shift()!();
    await ctx.settle((req, path) => {
      if (/\/promotions\/p1\/delivery\?sinceSeconds=\d+/.test(path)) {
        return delivery({ failed: 2, failedAfterAccepted: 2, failures: [{ code: '131047', group: 'window', label: WINDOW_LABEL, count: 2 }] });
      }
      if (/\/promotions\/p1\/delivery$/.test(path)) return delivery({ failed: 2, failures: [{ code: '131047', group: 'window', label: WINDOW_LABEL, count: 2 }] });
      if (/\/promotions\/p1\/report$/.test(path)) return report({ messagesFailed: 2 });
      return undefined;
    });
    expect(ctx.seen.some((s) => /^GET \/api\/promotions\/p1\/delivery\?sinceSeconds=\d+$/.test(s))).toBe(true);
    expect(text()).toContain('Result of this send');
    expect(text()).toContain('Delivered: 0');
    expect(text()).toContain('Refused: 2');
    expect(text()).toContain(`2 × ${WINDOW_LABEL}`);
    expect(text()).not.toContain('Checking delivery');
    expect(checks).toHaveLength(0); // nothing is waiting any more: no further check
    expect(ctx.seen).toContain('GET /api/promotions/p1/report'); // the Campaign Report is brought in step
  });

  it('keeps looking (3 s, 10 s, 25 s after the send) while messages are still waiting for WhatsApp, then stops', async () => {
    const ctx = await boot();
    const waiting = (req: TestRequest, path: string) => (/\/promotions\/p1\/delivery\?sinceSeconds=\d+/.test(path) ? delivery({ delivered: 1, waiting: 1 }) : /report$/.test(path) ? report() : undefined);
    await pressSend(ctx, { success: true, sentCount: 2, errors: [] }, waiting);
    expect(checks).toHaveLength(1);

    checks.shift()!();
    await ctx.settle(waiting);
    expect(ctx.el.textContent).toContain('Waiting for WhatsApp: 1');
    expect(checks).toHaveLength(1); // second look scheduled

    checks.shift()!();
    await ctx.settle(waiting);
    expect(checks).toHaveLength(1); // third look scheduled

    ctx.seen.length = 0;
    checks.shift()!();
    await ctx.settle(waiting);
    expect(checks).toHaveLength(0); // that was the last one, even though one message is still waiting
    expect(ctx.seen).toContain('GET /api/promotions/p1/report');
  });

  it('tells the merchant how many went out as the approved template', async () => {
    const ctx = await boot();
    const h: Handler = (req, path) => (/\/promotions\/p1\/delivery\?sinceSeconds=\d+/.test(path) ? delivery({ delivered: 2, viaTemplate: 2 }) : /report$/.test(path) ? report() : undefined);
    await pressSend(ctx, { success: true, sentCount: 2, errors: [] }, h);
    checks.shift()!();
    await ctx.settle(h);
    expect(ctx.el.textContent).toContain('2 sent as the approved message template');
    expect(ctx.el.textContent).toContain('Delivered: 2');
    expect(ctx.el.textContent).not.toContain('Refused');
  });

  it('when WhatsApp accepted nothing there is no delivery check, just the refusals with their reasons', async () => {
    const ctx = await boot();
    ctx.seen.length = 0;
    await pressSend(ctx, { success: true, sentCount: 0, errors: [{ customer: 'c1', error: '(#133010) Account not registered' }, { customer: 'c2', error: '(#133010) Account not registered' }] }, () => undefined);
    expect(checks).toHaveLength(0);
    expect(ctx.el.textContent).toContain('2 messages failed to send');
    expect(ctx.el.textContent).toContain('(#133010) Account not registered');
    expect(ctx.el.textContent).not.toContain('WhatsApp accepted');
    expect(ctx.seen.some((s) => /\/delivery/.test(s))).toBe(false);
  });

  it('under the Campaign Report, says why messages failed (whole promotion)', async () => {
    const ctx = await boot();
    ctx.comp.openCampaign({ ...PROMO, sentCount: 4 });
    await ctx.settle((req, path) => {
      if (/\/promotions\/p1\/report$/.test(path)) return report({ messagesSent: 4, messagesFailed: 3 });
      if (/\/promotions\/p1\/delivery$/.test(path)) return delivery({ failed: 3, failures: [{ code: '131047', group: 'window', label: WINDOW_LABEL, count: 3 }] });
      return undefined;
    });
    expect(ctx.el.textContent).toContain('3 message(s) failed to deliver');
    expect(ctx.el.textContent).toContain(`3 × ${WINDOW_LABEL}`);
    expect(ctx.seen).toContain('GET /api/promotions/p1/delivery');
  });

  it('a report with no failures asks nothing more', async () => {
    const ctx = await boot();
    ctx.comp.openCampaign({ ...PROMO, sentCount: 4 });
    await ctx.settle((req, path) => (/\/promotions\/p1\/report$/.test(path) ? report({ messagesSent: 4, messagesDelivered: 4 }) : undefined));
    expect(ctx.seen.some((s) => /\/delivery/.test(s))).toBe(false);
    expect(ctx.comp.reportFailures).toEqual([]);
  });

  it('if the delivery check itself fails it says so instead of "Checking delivery…" for ever, and stops checking', async () => {
    const ctx = await boot();
    const http = TestBed.inject(HttpTestingController);
    await pressSend(ctx, { success: true, sentCount: 2, errors: [] }, () => undefined);
    expect(ctx.el.textContent).toContain('Checking delivery');
    expect(checks).toHaveLength(1);
    checks.shift()!(); // the first look goes out ...
    for (let i = 0; i < 3; i++) { // ... and the server answers with an error
      for (const req of http.match((r) => /\/promotions\/p1\/delivery\?sinceSeconds=/.test(r.urlWithParams))) {
        req.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
      }
      ctx.fixture.componentRef.changeDetectorRef.markForCheck();
      ctx.fixture.detectChanges();
      await ctx.fixture.whenStable();
      await sleep(0);
    }
    expect(ctx.comp.deliveryUnavailable).toBe(true);
    expect(ctx.el.textContent).toContain('Could not check delivery just now');
    expect(ctx.el.textContent).not.toContain('Checking delivery');
    expect(checks).toHaveLength(0); // and it does not keep trying
  });

  it('an answer to a send that was started on another promotion is ignored (nothing leaks onto the promotion now open)', async () => {
    const ctx = await boot();
    vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
    ctx.comp.openCampaign(PROMO);
    ctx.comp.selectedCustomerIds.add('c1');
    await ctx.settle();
    await ctx.comp.sendCampaign(); // the POST for p1 is now in flight
    ctx.comp.openCampaign({ ...PROMO, _id: 'p2', name: 'Another' }); // the merchant moves on before it answers
    await ctx.settle((req) => (isSend(req) ? { success: true, sentCount: 1, errors: [] } : undefined));
    expect(ctx.comp.sendResult).toBeNull();
    expect(checks).toHaveLength(0);
    expect(ctx.el.textContent).not.toContain('WhatsApp accepted');
  });

  it('opening another promotion clears the previous send\'s delivery state', async () => {
    const ctx = await boot();
    ctx.comp.delivery = delivery({ failed: 1 });
    ctx.comp.reportFailures = [{ code: '131047', label: 'x', count: 1 }];
    ctx.comp.openCampaign({ ...PROMO, _id: 'p2' });
    expect(ctx.comp.delivery).toBeNull();
    expect(ctx.comp.reportFailures).toEqual([]);
  });
});
