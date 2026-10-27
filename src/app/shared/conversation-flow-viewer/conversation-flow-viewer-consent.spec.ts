import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { LocalizationApiService } from '../../services/localization-api.service';
import { MessageNodeDraft } from '../message-node-editor/message-node-editor';
import { ConversationFlowViewer } from './conversation-flow-viewer';

// The conversation view for a consent request: the entry step's buttons offer Opt in / Opt out / Interested / None,
// the editor it opens knows which step it is editing (25-character labels on the entry step, 20 deeper).
vi.setConfig({ testTimeout: 30000 });

const tree = (): MessageNodeDraft => ({
  bodyText: 'Want offers on WhatsApp?', targetNodeId: 'n1',
  buttons: [
    { position: 0, label: 'Yes, send me offers', nextAction: 'opt_in', replyText: 'Welcome!' },
    { position: 1, label: 'No thanks', nextAction: 'opt_out' },
    { position: 2, label: 'Tell me more', nextAction: 'send_message', followUp: { bodyText: 'More info here', buttons: [{ position: 0, label: 'Thanks', nextAction: 'end_flow' }] } },
  ],
});

async function setup(root: MessageNodeDraft, inputs: Record<string, unknown> = {}) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: LocalizationApiService, useValue: { getFlowOwnerTree: vi.fn(), listFlowTrees: vi.fn() } }],
  });
  const fixture = TestBed.createComponent(ConversationFlowViewer);
  fixture.componentRef.setInput('root', root);
  fixture.componentRef.setInput('variableSource', 'promotion');
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const refresh = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, refresh };
}
// zoneless test bed: a change made straight on the component needs a dirty mark before it is rendered
const mark = (f: { componentRef: { changeDetectorRef: { markForCheck(): void } }; detectChanges(): void }) => { f.componentRef.changeDetectorRef.markForCheck(); f.detectChanges(); };
const text = (e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim();
const chips = (el: HTMLElement) => Array.from(el.querySelectorAll('.convo-chip-group')) as HTMLElement[];
const pickerOptions = (el: HTMLElement) => Array.from(el.querySelectorAll('.convo-action-picker .convo-action-option')).map((o) => text(o));

describe('ConversationFlowViewer: consent request', () => {
  it('tags each chip with the consent action it performs', async () => {
    const { el } = await setup(tree(), { allowConsentActions: true });
    expect(chips(el).map((c) => text(c.querySelector('.convo-chip-row')!).replace('⚙', '').trim())).toEqual(['Yes, send me offers Opt in', 'No thanks Opt out', 'Tell me more']);
  });

  it('the action picker of an entry button offers Opt in / Opt out / Interested / None', async () => {
    const { fixture, el, comp } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes', nextAction: 'end_flow' }] }, { allowConsentActions: true });
    comp.openActionPicker(comp.root.buttons[0]);
    mark(fixture);
    expect(pickerOptions(el)).toEqual(['Opt in', 'Opt out', 'Interested', 'None']);
  });

  it('choosing one sets the action and emits the root', async () => {
    const root: MessageNodeDraft = { bodyText: 'Hi', buttons: [{ position: 0, label: 'Yes', nextAction: 'end_flow' }] };
    const { fixture, el, comp } = await setup(root, { allowConsentActions: true });
    const emitted: MessageNodeDraft[] = [];
    comp.rootChange.subscribe((r) => emitted.push(r));
    comp.openActionPicker(root.buttons[0]);
    mark(fixture);
    const radios = Array.from(el.querySelectorAll('.convo-action-picker input[type="radio"]')) as HTMLInputElement[];
    radios[0].click(); // Opt in
    mark(fixture);
    expect(root.buttons[0].nextAction).toBe('opt_in');
    expect(emitted).toEqual([root]);
    expect(comp.actionName('opt_in')).toBe('Opt in');
  });

  it('setAction away from a consent action drops its confirmation text (and a follow-up subtree)', async () => {
    const root = tree();
    const { comp } = await setup(root, { allowConsentActions: true });
    comp.setAction(root.buttons[0], 'end_flow');
    expect('replyText' in root.buttons[0]).toBe(false);
    comp.setAction(root.buttons[1], 'interested');
    expect(root.buttons[1].nextAction).toBe('interested');
  });

  it('an existing follow-up button keeps its follow-up option in the picker', async () => {
    const { fixture, el, comp } = await setup(tree(), { allowConsentActions: true });
    comp.openActionPicker(comp.root.buttons[2]);
    mark(fixture);
    expect(pickerOptions(el).join('|')).toContain('Send a follow-up message');
    expect(pickerOptions(el).join('|')).toContain('Opt in');
  });

  it('deeper steps are ordinary: no consent options in their picker', async () => {
    const { fixture, el, comp } = await setup(tree(), { allowConsentActions: true });
    (el.querySelectorAll('.convo-chip')[2] as HTMLButtonElement).click(); // walk into the follow-up
    mark(fixture);
    expect(comp.currentDepth).toBe(1);
    expect(comp.consentMode).toBe(false);
    comp.openActionPicker(comp.lastStep!.node.buttons[0]);
    mark(fixture);
    expect(pickerOptions(el).join('|')).not.toContain('Opt in');
    expect(pickerOptions(el)[0]).toBe('End here');
  });

  it('without the input nothing changes: the usual four actions and no consent options', async () => {
    const { fixture, el, comp } = await setup({ bodyText: 'Hi', buttons: [{ position: 0, label: 'Shop', nextAction: 'end_flow' }] });
    comp.openActionPicker(comp.root.buttons[0]);
    mark(fixture);
    expect(pickerOptions(el)).toEqual(['End here', 'Send a follow-up message', 'Apply a discount (not yet available)', 'Mark points redeemed (not yet available)']);
    expect(el.querySelector('.convo-chip-action')).toBeNull();
  });

  describe('the editor it opens knows which step it edits', () => {
    const limits = (el: HTMLElement) => Array.from(el.querySelectorAll('.convo-edit-drawer .button-row-main input')).map((i) => i.getAttribute('maxlength'));

    it('entry step: 25 characters, consent controls available', async () => {
      const { fixture, el } = await setup(tree(), { allowConsentActions: true });
      (el.querySelector('.convo-bubble-business') as HTMLElement).click();
      mark(fixture);
      expect(limits(el)).toEqual(['25', '25', '25']);
      expect(el.querySelector('.convo-edit-drawer .consent-presets')).not.toBeNull();
      expect(el.querySelectorAll('.convo-edit-drawer .consent-confirmation').length).toBe(2); // the two consent buttons
    });

    it('a follow-up step: 20 characters and no consent controls', async () => {
      const { fixture, el } = await setup(tree(), { allowConsentActions: true });
      (el.querySelectorAll('.convo-chip')[2] as HTMLButtonElement).click();
      mark(fixture);
      (el.querySelectorAll('.convo-bubble-business')[1] as HTMLElement).click();
      mark(fixture);
      expect(limits(el)).toEqual(['20']);
      expect(el.querySelector('.convo-edit-drawer .consent-presets')).toBeNull();
    });

    it('a Flow (no consent) gets 25 on its entry step too, and 20 below', async () => {
      const { fixture, el } = await setup(tree(), { variableSource: 'flow', triggerType: 'inactiveCustomer' });
      (el.querySelector('.convo-bubble-business') as HTMLElement).click();
      mark(fixture);
      expect(limits(el)).toEqual(['25', '25', '25']);
      expect(el.querySelector('.convo-edit-drawer .consent-presets')).toBeNull();
    });
  });
});
