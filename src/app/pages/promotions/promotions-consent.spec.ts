import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Promotions } from './promotions';
import { consentWordingHash } from '../../shared/message-node-editor/consent-wording';

// The "Consent request" purpose of the Promotions screen: the sixth start card, the Purpose choice, no discount or
// product pickers, carrying straight on into the message editor after create, the consent-wording guard with its
// REQUIRED acknowledgement, and what is saved (button actions, confirmation texts, consentWordingAck).
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
  const text = (n: Element = el) => (n.textContent || '').replace(/\s+/g, ' ');
  const bodyOf = (re: RegExp) => bodies.find((b) => re.test(b.key))?.body;
  return { fixture, comp: fixture.componentInstance, el, seen, bodies, bodyOf, settle, text, http };
}
type Ctx = Awaited<ReturnType<typeof boot>>;

const button = (el: HTMLElement, label: string) =>
  (Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().includes(label));

const GOOD_BODY = "Hi {{1}}, it's Acme. This Eid, enjoy 10% off. Want first access to offers like this on WhatsApp? Tap below. We'll only message you with offers we think you'll like, and you can stop any time.";
const goodDraft = () => ({
  bodyText: GOOD_BODY,
  buttons: [
    { position: 0, label: 'Yes, send me offers', nextAction: 'opt_in' as const, replyText: 'Welcome aboard!' },
    { position: 1, label: 'No thanks', nextAction: 'opt_out' as const },
  ],
});
const CONSENT_PROMO = { _id: 'pc1', name: 'Opt in Eid', status: 'draft', sentCount: 0, purpose: 'consent_request', campaignType: 'consent_request', customerType: 'cash', entryNodeId: null };

async function openConsentEditor(ctx: Ctx, over: Record<string, unknown> = {}) {
  ctx.comp.openViewEdit({ ...CONSENT_PROMO, ...over });
  await ctx.settle((req, path) => (/\/message-nodes\/n2$/.test(path) && req.request.method === 'GET'
    ? { _id: 'n2', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [{ position: 0, label: 'Yes, send me offers', nextAction: { type: 'opt_in', replyText: 'Hello!' } }, { position: 1, label: 'No thanks', nextAction: { type: 'opt_out', replyText: '' } }] }
    : undefined));
}
const ackBox = (ctx: Ctx) => ctx.el.querySelector('.consent-ack input') as HTMLInputElement;
const saveBtn = (ctx: Ctx) => button(ctx.el, 'Save Custom Message')!;

describe('Promotions screen: Consent request purpose', () => {
  describe('creating one', () => {
    it('offers "Ask customers to opt in" as a sixth start card, after the five existing ones', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      await ctx.settle();
      const cards = Array.from(ctx.el.querySelectorAll('.campaign-type-card'));
      expect(cards).toHaveLength(6);
      expect(ctx.text(cards[0])).toContain('Product Promotion');
      expect(ctx.text(cards[5])).toContain('Ask customers to opt in');
    });

    it('picking the card sets the purpose, hides discount and product pickers and does not need a discount to save', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      await ctx.settle();
      (ctx.el.querySelectorAll('.campaign-type-card')[5] as HTMLElement).click();
      ctx.comp.form.name = 'Opt in Eid';
      await ctx.settle();
      expect(ctx.comp.form.purpose).toBe('consent_request');
      expect(ctx.comp.form.campaignType).toBe('consent_request');
      const t = ctx.text(ctx.el.querySelector('.modal') as HTMLElement);
      expect(t).not.toContain('Discount %');
      expect(t).not.toContain('Select Products');
      expect(t).not.toContain('Promotion Scope');
      expect(t).toContain('Ask customers to opt in (consent request)');
      expect(t).toContain('After you create this promotion the message editor opens');
      expect(button(ctx.el, 'Create Promotion')!.disabled).toBe(false);
      // a consent request is always one message with its buttons: the carousel format is not offered
      expect((Array.from(ctx.el.querySelectorAll('input[name="sendFormat"]')) as HTMLInputElement[])[1].disabled).toBe(true);
    });

    it('an ordinary promotion still needs its discount (the save rule is only relaxed for a consent request)', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      await ctx.settle();
      (ctx.el.querySelectorAll('.campaign-type-card')[0] as HTMLElement).click();
      ctx.comp.form.name = 'Sale';
      await ctx.settle();
      expect(button(ctx.el, 'Create Promotion')!.disabled).toBe(false);
      ctx.comp.form.discountPercent = 0;
      await ctx.settle();
      expect(button(ctx.el, 'Create Promotion')!.disabled).toBe(true);
      expect(ctx.text(ctx.el.querySelector('.modal') as HTMLElement)).toContain('Discount %');
    });

    it('the Purpose choice switches between the two kinds and keeps the form consistent', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      ctx.comp.selectCampaignType(ctx.comp.campaignTypes[0]);
      await ctx.settle();
      ctx.comp.form.sendFormat = 'carousel';
      ctx.comp.setPurpose('consent_request');
      expect(ctx.comp.form).toMatchObject({ purpose: 'consent_request', campaignType: 'consent_request', sendFormat: 'separate', discountPercent: 0, selectedProducts: [], selectedServices: [] });
      expect(ctx.comp.useCustomEntry).toBe(true);
      ctx.comp.setPurpose('standard');
      expect(ctx.comp.form.purpose).toBe('standard');
      expect(ctx.comp.form.campaignType).toBeNull();
      expect(ctx.comp.form.discountPercent).toBe(20);
    });

    it('creates it as a consent request (no products, no discount, separate messages) and opens the editor straight away', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      ctx.comp.selectCampaignType(ctx.comp.campaignTypes[5]);
      ctx.comp.form.name = 'Opt in Eid';
      await ctx.settle();
      ctx.comp.savePromotion();
      await ctx.settle((req, path) => (req.request.method === 'POST' && /\/api\/promotions$/.test(path) ? { ...CONSENT_PROMO, name: 'Opt in Eid' } : undefined));
      expect(ctx.bodyOf(/^POST \/api\/promotions$/)).toMatchObject({
        name: 'Opt in Eid', purpose: 'consent_request', campaignType: 'consent_request', scope: 'products', customerType: 'cash',
        discountPercent: 0, pointsPrice: 0, products: [], services: [], categories: [], sendFormat: 'separate',
      });
      // the modal did not close: it is now the edit form of the new promotion, with the message editor in it
      expect(ctx.comp.showCreateModal).toBe(true);
      expect(ctx.comp.editingPromoId).toBe('pc1');
      expect(ctx.comp.viewMode).toBe(false);
      expect(ctx.comp.useCustomEntry).toBe(true);
      expect(ctx.el.querySelector('app-message-node-editor')).not.toBeNull();
      expect(ctx.text()).toContain('Your opt-in message');
      expect(button(ctx.el, 'Opt-in request')).toBeDefined(); // the one-click preset
    });

    it('creating an ordinary promotion sends exactly what it always sent (no purpose) and closes the form', async () => {
      const ctx = await boot();
      ctx.comp.openCreate();
      ctx.comp.selectCampaignType(ctx.comp.campaignTypes[0]);
      ctx.comp.form.name = 'Sale';
      ctx.comp.savePromotion();
      await ctx.settle((req, path) => (req.request.method === 'POST' && /\/api\/promotions$/.test(path) ? { _id: 'p9', name: 'Sale' } : undefined));
      const body = ctx.bodyOf(/^POST \/api\/promotions$/);
      expect('purpose' in body).toBe(false);
      expect(body.campaignType).toBe('product_promotion');
      expect(ctx.comp.showCreateModal).toBe(false);
    });

    it('editing an existing promotion names its purpose so it is never changed by accident', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, scope: 'products', type: 'store_wide', entryNodeId: null });
      await ctx.settle();
      ctx.comp.savePromotion();
      await ctx.settle();
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/p1$/).purpose).toBe('standard');
    });

    it('the purpose cannot be changed once a message has been written', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' } });
      const radios = Array.from(ctx.el.querySelectorAll('input[name="purpose"]')) as HTMLInputElement[];
      expect(radios).toHaveLength(2);
      expect(radios.every((r) => r.disabled)).toBe(true);
      expect(radios[1].checked).toBe(true);
    });

    it('a consent request with no message yet says so in the campaign panel (and an ordinary promotion does not)', async () => {
      const ctx = await boot();
      ctx.comp.openCampaign({ ...CONSENT_PROMO });
      await ctx.settle();
      expect(ctx.text()).toContain('This consent request has no message yet.');
      ctx.comp.openCampaign({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', entryNodeId: null });
      await ctx.settle();
      expect(ctx.text()).not.toContain('has no message yet');
    });

    it('Run Again of a consent request stays a consent request', async () => {
      const ctx = await boot();
      ctx.comp.duplicatePromotion({ ...CONSENT_PROMO });
      await ctx.settle();
      expect(ctx.comp.form.purpose).toBe('consent_request');
      expect(ctx.comp.form.name).toBe('Opt in Eid (Copy)');
    });
  });

  describe('the wording guard', () => {
    it('Save Custom Message needs the acknowledgement, and the acknowledgement is of one specific wording', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      expect(ctx.text()).toContain('Before you save: check your wording');
      expect(ctx.text()).toContain('Writing guidance');
      expect(ctx.text()).toContain('Benefit first (recommended)');
      expect(saveBtn(ctx).disabled).toBe(true); // wording is fine, but not acknowledged yet
      expect(ctx.text()).toContain('No problems found in this wording');

      ackBox(ctx).click();
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(true);
      expect(saveBtn(ctx).disabled).toBe(false);

      ctx.comp.entryDraft.bodyText += ' Thanks!'; // any change to the wording withdraws the acknowledgement
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(false);
      expect(ackBox(ctx).checked).toBe(false);
      expect(saveBtn(ctx).disabled).toBe(true);

      ackBox(ctx).click();
      await ctx.settle();
      ctx.comp.entryDraft.buttons[1].label = 'Not now'; // a label is part of the wording too
      await ctx.settle();
      expect(saveBtn(ctx).disabled).toBe(true);
    });

    it('the acknowledgement withdrawn when it is un-ticked', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      expect(ctx.comp.consentAck).toBe(false);
      expect(saveBtn(ctx).disabled).toBe(true);
    });

    it('an unreplaced [placeholder] or a missing Opt in button blocks saving even when acknowledged, with the reason', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = { ...goodDraft(), bodyText: GOOD_BODY.replace("it's Acme", "it's [Business name]") };
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      expect(saveBtn(ctx).disabled).toBe(true);
      expect(ctx.text()).toContain('Replace [Business name] with your own words');
      expect(ctx.text()).toContain('Fix the items marked "Fix"');

      ctx.comp.entryDraft = { ...goodDraft(), buttons: [{ position: 0, label: 'No thanks', nextAction: 'opt_out' }] };
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      if (!ctx.comp.consentAckValid) { ackBox(ctx).click(); await ctx.settle(); }
      expect(saveBtn(ctx).disabled).toBe(true);
      expect(ctx.text()).toContain('Add a button that opts the customer in');
    });

    it('warnings advise but do not block (acknowledged wording with a warning still saves)', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = { ...goodDraft(), bodyText: 'Hi {{1}}, Acme here with a big offer on WhatsApp. Tap yes if you like.' };
      await ctx.settle();
      expect(ctx.text()).toContain('Tell customers they can stop any time');
      ackBox(ctx).click();
      await ctx.settle();
      expect(saveBtn(ctx).disabled).toBe(false);
    });

    it('a suggested wording fills the message and still needs its [brackets] replaced', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      button(ctx.el, 'Short and simple')!.click();
      await ctx.settle();
      expect(ctx.comp.entryDraft.bodyText).toContain('[Business name] has [offer in one line]');
      expect(ctx.comp.consentErrors.some((e) => e.code === 'placeholder')).toBe(true);
    });

    it('an ordinary promotion shows no guard and keeps today\'s save rule', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, entryNodeId: { _id: 'n1', templateStatus: 'approved' } });
      await ctx.settle((req, path) => (/\/message-nodes\/n1$/.test(path) ? { _id: 'n1', bodyText: 'Hi there', templateStatus: 'approved', buttons: [{ position: 0, label: 'Shop', nextAction: { type: 'end_flow' } }] } : undefined));
      expect(ctx.el.querySelector('.consent-guard')).toBeNull();
      expect(ctx.text()).toContain('Customize this message');
      expect(saveBtn(ctx).disabled).toBe(false);
    });
  });

  describe('saving the message', () => {
    it('saves the buttons with their actions and confirmation texts, then links the node and records the acknowledgement', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      ctx.bodies.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'POST' && /\/message-nodes$/.test(path)) return { _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] };
        if (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path)) return { ...CONSENT_PROMO, entryNodeId: 'n9' };
        return undefined;
      });
      const created = ctx.bodyOf(/^POST \/api\/message-nodes$/);
      expect(created).toMatchObject({ ownerType: 'promotion', ownerId: 'pc1', isEntryNode: true, bodyText: GOOD_BODY, depth: 0 });
      expect(created.buttons[0]).toMatchObject({ position: 0, label: 'Yes, send me offers', nextAction: { type: 'opt_in', replyText: 'Welcome aboard!' } });
      expect(created.buttons[1]).toMatchObject({ position: 1, label: 'No thanks', nextAction: { type: 'opt_out', replyText: '' } });
      // the server stamps the time and the person; the fingerprint says which wording was acknowledged
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/pc1$/)).toEqual({ entryNodeId: 'n9', consentWordingAck: { textHash: expect.stringMatching(/^[0-9a-f]{14}$/) } });
      expect(ctx.comp.existingEntryNode._id).toBe('n9');
      expect(ctx.comp.savingEntryNode).toBe(false);
    });

    it('a second Save in the SAME open editor updates the message it created (no second message, no second link)', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'POST' && /\/message-nodes$/.test(path)) return { _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] };
        if (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path)) return { ...CONSENT_PROMO, entryNodeId: 'n9' };
        return undefined;
      });
      expect(ctx.comp.entryDraft.targetNodeId).toBe('n9');
      // fix a typo (a new wording: the tick has to be given again) and save once more, without closing the editor
      ctx.comp.entryDraft.buttons[0].replyText = 'Welcome back!';
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(false);
      ackBox(ctx).click();
      await ctx.settle();
      ctx.bodies.length = 0;
      ctx.seen.length = 0; // from here on: only what the SECOND save asks for
      saveBtn(ctx).click();
      await ctx.settle((req, path) => (req.request.method === 'PUT' && /\/message-nodes\/n9$/.test(path) ? { _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] } : undefined));
      expect(ctx.seen.filter((s) => s === 'POST /api/message-nodes')).toEqual([]); // no second message
      expect(ctx.bodyOf(/^PUT \/api\/message-nodes\/n9$/).buttons[0].nextAction).toMatchObject({ type: 'opt_in', replyText: 'Welcome back!' });
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/pc1$/)).toEqual({ consentWordingAck: { textHash: expect.stringMatching(/^[0-9a-f]{14}$/) } }); // the link was made once
      expect(ctx.comp.existingEntryNode._id).toBe('n9');
    });

    it('saving again updates the node and records the acknowledgement of the new wording (no second link)', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' } });
      expect(ctx.comp.entryDraft.buttons[0]).toMatchObject({ nextAction: 'opt_in', replyText: 'Hello!' }); // the saved confirmation text comes back
      expect(ctx.comp.consentAck).toBe(false); // never acknowledged
      ackBox(ctx).click();
      await ctx.settle();
      ctx.comp.entryDraft.buttons[0].replyText = 'Welcome back!';
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(false); // the confirmation text is part of the wording
      ackBox(ctx).click();
      await ctx.settle();
      ctx.bodies.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'PUT' && /\/message-nodes\/n2$/.test(path)) return { _id: 'n2', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] };
        return undefined;
      });
      expect(ctx.bodyOf(/^PUT \/api\/message-nodes\/n2$/).buttons[0].nextAction).toMatchObject({ type: 'opt_in', replyText: 'Welcome back!' });
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/pc1$/)).toEqual({ consentWordingAck: { textHash: expect.stringMatching(/^[0-9a-f]{14}$/) } });
    });

    // What the server hands back for node n2 (see openConsentEditor), in the editor's own shape: the wording the stored hash must match.
    const SAVED_WORDING = {
      bodyText: GOOD_BODY,
      buttons: [{ position: 0, label: 'Yes, send me offers', nextAction: 'opt_in' as const, replyText: 'Hello!' }, { position: 1, label: 'No thanks', nextAction: 'opt_out' as const, replyText: '' }],
    };

    it('when the acknowledgement call fails after the message itself was saved, the editor shows what the server now holds (an edited, approved message needs approval again)', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({
        ...CONSENT_PROMO, entryNodeId: { _id: 'n2', templateStatus: 'approved' },
        consentWordingAck: { at: '2026-10-20T10:00:00Z', textHash: consentWordingHash(SAVED_WORDING) },
      });
      await ctx.settle((req, path) => (/\/message-nodes\/n2$/.test(path) && req.request.method === 'GET'
        ? { _id: 'n2', bodyText: GOOD_BODY, templateStatus: 'approved', buttons: [{ position: 0, label: 'Yes, send me offers', nextAction: { type: 'opt_in', replyText: 'Hello!' } }, { position: 1, label: 'No thanks', nextAction: { type: 'opt_out', replyText: '' } }] }
        : undefined));
      expect(ctx.comp.existingEntryNode.templateStatus).toBe('approved');
      expect(button(ctx.el, 'Submit for Approval')).toBeUndefined(); // approved: nothing to submit
      ctx.comp.entryDraft.buttons[0].replyText = 'Welcome back!'; // the wording changes ...
      await ctx.settle();
      ackBox(ctx).click(); // ... and is confirmed again
      await ctx.settle();
      const heldAckHash = () => (ctx.comp as any).consentAckHash as string; // what the screen believes the server holds as acknowledged (private state)
      const oldHash = heldAckHash();
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'PUT' && /\/message-nodes\/n2$/.test(path)) return { _id: 'n2', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] }; // the server reset the template
        if (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path)) return { __error: 500, body: { error: 'Database busy' } }; // ... but recording the tick failed
        return undefined;
      });
      expect(ctx.comp.entryError).toBe('Database busy');
      expect(ctx.comp.savingEntryNode).toBe(false);
      expect(ctx.comp.existingEntryNode.templateStatus).toBe('not_created'); // not the stale "approved"
      expect(button(ctx.el, 'Submit for Approval')).toBeDefined(); // so the way to re-submit is on screen again
      expect(heldAckHash()).toBe(oldHash); // what the server holds as acknowledged is unchanged
    });

    it('a message that was never linked to its promotion is still linked by the next Save when the first attempt failed at the link', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'POST' && /\/message-nodes$/.test(path)) return { _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] };
        if (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path)) return { __error: 500, body: { error: 'Database busy' } };
        return undefined;
      });
      expect(ctx.comp.entryError).toBe('Database busy');
      expect(ctx.comp.existingEntryNode).toBeNull(); // not linked yet: that is what makes the next Save try again
      ctx.bodies.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'PUT' && /\/message-nodes\/n9$/.test(path)) return { _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] };
        if (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path)) return { ...CONSENT_PROMO, entryNodeId: 'n9' };
        return undefined;
      });
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/pc1$/)).toMatchObject({ entryNodeId: 'n9' });
      expect(ctx.comp.existingEntryNode._id).toBe('n9');
      expect(ctx.comp.entryError).toBeNull();
    });

    it('closing the editor (or opening another promotion) while a Save is under way: the link and the acknowledgement still go to the promotion that was saved, and the editor open now is untouched', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      saveBtn(ctx).click();
      const [post] = ctx.http.match((r) => r.method === 'POST' && /\/message-nodes$/.test(r.url)); // the first of the Save's requests, held back
      expect(post.request.body.ownerId).toBe('pc1');
      ctx.comp.closeModal();
      ctx.comp.openViewEdit({ ...CONSENT_PROMO, _id: 'pB', name: 'Other', entryNodeId: null });
      post.flush({ _id: 'n9', bodyText: GOOD_BODY, templateStatus: 'not_created', buttons: [] });
      await ctx.settle((req, path) => (req.request.method === 'PUT' && /\/promotions\/pc1$/.test(path) ? { ...CONSENT_PROMO, entryNodeId: 'n9' } : undefined));
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/pc1$/)).toEqual({ entryNodeId: 'n9', consentWordingAck: { textHash: expect.stringMatching(/^[0-9a-f]{14}$/) } });
      expect(ctx.seen.some((s) => /^PUT \/api\/promotions\/(null|pB)/.test(s))).toBe(false);
      expect(ctx.comp.editingPromoId).toBe('pB');
      expect(ctx.comp.existingEntryNode).toBeNull(); // not the message of the promotion that was saved
      expect(ctx.comp.entryError).toBeNull();
      expect(ctx.comp.savingEntryNode).toBe(false);
    });

    it('a Save that fails after the editor was closed shows no error in the editor that is open now', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = goodDraft();
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      saveBtn(ctx).click();
      const [post] = ctx.http.match((r) => r.method === 'POST' && /\/message-nodes$/.test(r.url));
      ctx.comp.closeModal();
      ctx.comp.openViewEdit({ ...CONSENT_PROMO, _id: 'pB', name: 'Other', entryNodeId: null });
      post.flush({ error: 'Database busy' }, { status: 500, statusText: 'err' });
      await ctx.settle();
      expect(ctx.comp.entryError).toBeNull();
      expect(ctx.comp.savingEntryNode).toBe(false);
    });

    it('"Copy from another promotion" on a promotion that already has a message puts the copy into THAT message (same id): Save updates it instead of creating a second one nothing points at', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, entryNodeId: { _id: 'n1', templateStatus: 'approved' } });
      await ctx.settle((req, path) => (/\/message-nodes\/n1$/.test(path) && req.request.method === 'GET'
        ? { _id: 'n1', bodyText: 'Hi there', templateStatus: 'approved', buttons: [{ position: 0, label: 'Shop', nextAction: { type: 'end_flow' } }] } : undefined));
      expect(ctx.comp.entryDraft.targetNodeId).toBe('n1');
      ctx.comp.promotions = [{ _id: 'q1', name: 'Q', entryNodeId: { _id: 'nq', templateStatus: 'approved' } }];
      ctx.comp.duplicateFromPromoId = 'q1';
      const copying = ctx.comp.duplicateEntryFrom();
      await ctx.settle((req, path) => (/\/message-nodes\/nq$/.test(path) && req.request.method === 'GET'
        ? { _id: 'nq', bodyText: 'Copied wording {{1}}', templateStatus: 'approved', buttons: [{ position: 0, label: 'Browse', nextAction: { type: 'end_flow' } }] } : undefined));
      await copying;
      expect(ctx.comp.entryDraft).toMatchObject({ bodyText: 'Copied wording {{1}}', targetNodeId: 'n1' });
      expect(ctx.comp.entryDraft.buttons[0].label).toBe('Browse');
      ctx.bodies.length = 0;
      ctx.seen.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => (/\/message-nodes\/n1$/.test(path) && req.request.method === 'PUT' ? { _id: 'n1', bodyText: 'Copied wording {{1}}', templateStatus: 'not_created', buttons: [] } : undefined));
      expect(ctx.seen.filter((s) => s === 'POST /api/message-nodes')).toEqual([]); // no second message
      expect(ctx.bodyOf(/^PUT \/api\/message-nodes\/n1$/)).toMatchObject({ bodyText: 'Copied wording {{1}}' });
      expect(ctx.comp.existingEntryNode._id).toBe('n1');
    });

    it('"Copy from another promotion" on a promotion with no message yet still creates one (nothing to keep)', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, entryNodeId: null });
      await ctx.settle();
      ctx.comp.useCustomEntry = true;
      ctx.comp.promotions = [{ _id: 'q1', name: 'Q', entryNodeId: { _id: 'nq', templateStatus: 'approved' } }];
      ctx.comp.duplicateFromPromoId = 'q1';
      const copying = ctx.comp.duplicateEntryFrom();
      await ctx.settle((req, path) => (/\/message-nodes\/nq$/.test(path) && req.request.method === 'GET'
        ? { _id: 'nq', bodyText: 'Copied wording {{1}}', templateStatus: 'approved', buttons: [{ position: 0, label: 'Browse', nextAction: { type: 'end_flow' } }] } : undefined));
      await copying;
      expect(ctx.comp.entryDraft.targetNodeId).toBeUndefined();
      ctx.seen.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => {
        if (req.request.method === 'POST' && /\/message-nodes$/.test(path)) return { _id: 'n7', bodyText: 'Copied wording {{1}}', templateStatus: 'not_created', buttons: [] };
        if (req.request.method === 'PUT' && /\/promotions\/p1$/.test(path)) return { _id: 'p1', entryNodeId: 'n7' };
        return undefined;
      });
      expect(ctx.seen).toContain('POST /api/message-nodes');
      expect(ctx.bodyOf(/^PUT \/api\/promotions\/p1$/)).toMatchObject({ entryNodeId: 'n7' });
    });

    it('a message that finishes loading after the editor was closed or opened for another promotion does not fill that editor', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ ...CONSENT_PROMO, _id: 'pA', entryNodeId: { _id: 'nA', templateStatus: 'approved' } });
      const [heldA] = ctx.http.match((r) => /\/message-nodes\/nA$/.test(r.url)); // promotion A's message is slow
      ctx.comp.closeModal();
      ctx.comp.openViewEdit({ ...CONSENT_PROMO, _id: 'pB', entryNodeId: null }); // promotion B has none yet
      heldA.flush({ _id: 'nA', bodyText: 'A wording', templateStatus: 'approved', buttons: [{ position: 0, label: 'Yes', nextAction: { type: 'opt_in', replyText: '' } }] });
      await ctx.settle();
      expect(ctx.comp.editingPromoId).toBe('pB');
      expect(ctx.comp.existingEntryNode).toBeNull(); // saving here would otherwise have updated A's message and never linked one to B
      expect(ctx.comp.entryDraft.bodyText).toBe('');

      // closing the editor altogether is the same
      ctx.comp.closeModal();
      ctx.comp.openViewEdit({ ...CONSENT_PROMO, _id: 'pA', entryNodeId: { _id: 'nA', templateStatus: 'approved' } });
      const [again] = ctx.http.match((r) => /\/message-nodes\/nA$/.test(r.url));
      ctx.comp.closeModal();
      again.flush({ _id: 'nA', bodyText: 'A wording', templateStatus: 'approved', buttons: [{ position: 0, label: 'Yes', nextAction: { type: 'opt_in', replyText: '' } }] });
      await ctx.settle();
      expect(ctx.comp.existingEntryNode).toBeNull();
    });

    it('the acknowledgement covers a follow-up message too: rewriting it withdraws the tick', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx);
      ctx.comp.entryDraft = {
        ...goodDraft(),
        buttons: [...goodDraft().buttons, { position: 2, label: 'Tell me more', nextAction: 'send_message' as const, followUp: { bodyText: 'Our spring offers: 30% off.', buttons: [] } }],
      };
      await ctx.settle();
      ackBox(ctx).click();
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(true);
      ctx.comp.entryDraft.buttons[2].followUp!.bodyText = 'Our spring offers: 30% off - today only!';
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(false);
      expect(saveBtn(ctx).disabled).toBe(true);
    });

    it('a promotion acknowledged before keeps that acknowledgement while its wording is the one that was acknowledged, and loses it when the wording changes', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, {
        entryNodeId: { _id: 'n2', templateStatus: 'not_created' },
        consentWordingAck: { at: '2026-10-20T10:00:00Z', textHash: consentWordingHash(SAVED_WORDING) },
      });
      expect(ctx.comp.consentAckValid).toBe(true);
      expect(saveBtn(ctx).disabled).toBe(false);
      ctx.comp.entryDraft.bodyText += ' Bye.';
      expect(ctx.comp.consentAckValid).toBe(false);
    });

    it('an old acknowledgement does NOT carry over to different saved wording (changed elsewhere since): the box is unticked and saving is blocked until it is confirmed again', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, {
        entryNodeId: { _id: 'n2', templateStatus: 'not_created' },
        consentWordingAck: { at: '2026-10-20T10:00:00Z', textHash: consentWordingHash({ ...SAVED_WORDING, bodyText: 'Some earlier wording that was acknowledged' }) },
      });
      expect(ctx.comp.consentAck).toBe(false);
      expect(ctx.comp.consentAckValid).toBe(false);
      expect(ackBox(ctx).checked).toBe(false);
      expect(saveBtn(ctx).disabled).toBe(true);
      ackBox(ctx).click(); // confirming the wording as it stands now
      await ctx.settle();
      expect(ctx.comp.consentAckValid).toBe(true);
      expect(saveBtn(ctx).disabled).toBe(false);
    });

    it('an acknowledgement with no fingerprint (nothing says which wording it was) does not count either', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' }, consentWordingAck: { at: '2026-10-20T10:00:00Z' } });
      expect(ctx.comp.consentAck).toBe(false);
      expect(ctx.comp.consentAckValid).toBe(false);
      expect(saveBtn(ctx).disabled).toBe(true);
    });

    it('an ordinary promotion\'s save is unchanged: no replyText, no acknowledgement, no promotion update for an existing message', async () => {
      const ctx = await boot();
      ctx.comp.openViewEdit({ _id: 'p1', name: 'Sale', status: 'draft', sentCount: 0, customerType: 'cash', discountPercent: 10, entryNodeId: { _id: 'n1', templateStatus: 'approved' } });
      await ctx.settle((req, path) => (/\/message-nodes\/n1$/.test(path) && req.request.method === 'GET'
        ? { _id: 'n1', bodyText: 'Hi there', templateStatus: 'approved', buttons: [{ position: 0, label: 'Shop', nextAction: { type: 'end_flow' } }] } : undefined));
      ctx.bodies.length = 0;
      saveBtn(ctx).click();
      await ctx.settle((req, path) => (/\/message-nodes\/n1$/.test(path) && req.request.method === 'PUT' ? { _id: 'n1', bodyText: 'Hi there', templateStatus: 'approved', buttons: [] } : undefined));
      const put = ctx.bodyOf(/^PUT \/api\/message-nodes\/n1$/);
      expect('replyText' in put.buttons[0].nextAction).toBe(false);
      expect(ctx.seen.some((s) => /^PUT \/api\/promotions\//.test(s))).toBe(false);
    });
  });

  describe('sending it for approval', () => {
    it('needs the acknowledgement, and shows the reason when the server refuses it', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' } });
      expect(button(ctx.el, 'Submit for Approval')!.disabled).toBe(true);
      ackBox(ctx).click();
      await ctx.settle();
      expect(button(ctx.el, 'Submit for Approval')!.disabled).toBe(false);

      button(ctx.el, 'Submit for Approval')!.click();
      await ctx.settle((req, path) => (/submit-template$/.test(path) ? { __error: 400, body: { error: 'The message body must not end with a variable.' } } : undefined));
      expect(ctx.comp.entryError).toBe('The message body must not end with a variable.');
      expect(ctx.text()).toContain('The message body must not end with a variable.');
      expect(ctx.comp.submittingTemplate).toBe(false);
    });

    it('a raw Meta error body is turned into its message instead of being swallowed', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' } });
      ackBox(ctx).click();
      await ctx.settle();
      button(ctx.el, 'Submit for Approval')!.click();
      await ctx.settle((req, path) => (/submit-template$/.test(path) ? { __error: 400, body: { error: { error: { message: 'Invalid parameter' } } } } : undefined));
      expect(ctx.comp.entryError).toBe('Invalid parameter');
    });

    it('success shows the new status', async () => {
      const ctx = await boot();
      await openConsentEditor(ctx, { entryNodeId: { _id: 'n2', templateStatus: 'not_created' } });
      ackBox(ctx).click();
      await ctx.settle();
      button(ctx.el, 'Submit for Approval')!.click();
      await ctx.settle((req, path) => (/submit-template$/.test(path) ? { _id: 'n2', bodyText: GOOD_BODY, templateStatus: 'pending', buttons: [] } : undefined));
      expect(ctx.comp.existingEntryNode.templateStatus).toBe('pending');
      expect(ctx.text()).toContain('This message is being sent to Facebook (Meta) for approval - sending is paused until it is approved.');
      expect(ctx.text()).not.toContain('silently fall back');
    });
  });
});
