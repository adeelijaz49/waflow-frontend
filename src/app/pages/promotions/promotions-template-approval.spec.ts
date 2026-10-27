import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from '../../shared/dialog.service';
import { Promotions, TEMPLATE_POLL_MS } from './promotions';

// A custom message is only sent once Meta approved it. Until then: the banner says where it stands, a send is blocked
// (HTTP 409 template_not_approved) and remembered, and when it is approved the merchant is told they can send what they
// intended. The screen checks for the answer every 60 s, but only while a pending template is on screen.
vi.setConfig({ testTimeout: 30000 });

const SETTINGS = { arabicEnabled: false, arabicEnabledAt: null, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Handler = (req: TestRequest, path: string) => unknown;
const pathOf = (req: TestRequest) => req.request.urlWithParams.replace(/^https?:\/\/[^/]+/, '').replace(/^\/\//, '/').replace(/^.*?(\/api\/)/, '$1');

const WAITING = 'This message is being sent to Facebook (Meta) for approval - sending is paused until it is approved.';
const APPROVED = 'Your message was approved - you can now send the messages you intended';

// Only the 60 s poll timer is captured (and fired by hand); every other timer is the real one.
const timers: Array<{ id: number; fn: () => void }> = [];
let nextTimerId = 5000;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
beforeEach(() => {
  timers.length = 0;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === TEMPLATE_POLL_MS) { const id = nextTimerId++; timers.push({ id, fn }); return id as unknown as ReturnType<typeof setTimeout>; }
    return realSetTimeout(fn, ms, ...rest);
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id?: ReturnType<typeof setTimeout>) => {
    const i = timers.findIndex((t) => t.id === (id as unknown as number));
    if (i >= 0) timers.splice(i, 1); // a cleared timer never fires
    return realClearTimeout(id);
  }) as typeof clearTimeout);
});
afterEach(() => { vi.restoreAllMocks(); });

async function boot() {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const bodies: Array<{ key: string; body: any }> = [];
  const fixture = TestBed.createComponent(Promotions);
  fixture.detectChanges();
  const settle = async (handler?: Handler) => {
    for (let i = 0; i < 5; i++) {
      for (const req of http.match(() => true)) {
        const path = pathOf(req);
        const key = `${req.request.method} ${path}`;
        seen.push(key);
        bodies.push({ key, body: req.request.body });
        const custom = handler ? handler(req, path) : undefined;
        if (custom && typeof custom === 'object' && '__error' in (custom as any)) {
          const c = custom as { __error: number; body?: unknown };
          req.flush(c.body ?? { error: 'x' }, { status: c.__error, statusText: 'err' });
        } else if (custom !== undefined) req.flush(custom);
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
  seen.length = 0;
  bodies.length = 0;
  const el = fixture.nativeElement as HTMLElement;
  const text = () => (el.textContent || '').replace(/\s+/g, ' ');
  const bodyOf = (re: RegExp) => bodies.find((b) => re.test(b.key))?.body;
  return { fixture, comp: fixture.componentInstance, el, seen, bodies, bodyOf, settle, text };
}
type Ctx = Awaited<ReturnType<typeof boot>>;
const button = (el: HTMLElement, label: string) =>
  (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().includes(label));

const promo = (over: Record<string, unknown> = {}, node: Record<string, unknown> | null = { _id: 'n1', templateStatus: 'pending' }) => ({
  _id: 'p1', name: 'Eid sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, entryNodeId: node, ...over,
});
const sendUrl = /^POST \/api\/promotions\/p1\/send$/;
const refreshUrl = /^POST \/api\/message-nodes\/n1\/refresh-status$/;

describe('Promotions screen: template approval', () => {
  describe('banner states in the campaign panel', () => {
    it.each([
      ['pending', 'pending'],
      ['not_created', 'not_created'],
    ])('%s: says the message is with Meta and sending is paused', async (_n, status) => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: status }));
      await ctx.settle();
      expect(ctx.text()).toContain(WAITING);
      expect(ctx.text()).not.toContain('will use the default message');
      expect(ctx.text()).not.toContain(APPROVED);
    });

    it('not_created explains that the first Send submits it', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'not_created' }));
      await ctx.settle();
      expect(ctx.text()).toContain('sent for approval automatically the first time you press Send');
    });

    it('rejected: shows the reason Meta gave', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'rejected', templateRejectedReason: 'INVALID_FORMAT' }));
      await ctx.settle();
      expect(ctx.text()).toContain('Facebook (Meta) did not approve this message: INVALID_FORMAT.');
      expect(ctx.text()).not.toContain(WAITING);
    });

    it('rejected without a reason still says so plainly', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'rejected' }));
      await ctx.settle();
      expect(ctx.text()).toContain('Facebook (Meta) did not approve this message.');
      expect(ctx.text()).not.toContain('no reason was given');
    });

    // The server stores a full sentence as the reason (shared/operations.js#rejectionText): it is shown as it is, once.
    it('rejected: the server\'s own sentence is shown once, not wrapped in a second "did not approve" sentence', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'rejected', templateRejectedReason: 'Facebook (Meta) did not approve this message (INVALID_FORMAT).' }));
      await ctx.settle();
      const t = ctx.text();
      expect(t).toContain('Facebook (Meta) did not approve this message (INVALID_FORMAT).');
      expect((t.match(/did not approve this message/g) || []).length).toBe(1);
    });

    it('paused by Meta: its sentence is shown as it is', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'rejected', templateRejectedReason: 'Facebook (Meta) has paused this message because customers reacted badly to it. Edit it, or try again later.' }));
      await ctx.settle();
      expect(ctx.text()).toContain('Facebook (Meta) has paused this message because customers reacted badly to it.');
      expect(ctx.text()).not.toContain('did not approve this message');
    });

    it('approved with an undismissed notice: says the intended messages can be sent now', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' }));
      await ctx.settle();
      expect(ctx.text()).toContain(APPROVED);
      expect(button(ctx.el, 'Review and send')).toBeDefined();
      expect(button(ctx.el, 'Dismiss')).toBeDefined();
    });

    it.each([
      ['no notice yet', { sendRequest: { customerIds: ['c1'] } }],
      ['already dismissed', { sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:00:00Z', dismissedAt: '2026-10-26T11:00:00Z' } }],
      ['no send was ever requested', {}],
    ])('approved, %s: nothing to announce', async (_n, over) => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo(over, { _id: 'n1', templateStatus: 'approved' }));
      await ctx.settle();
      expect(ctx.text()).not.toContain(APPROVED);
      expect(ctx.text()).not.toContain(WAITING);
    });

    it('a stale notice is not shown while the message is waiting for approval again (edited after approval)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'not_created' }));
      await ctx.settle();
      expect(ctx.text()).not.toContain(APPROVED);
      expect(ctx.text()).toContain(WAITING);
    });

    it('a promotion without a custom message shows no banner at all', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, null));
      await ctx.settle();
      expect(ctx.text()).not.toContain(WAITING);
      expect(ctx.text()).not.toContain('did not approve');
      expect(ctx.text()).not.toContain(APPROVED);
    });
  });

  describe('the promotion list', () => {
    it('shows the approved notice on the card with the two actions, and says "Pending Approval" with the new explanation', async () => {
      const ctx = await boot();
      ctx.comp.promotions = [
        promo({ _id: 'p1', sendRequest: { customerIds: ['c1', 'c2'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' }),
        promo({ _id: 'p2', name: 'Waiting' }, { _id: 'n2', templateStatus: 'pending' }),
        promo({ _id: 'p3', name: 'Refused' }, { _id: 'n3', templateStatus: 'rejected' }),
      ];
      await ctx.settle();
      expect(ctx.el.querySelectorAll('.template-banner-ok')).toHaveLength(1);
      expect(ctx.text()).toContain(APPROVED);
      const badges = Array.from(ctx.el.querySelectorAll('.promo-meta .badge')).map((b) => (b.textContent || '').trim());
      expect(badges).toContain('⏳ Pending Approval');
      expect(badges).toContain('Not approved');
      const pending = Array.from(ctx.el.querySelectorAll('.promo-meta .badge')).find((b) => (b.textContent || '').includes('Pending Approval')) as HTMLElement;
      expect(pending.title).toContain('sending is paused until it is approved');
      expect(ctx.text()).not.toContain('use the default message');
    });

    it('"Review and send" opens the campaign panel with the customers of the blocked send already selected', async () => {
      const ctx = await boot();
      ctx.comp.promotions = [promo({ sendRequest: { customerIds: ['c1', 'c2'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' })];
      await ctx.settle();
      button(ctx.el, 'Review and send')!.click();
      await ctx.settle();
      expect(ctx.comp.activePromo._id).toBe('p1');
      expect([...ctx.comp.selectedCustomerIds].sort()).toEqual(['c1', 'c2']);
      expect(ctx.text()).toContain('Send WhatsApp to 2 Customers');
      // the notice now lives in the panel, not twice on screen
      expect(ctx.el.querySelectorAll('.template-banner-ok')).toHaveLength(1);
    });

    it('selecting from the notice while the promotion is already open keeps it open and adds the customers', async () => {
      const ctx = await boot();
      const p = promo({ sendRequest: { customerIds: [{ _id: 'c9' }], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' });
      ctx.comp.openCampaign(p);
      await ctx.settle();
      ctx.seen.length = 0;
      ctx.comp.reviewAndSend(p);
      expect([...ctx.comp.selectedCustomerIds]).toEqual(['c9']);
      await ctx.settle();
      expect(ctx.seen.some((s) => /recommended-customers/.test(s))).toBe(false); // no reload of the lists
    });

    it('Dismiss tells the server and removes the notice', async () => {
      const ctx = await boot();
      ctx.comp.promotions = [promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' })];
      await ctx.settle();
      button(ctx.el, 'Dismiss')!.click();
      await ctx.settle();
      expect(ctx.seen).toContain('POST /api/promotions/p1/dismiss-send-request');
      expect(ctx.text()).not.toContain(APPROVED);
      expect(ctx.comp.promotions[0].sendRequest.dismissedAt).toBeTruthy();
    });

    it('if dismissing fails the notice stays and the merchant is told', async () => {
      const ctx = await boot();
      const err = vi.spyOn(TestBed.inject(DialogService), 'error').mockImplementation(() => undefined as any);
      ctx.comp.promotions = [promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:00:00Z' } }, { _id: 'n1', templateStatus: 'approved' })];
      await ctx.settle();
      button(ctx.el, 'Dismiss')!.click();
      await ctx.settle((req, path) => (/dismiss-send-request/.test(path) ? { __error: 500 } : undefined));
      expect(err).toHaveBeenCalled();
      expect(ctx.text()).toContain(APPROVED);
    });
  });

  describe('a send that the server blocks (HTTP 409 template_not_approved)', () => {
    async function pressSend(ctx: Ctx, answer: unknown, extra?: Handler) {
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'not_created' }));
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      await ctx.settle((req, path) => (sendUrl.test(`${req.request.method} ${path}`) ? answer : extra?.(req, path)));
    }

    it('shows the "being sent to Meta" banner instead of an error, and nothing was sent', async () => {
      const ctx = await boot();
      await pressSend(ctx, { __error: 409, body: { error: 'template_not_approved', message: 'Your message was sent to Meta for approval.', templateStatus: 'not_created', submittedNow: true } }, (req, path) => (
        /^\/api\/promotions\/p1$/.test(path) && req.request.method === 'GET' ? promo({ sendRequest: { customerIds: ['c1'] } }, { _id: 'n1', templateStatus: 'pending' }) : undefined
      ));
      expect(ctx.comp.sendResult).toBeNull();
      expect(ctx.text()).toContain(WAITING);
      expect(ctx.text()).toContain('We have just sent it to Meta for you.');
      expect(ctx.text()).toContain('Nothing was sent. Your message was sent to Meta for approval.');
      expect(ctx.text()).not.toContain('template_not_approved');
      expect(ctx.text()).not.toContain('Failed to send');
      expect(ctx.comp.sending).toBe(false);
      expect(ctx.comp.activePromo.entryNodeId.templateStatus).toBe('pending');
      expect(ctx.seen).toContain('GET /api/promotions/p1'); // brings in what the server recorded (the intended send)
      expect(ctx.seen).toContain('GET /api/promotions'); // and the list
      expect(timers).toHaveLength(1); // the screen starts waiting for the answer
    });

    it('works when the panel only knew the node id (not the populated node)', async () => {
      const ctx = await boot();
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign({ ...promo(), entryNodeId: 'n1' });
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      await ctx.settle((req, path) => (sendUrl.test(`${req.request.method} ${path}`) ? { __error: 409, body: { error: 'template_not_approved', templateStatus: 'pending', submittedNow: false } } : undefined));
      expect(ctx.comp.activePromo.entryNodeId).toMatchObject({ _id: 'n1', templateStatus: 'pending' });
      expect(ctx.text()).toContain(WAITING);
    });

    it('a rejected template stays "rejected" with its reason and no polling', async () => {
      const ctx = await boot();
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'rejected', templateRejectedReason: 'TAG_CONTENT_MISMATCH' }));
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      await ctx.settle((req, path) => (sendUrl.test(`${req.request.method} ${path}`) ? { __error: 409, body: { error: 'template_not_approved', templateStatus: 'rejected', submittedNow: false, message: 'Meta did not approve it.' } } : undefined));
      expect(ctx.text()).toContain('did not approve this message: TAG_CONTENT_MISMATCH.');
      expect(ctx.text()).toContain('Nothing was sent. Meta did not approve it.');
      expect(timers).toHaveLength(0);
    });

    it('any other failure is still an ordinary error (and a 409 with another code is not mistaken for the block)', async () => {
      const ctx = await boot();
      await pressSend(ctx, { __error: 409, body: { error: 'Some other conflict' } });
      expect(ctx.comp.sendResult).toEqual({ error: true, message: 'Some other conflict' });
      expect(ctx.text()).toContain('Some other conflict');
      expect(timers).toHaveLength(0);
    });

    it('a 409 that arrives after the merchant opened another promotion does not touch it', async () => {
      const ctx = await boot();
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'not_created' }));
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      ctx.comp.openCampaign(promo({ _id: 'p2', name: 'Other' }, null));
      await ctx.settle((req, path) => (sendUrl.test(`${req.request.method} ${path}`) ? { __error: 409, body: { error: 'template_not_approved', submittedNow: true } } : undefined));
      expect(ctx.comp.templateBlock).toBeNull();
      expect(ctx.text()).not.toContain(WAITING);
      expect(timers).toHaveLength(0);
    });

    it('a successful send forgets the blocked request (the server clears it too)', async () => {
      const ctx = await boot();
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
      ctx.comp.openCampaign(promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: 'x', dismissedAt: 'y' } }, { _id: 'n1', templateStatus: 'approved' }));
      ctx.comp.selectedCustomerIds.add('c1');
      await ctx.settle();
      await ctx.comp.sendCampaign();
      await ctx.settle((req, path) => (sendUrl.test(`${req.request.method} ${path}`) ? { success: true, sentCount: 1, errors: [] } : undefined));
      expect(ctx.comp.activePromo.sendRequest).toBeUndefined();
    });

    it('a test message hits the same block and says so instead of showing the error code', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'not_created' }));
      await ctx.settle();
      ctx.comp.testPhone = '61412345678';
      ctx.comp.sendTestMessage();
      await ctx.settle((req, path) => (/test-send$/.test(path) ? { __error: 409, body: { error: 'template_not_approved', message: 'It is with Meta now.', templateStatus: 'pending', submittedNow: true } } : undefined));
      expect(ctx.comp.testResult).toEqual({ ok: false, message: 'It is with Meta now.' });
      expect(ctx.text()).toContain('It is with Meta now.');
      expect(ctx.text()).not.toContain('template_not_approved');
      expect(ctx.text()).toContain(WAITING);
    });
  });

  describe('polling while a pending template is on screen', () => {
    it('checks every 60 s, shows approval, brings in the notice and stops', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      expect(timers).toHaveLength(1); // nothing is asked until the 60 s are up
      expect(ctx.seen.some((s) => refreshUrl.test(s))).toBe(false);

      ctx.seen.length = 0;
      timers.shift()!.fn(); // still pending: keep waiting
      await ctx.settle((req, path) => (refreshUrl.test(`${req.request.method} ${path}`) ? { _id: 'n1', templateStatus: 'pending' } : undefined));
      expect(ctx.seen.filter((s) => refreshUrl.test(s))).toHaveLength(1);
      expect(ctx.text()).toContain(WAITING);
      expect(timers).toHaveLength(1);

      ctx.seen.length = 0;
      timers.shift()!.fn(); // approved
      await ctx.settle((req, path) => {
        const key = `${req.request.method} ${path}`;
        if (refreshUrl.test(key)) return { _id: 'n1', templateStatus: 'approved', templateApprovedAt: '2026-10-26T10:05:00Z' };
        if (key === 'GET /api/promotions/p1') return promo({ sendRequest: { customerIds: ['c1'], approvedNoticeAt: '2026-10-26T10:05:00Z' } }, { _id: 'n1', templateStatus: 'approved' });
        return undefined;
      });
      expect(ctx.comp.activePromo.entryNodeId.templateStatus).toBe('approved');
      expect(ctx.text()).toContain(APPROVED);
      expect(ctx.text()).not.toContain(WAITING);
      expect(ctx.seen).toContain('GET /api/promotions'); // the list is brought up to date
      expect(timers).toHaveLength(0); // nothing pending any more: polling stopped
    });

    it('a refusal also stops it and shows the reason', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      timers.shift()!.fn();
      await ctx.settle((req, path) => (refreshUrl.test(`${req.request.method} ${path}`) ? { _id: 'n1', templateStatus: 'rejected', templateRejectedReason: 'ABUSIVE_CONTENT' } : undefined));
      expect(ctx.text()).toContain('did not approve this message: ABUSIVE_CONTENT.');
      expect(timers).toHaveLength(0);
    });

    it('a failed check is simply retried on the next round', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      timers.shift()!.fn();
      await ctx.settle((req, path) => (refreshUrl.test(`${req.request.method} ${path}`) ? { __error: 500 } : undefined));
      expect(ctx.text()).toContain(WAITING);
      expect(timers).toHaveLength(1);
    });

    it('does not poll at all when no pending template is on screen', async () => {
      const ctx = await boot();
      for (const node of [null, { _id: 'n1', templateStatus: 'approved' }, { _id: 'n1', templateStatus: 'rejected' }, { _id: 'n1', templateStatus: 'not_created' }]) {
        ctx.comp.openCampaign(promo({}, node));
        await ctx.settle();
        expect(timers).toHaveLength(0);
      }
      expect(ctx.seen.some((s) => refreshUrl.test(s))).toBe(false);
    });

    it('opening another promotion stops waiting for the first one (and an old timer does nothing)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      expect(timers).toHaveLength(1);
      const old = timers[0].fn;
      ctx.comp.openCampaign(promo({ _id: 'p2' }, { _id: 'n2', templateStatus: 'approved' }));
      await ctx.settle();
      expect(timers).toHaveLength(0);
      ctx.seen.length = 0;
      old(); // even if it somehow fired
      await ctx.settle();
      expect(ctx.seen.some((s) => /refresh-status/.test(s))).toBe(false);
    });

    it('switching straight to another pending promotion waits for THAT one only', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      ctx.comp.openCampaign(promo({ _id: 'p2' }, { _id: 'n2', templateStatus: 'pending' }));
      await ctx.settle();
      expect(timers).toHaveLength(1);
      ctx.seen.length = 0;
      timers.shift()!.fn();
      await ctx.settle((req, path) => (/refresh-status/.test(path) ? { _id: 'n2', templateStatus: 'pending' } : undefined));
      expect(ctx.seen.filter((s) => /refresh-status/.test(s))).toEqual(['POST /api/message-nodes/n2/refresh-status']);
    });

    it('an answer for the previous promotion is ignored when the merchant moved on meanwhile', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      timers.shift()!.fn(); // the check for n1 is now in flight ...
      ctx.comp.openCampaign(promo({ _id: 'p2' }, { _id: 'n2', templateStatus: 'pending' })); // ... and the merchant opens p2
      await ctx.settle((req, path) => (/n1\/refresh-status/.test(path) ? { _id: 'n1', templateStatus: 'approved' } : undefined));
      expect(ctx.comp.activePromo._id).toBe('p2');
      expect(ctx.comp.activePromo.entryNodeId.templateStatus).toBe('pending');
      expect(ctx.text()).not.toContain(APPROVED);
      expect(timers).toHaveLength(1); // exactly one chain: p2's
    });

    it('closing the panel stops it, and so does leaving the page', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      expect(timers).toHaveLength(1);
      ctx.comp.closeCampaign();
      expect(timers).toHaveLength(0);

      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle();
      expect(timers).toHaveLength(1);
      ctx.fixture.destroy();
      expect(timers).toHaveLength(0);
    });

    it('also watches the message being edited, and stops when the editor closes', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle((req, path) => (/message-nodes\/n1$/.test(path) && req.request.method === 'GET' ? { _id: 'n1', bodyText: 'Hi', templateStatus: 'pending', buttons: [] } : undefined));
      expect(timers).toHaveLength(1);
      ctx.comp.closeModal();
      expect(timers).toHaveLength(0);
    });

    it('the Refresh Status button updates the editor and the panel, and moves to approval', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      ctx.comp.openViewEdit(promo({}, { _id: 'n1', templateStatus: 'pending' }));
      await ctx.settle((req, path) => (/message-nodes\/n1$/.test(path) && req.request.method === 'GET' ? { _id: 'n1', bodyText: 'Hi', templateStatus: 'pending', buttons: [] } : undefined));
      button(ctx.el, 'Refresh Status')!.click();
      await ctx.settle((req, path) => (refreshUrl.test(`${req.request.method} ${path}`) ? { _id: 'n1', templateStatus: 'approved' } : undefined));
      expect(ctx.comp.existingEntryNode.templateStatus).toBe('approved');
      expect(ctx.comp.activePromo.entryNodeId.templateStatus).toBe('approved');
      expect(timers).toHaveLength(0);
    });
  });
});
