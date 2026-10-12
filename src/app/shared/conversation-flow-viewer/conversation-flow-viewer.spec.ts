import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { LocalizationApiService } from '../../services/localization-api.service';
import { FlowLanguageStore } from '../../pages/localization/embedded/flow-language.store';
import type { OwnerTree } from '../../pages/localization/embedded/flow-language.util';
import { MessageNodeDraft } from '../message-node-editor/message-node-editor';
import { ConversationFlowViewer } from './conversation-flow-viewer';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

// Characterisation of the viewer (it had no spec) so the small Arabic-language hunk (one @Input, one @if) cannot
// regress what it does today.

const tree = (): MessageNodeDraft => ({
  bodyText: 'Hi, we miss you!', targetNodeId: 'n1',
  buttons: [
    { position: 0, label: 'Yes please', nextAction: 'send_message', followUp: { bodyText: 'Great! Use code WELCOME20', targetNodeId: 'n2', buttons: [{ position: 0, label: 'Thanks', nextAction: 'end_flow' }] } },
    { position: 1, label: 'Not now', nextAction: 'end_flow' },
  ],
});

async function setup(root: MessageNodeDraft = tree(), api: Record<string, unknown> = {}) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LocalizationApiService, useValue: { getFlowOwnerTree: vi.fn(), listFlowTrees: vi.fn(), ...api } }],
  });
  const fixture = TestBed.createComponent(ConversationFlowViewer);
  fixture.componentRef.setInput('root', root);
  fixture.componentRef.setInput('variableSource', 'promotion');
  fixture.componentRef.setInput('templateStatus', 'approved');
  fixture.detectChanges();
  return { fixture, comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ConversationFlowViewer', () => {
  it('renders the entry bubble, its template badge, a breadcrumb and one chip per button', async () => {
    const { el } = await setup();
    expect(text(el.querySelector('.convo-breadcrumb') as HTMLElement)).toBe('Entry');
    expect(text(el.querySelector('.convo-bubble-business') as HTMLElement)).toContain('Hi, we miss you!');
    expect(text(el.querySelector('.convo-template-badge') as HTMLElement)).toBe('approved');
    expect(Array.from(el.querySelectorAll('.convo-chip')).map((c) => text(c as HTMLElement))).toEqual(['Yes please', 'Not now']);
  });

  it('tapping a chip with a follow-up walks into it (customer bubble + breadcrumb)', async () => {
    const { fixture, comp, el } = await setup();
    (el.querySelectorAll('.convo-chip')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(comp.pathSteps.length).toBe(2);
    expect(text(el.querySelector('.convo-bubble-customer') as HTMLElement)).toBe('"Yes please"');
    expect(Array.from(el.querySelectorAll('.convo-business, .convo-bubble-business')).map((b) => text(b as HTMLElement))[1]).toContain('Great! Use code WELCOME20');
    expect(Array.from(el.querySelectorAll('.convo-breadcrumb-item')).map((b) => text(b as HTMLElement))).toEqual(['Entry', 'Yes please']);
  });

  it('jumpTo returns to an earlier step', async () => {
    const { fixture, comp, el } = await setup();
    (el.querySelectorAll('.convo-chip')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelectorAll('.convo-breadcrumb-item')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(comp.pathSteps.length).toBe(1);
  });

  it('tapping a chip without a follow-up opens the action picker instead', async () => {
    const { fixture, comp, el } = await setup();
    (el.querySelectorAll('.convo-chip')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(comp.pathSteps.length).toBe(1);
    expect(el.querySelector('.convo-action-picker')).not.toBeNull();
  });

  it('clicking the bubble opens and closes the inline edit drawer', async () => {
    const { fixture, el } = await setup();
    (el.querySelector('.convo-bubble-business') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.convo-edit-drawer')).not.toBeNull();
    (el.querySelector('.convo-bubble-business') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.convo-edit-drawer')).toBeNull();
  });

  it('createFollowUp adds an empty follow-up, navigates into it and emits the root', async () => {
    const root = tree();
    const { comp } = await setup(root);
    const emitted: MessageNodeDraft[] = [];
    comp.rootChange.subscribe((r) => emitted.push(r));
    comp.createFollowUp(root.buttons[1]);
    expect(root.buttons[1].nextAction).toBe('send_message');
    expect(root.buttons[1].followUp).toEqual({ bodyText: '', buttons: [] });
    expect(comp.pathSteps.length).toBe(2);
    expect(emitted).toEqual([root]);
  });

  it('setAction away from send_message drops the follow-up subtree and emits the root', async () => {
    const root = tree();
    const { comp } = await setup(root);
    const emitted: MessageNodeDraft[] = [];
    comp.rootChange.subscribe((r) => emitted.push(r));
    comp.setAction(root.buttons[0], 'end_flow');
    expect(root.buttons[0].followUp).toBeUndefined();
    expect(root.buttons[0].nextAction).toBe('end_flow');
    expect(emitted.length).toBe(1);
  });

  it('respects the depth cap for new follow-ups', async () => {
    const root = tree();
    const { fixture, comp } = await setup(root);
    fixture.componentRef.setInput('maxDepth', 0);
    fixture.detectChanges();
    expect(comp.canOfferSendMessage(root.buttons[1])).toBe(false); // would be a new follow-up past the cap
    expect(comp.canOfferSendMessage(root.buttons[0])).toBe(true); // existing follow-up can always be inspected
  });

  describe('language strips', () => {
    const owner = (): OwnerTree => ({
      ownerType: 'promotion', ownerId: 'p1', messageSource: 'promotion',
      nodes: [{
        messageNodeId: 'n1', parentNodeId: null, parentButtonPosition: null, depth: 0, isEntry: true, bodyText: 'Hi', buttons: [],
        templateStatus: 'approved', canAddArabic: true, addArabicUrl: '/arabic/flows?node=n1',
        versions: [{ language: 'ar', body: 'مرحباً', buttons: [], metaStatus: 'APPROVED', reviewStatus: 'reviewed', stale: false, sendable: true, contentVersion: 1, editUrl: '/arabic/templates/t1' }],
      }],
    });

    it('renders nothing extra when no language owner is given (every unflagged merchant)', async () => {
      const { el } = await setup();
      expect(el.querySelector('app-node-language-strip')).toBeNull();
    });

    it('renders a strip under a saved node when the host passes the owner id and the tree is loaded', async () => {
      const { fixture, el } = await setup(tree(), { getFlowOwnerTree: vi.fn(() => of(owner())) });
      TestBed.inject(FlowLanguageStore).reloadOwner('promotion', 'p1');
      fixture.componentRef.setInput('languageOwnerId', 'p1');
      for (let i = 0; i < 8; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(el.querySelectorAll('app-node-language-strip').length).toBe(1); // only the saved node (n1) has a target id... n2 is not on the path yet
      expect(text(el)).toContain('Sends in Arabic');
      // the existing English bubble is still the edit handle
      expect(text(el.querySelector('.convo-bubble-business') as HTMLElement)).toContain('Hi, we miss you!');
    });

    it('renders no strip for an unsaved draft node (no target id)', async () => {
      const draft: MessageNodeDraft = { bodyText: 'Draft', buttons: [] };
      const { fixture, el } = await setup(draft);
      fixture.componentRef.setInput('languageOwnerId', 'p1');
      fixture.detectChanges();
      expect(el.querySelector('app-node-language-strip')).toBeNull();
    });
  });
});
