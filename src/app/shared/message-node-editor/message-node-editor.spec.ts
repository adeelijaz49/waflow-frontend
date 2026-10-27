import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CONSENT_BODY_SUGGESTIONS } from './consent-wording';
import { MessageNodeDraft, MessageNodeEditor } from './message-node-editor';

// The shared message editor: label limit 25 on the entry step and 20 deeper, with a live counter; and, for a consent
// request, per-button Opt in / Opt out / Interested / None, an editable confirmation text, the one-click preset and the
// alternative label pairs.
vi.setConfig({ testTimeout: 30000 });

async function setup(node: MessageNodeDraft, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(MessageNodeEditor);
  fixture.componentRef.setInput('node', node);
  fixture.componentRef.setInput('variableSource', 'promotion');
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush([])); // the variable chips
  const emitted: MessageNodeDraft[] = [];
  fixture.componentInstance.nodeChange.subscribe((n) => emitted.push(JSON.parse(JSON.stringify(n))));
  const refresh = async () => { fixture.componentRef.changeDetectorRef.markForCheck(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  await refresh();
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, emitted, refresh };
}
const text = (e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim();
const labelInputs = (el: HTMLElement) => Array.from(el.querySelectorAll('.button-row-main input')) as HTMLInputElement[];
const actionSelects = (el: HTMLElement) => Array.from(el.querySelectorAll('.button-row select')) as HTMLSelectElement[];
const optionValues = (s: HTMLSelectElement) => Array.from(s.options).map((o) => o.value);
const draft = (): MessageNodeDraft => ({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Shop', nextAction: 'end_flow' }] });

describe('MessageNodeEditor', () => {
  describe('button label limit', () => {
    it('entry step: 25 characters, with a live n/25 counter', async () => {
      const { el, comp, refresh } = await setup(draft());
      expect(comp.labelMax).toBe(25);
      expect(labelInputs(el)[0].getAttribute('maxlength')).toBe('25');
      expect(text(el.querySelector('.char-count')!)).toBe('4/25');
      comp.node.buttons[0].label = 'Yes, send me offers';
      await refresh();
      expect(text(el.querySelector('.char-count')!)).toBe('19/25');
      expect(el.querySelector('.char-count-over')).toBeNull();
    });

    it('a follow-up step: 20 characters', async () => {
      const { el, comp } = await setup(draft(), { depth: 1 });
      expect(comp.labelMax).toBe(20);
      expect(labelInputs(el)[0].getAttribute('maxlength')).toBe('20');
      expect(text(el.querySelector('.char-count')!)).toBe('4/20');
    });

    it('the counter turns red over the limit (a pasted-in value from an older save)', async () => {
      const long = { bodyText: 'x', buttons: [{ position: 0, label: 'A'.repeat(22), nextAction: 'end_flow' as const }] };
      const entry = await setup(long);
      expect(entry.el.querySelector('.char-count-over')).toBeNull(); // 22 fits in 25
      TestBed.resetTestingModule();
      const deeper = await setup({ bodyText: 'x', buttons: [{ position: 0, label: 'A'.repeat(22), nextAction: 'end_flow' }] }, { depth: 2 });
      expect(deeper.el.querySelector('.char-count-over')).not.toBeNull(); // too long for 20
    });

    it('nested follow-up editors get the deeper limit automatically', async () => {
      const node: MessageNodeDraft = { bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes', nextAction: 'send_message', followUp: { bodyText: 'Great', buttons: [{ position: 0, label: 'Thanks', nextAction: 'end_flow' }] } }] };
      const { el } = await setup(node);
      const inputs = labelInputs(el);
      expect(inputs.map((i) => i.getAttribute('maxlength'))).toEqual(['25', '20']);
    });
  });

  describe('the standard editor (not a consent request) is unchanged', () => {
    it('offers the same four actions and no consent controls', async () => {
      const { el } = await setup(draft());
      expect(optionValues(actionSelects(el)[0])).toEqual(['end_flow', 'send_message', 'apply_discount', 'redeem_points']);
      expect(el.querySelector('.consent-presets')).toBeNull();
      expect(el.querySelector('.consent-confirmation')).toBeNull();
      expect(text(actionSelects(el)[0].options[0] as unknown as Element)).toBe('End here');
    });

    it('consent controls never show on a follow-up step, even when asked', async () => {
      const { el, comp } = await setup(draft(), { depth: 1, allowConsentActions: true });
      expect(comp.consentMode).toBe(false);
      expect(el.querySelector('.consent-presets')).toBeNull();
      expect(optionValues(actionSelects(el)[0])).not.toContain('opt_in');
    });

    it('a button that already has a consent action shows it (so it is never silently blanked)', async () => {
      const { el } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Join', nextAction: 'opt_in' }] });
      const sel = actionSelects(el)[0];
      expect(optionValues(sel)).toContain('opt_in');
      expect(sel.value).toBe('opt_in');
    });
  });

  describe('consent request mode', () => {
    it('offers Opt in / Opt out / Interested / None per button, with the label counter at 25', async () => {
      const { el } = await setup(draft(), { allowConsentActions: true });
      const sel = actionSelects(el)[0];
      expect(optionValues(sel)).toEqual(['opt_in', 'opt_out', 'interested', 'end_flow']);
      expect(Array.from(sel.options).map((o) => (o.textContent || '').trim())).toEqual(['Opt in', 'Opt out', 'Interested', 'None']);
      expect(text(el.querySelector('.char-count')!)).toBe('4/25');
    });

    it('choosing a consent action shows an editable confirmation text, and the draft carries it', async () => {
      const { el, comp, emitted, refresh } = await setup(draft(), { allowConsentActions: true });
      expect(el.querySelector('.consent-confirmation')).toBeNull(); // "None": nothing to confirm
      const sel = actionSelects(el)[0];
      sel.value = 'opt_in';
      sel.dispatchEvent(new Event('change'));
      await refresh();
      expect(comp.node.buttons[0].nextAction).toBe('opt_in');
      const box = el.querySelector('.consent-confirmation textarea') as HTMLTextAreaElement;
      expect(box).not.toBeNull();
      expect(box.getAttribute('maxlength')).toBe('1000');
      expect(box.placeholder).toContain('standard thank-you'); // described in words: custom text is sent exactly as written, so no sentence with blanks
      expect(text(el.querySelector('.consent-confirmation')!)).toContain('Confirmation sent when a customer opts in');

      box.value = 'Welcome aboard!';
      box.dispatchEvent(new Event('input'));
      await refresh();
      expect(comp.node.buttons[0].replyText).toBe('Welcome aboard!');
      expect(emitted.at(-1)!.buttons[0]).toMatchObject({ nextAction: 'opt_in', replyText: 'Welcome aboard!' });
    });

    it('each action has its own hint; Interested says the reply is optional', async () => {
      const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'A', nextAction: 'opt_out' }, { position: 1, label: 'B', nextAction: 'interested' }] }, { allowConsentActions: true });
      const boxes = Array.from(el.querySelectorAll('.consent-confirmation')) as HTMLElement[];
      expect(boxes.map(text)[0]).toContain('Confirmation sent when a customer opts out');
      const hint = (boxes[0].querySelector('textarea') as HTMLTextAreaElement).placeholder;
      expect(hint).toContain('standard reply');
      expect(hint).toContain('opt back in');
      expect(hint).not.toMatch(/[{}<>]/); // nothing that looks like a blank to fill in: custom text is sent exactly as written
      expect(boxes.map(text)[1]).toContain('Reply sent when a customer taps this (optional)');
      expect(comp.defaultConfirmations['interested']).toBeTruthy();
      await refresh();
    });

    it('moving a button away from a consent action drops its confirmation text', async () => {
      const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes', nextAction: 'opt_in', replyText: 'Welcome!' }] }, { allowConsentActions: true });
      const sel = actionSelects(el)[0];
      sel.value = 'end_flow';
      sel.dispatchEvent(new Event('change'));
      await refresh();
      expect(comp.node.buttons[0].nextAction).toBe('end_flow');
      expect('replyText' in comp.node.buttons[0]).toBe(false);
      expect(el.querySelector('.consent-confirmation')).toBeNull();
    });

    it('moving between two consent actions keeps what was typed', async () => {
      const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes', nextAction: 'opt_in', replyText: 'Thanks!' }] }, { allowConsentActions: true });
      const sel = actionSelects(el)[0];
      sel.value = 'interested';
      sel.dispatchEvent(new Event('change'));
      await refresh();
      expect(comp.node.buttons[0].replyText).toBe('Thanks!');
    });

    describe('the "Opt-in request" preset', () => {
      it('is one click: Opt in + Opt out buttons and the suggested wording when the message is empty', async () => {
        const { el, comp, emitted, refresh } = await setup({ bodyText: '', buttons: [] }, { allowConsentActions: true });
        (Array.from(el.querySelectorAll('.consent-presets button')).find((b) => text(b) === 'Opt-in request') as HTMLButtonElement).click();
        await refresh();
        expect(comp.node.buttons).toEqual([
          { position: 0, label: 'Yes, send me offers', nextAction: 'opt_in' },
          { position: 1, label: 'No thanks', nextAction: 'opt_out' },
        ]);
        expect(comp.node.bodyText).toBe(CONSENT_BODY_SUGGESTIONS[0].body);
        expect(emitted.length).toBe(1);
        // and the labels are ordinary editable inputs showing the new values
        expect(labelInputs(el).map((i) => i.value)).toEqual(['Yes, send me offers', 'No thanks']);
        expect(labelInputs(el).every((i) => !i.disabled && !i.readOnly)).toBe(true);
      });

      it('never overwrites the merchant\'s own wording, and keeps confirmation texts already written', async () => {
        const mine = 'My own words about offers on WhatsApp.';
        const { el, comp, refresh } = await setup({ bodyText: mine, buttons: [{ position: 0, label: 'Whatever', nextAction: 'opt_in', replyText: 'Thanks!' }, { position: 1, label: 'Nope', nextAction: 'interested' }, { position: 2, label: 'Hmm', nextAction: 'end_flow' }] }, { allowConsentActions: true });
        (Array.from(el.querySelectorAll('.consent-presets button')).find((b) => text(b) === 'Opt-in request') as HTMLButtonElement).click();
        await refresh();
        expect(comp.node.bodyText).toBe(mine);
        expect(comp.node.buttons).toEqual([
          { position: 0, label: 'Yes, send me offers', nextAction: 'opt_in', replyText: 'Thanks!' },
          { position: 1, label: 'No thanks', nextAction: 'opt_out' },
        ]);
      });
    });

    describe('the alternative label pairs', () => {
      it('lists the four pairs', async () => {
        const { el } = await setup(draft(), { allowConsentActions: true });
        const opts = Array.from(el.querySelectorAll('.consent-pair-select option')).map((o) => text(o));
        expect(opts).toEqual(['Button label pairs...', '"Yes, send me offers" / "No thanks"', '"Yes, I\'m in" / "No thanks"', '"Yes, include me" / "No thanks"', '"OPT IN" / "OPT OUT"']);
      });

      it('sets the labels of the existing Opt in / Opt out buttons and leaves everything else alone', async () => {
        const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes, send me offers', nextAction: 'opt_in', replyText: 'Thanks!' }, { position: 1, label: 'No thanks', nextAction: 'opt_out' }] }, { allowConsentActions: true });
        const select = el.querySelector('.consent-pair-select') as HTMLSelectElement;
        select.value = 'opt_in_out';
        select.dispatchEvent(new Event('change'));
        await refresh();
        expect(comp.node.buttons.map((b) => [b.label, b.nextAction, b.replyText])).toEqual([['OPT IN', 'opt_in', 'Thanks!'], ['OPT OUT', 'opt_out', undefined]]);
        expect(select.value).toBe(''); // back to the prompt, ready for another choice
      });

      it('adds the missing buttons (within the limit of three)', async () => {
        const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [] }, { allowConsentActions: true });
        const select = el.querySelector('.consent-pair-select') as HTMLSelectElement;
        select.value = 'im_in';
        select.dispatchEvent(new Event('change'));
        await refresh();
        expect(comp.node.buttons.map((b) => [b.position, b.label, b.nextAction])).toEqual([[0, "Yes, I'm in", 'opt_in'], [1, 'No thanks', 'opt_out']]);

        const full = await (async () => { TestBed.resetTestingModule(); return setup({ bodyText: 'Hi', buttons: [
          { position: 0, label: 'a', nextAction: 'interested' }, { position: 1, label: 'b', nextAction: 'interested' }, { position: 2, label: 'c', nextAction: 'interested' }] }, { allowConsentActions: true }); })();
        full.comp.applyLabelPair('include_me');
        expect(full.comp.node.buttons).toHaveLength(3); // no room: nothing added
        expect(full.comp.node.buttons.map((b) => b.label)).toEqual(['a', 'b', 'c']);
      });

      it('an unknown pair does nothing', async () => {
        const { comp, emitted } = await setup(draft(), { allowConsentActions: true });
        comp.applyLabelPair('nope');
        expect(emitted).toEqual([]);
        expect(comp.node.buttons[0].label).toBe('Shop');
      });

      it('every label stays editable after a pair is applied', async () => {
        const { el, comp, refresh } = await setup({ bodyText: 'Hi', buttons: [] }, { allowConsentActions: true });
        comp.applyLabelPair('send_offers');
        await refresh();
        const input = labelInputs(el)[0];
        input.value = 'Count me in';
        input.dispatchEvent(new Event('input'));
        await refresh();
        expect(comp.node.buttons[0].label).toBe('Count me in');
        expect(text(el.querySelector('.char-count')!)).toBe('11/25');
      });
    });

    it('adding and removing buttons still works (3 at most) and renumbers positions', async () => {
      const { comp, refresh } = await setup({ bodyText: 'Hi', buttons: [] }, { allowConsentActions: true });
      comp.addButton(); comp.addButton(); comp.addButton(); comp.addButton();
      expect(comp.node.buttons.map((b) => b.position)).toEqual([0, 1, 2]);
      comp.removeButton(1);
      expect(comp.node.buttons.map((b) => b.position)).toEqual([0, 1]);
      await refresh();
    });
  });
});
