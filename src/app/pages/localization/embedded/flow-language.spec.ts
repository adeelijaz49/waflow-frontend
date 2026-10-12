import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { FlowLanguageChip } from './flow-language-chip';
import { FlowLanguagePanel } from './flow-language-panel';
import { FlowLanguageStore } from './flow-language.store';
import type { FlowTreeItem, OwnerTree, TreeNode, TreeVersion } from './flow-language.util';
import { NodeLanguageStrip } from './node-language-strip';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const ver = (over: Partial<TreeVersion> = {}): TreeVersion => ({
  language: 'ar', body: 'مرحباً {name}، اشتقنا لك', buttons: [{ position: 0, role: 'flow_button', text: 'نعم' }, { position: null, role: 'opt_out', text: 'إلغاء الاشتراك' }],
  metaStatus: 'APPROVED', reviewStatus: 'reviewed', stale: false, sendable: true, contentVersion: 1, editUrl: '/arabic/templates/t1', ...over,
});

const entry = (over: Partial<TreeNode> = {}, versions: TreeVersion[] = [ver()]): TreeNode => ({
  messageNodeId: 'n1', parentNodeId: null, parentButtonPosition: null, depth: 0, isEntry: true, bodyText: 'Hi {name}, we miss you!',
  buttons: [{ position: 0, label: 'Yes please', action: 'send_message', targetNodeId: 'n2' }], templateStatus: 'approved',
  versions, canAddArabic: true, addArabicUrl: '/arabic/flows?node=n1', ...over,
});
const followUp = (over: Partial<TreeNode> = {}, versions: TreeVersion[] = []): TreeNode => ({
  messageNodeId: 'n2', parentNodeId: 'n1', parentButtonPosition: 0, depth: 1, isEntry: false, bodyText: 'Great! Use code WELCOME20',
  buttons: [], templateStatus: null, versions, canAddArabic: true, addArabicUrl: '/arabic/flows?node=n2', ...over,
});
const tree = (nodes: TreeNode[], messageSource: OwnerTree['messageSource'] = 'promotion'): OwnerTree => ({ ownerType: 'promotion', ownerId: 'p1', messageSource, nodes });

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));

async function boot(api: Record<string, unknown>, uiLang: 'en' | 'ar' = 'en') {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  if (uiLang === 'ar') await i18n.use('ar', false);
  return i18n;
}
async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  // child components flip their own 'ready' signal one microtask/effect round later: iterate
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
}

describe('FlowLanguagePanel', () => {
  async function panel(api: Record<string, unknown>, inputs: Record<string, unknown> = {}, uiLang: 'en' | 'ar' = 'en') {
    await boot(api, uiLang);
    const fixture = TestBed.createComponent(FlowLanguagePanel);
    fixture.componentRef.setInput('ownerType', 'promotion');
    fixture.componentRef.setInput('ownerId', 'p1');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, store: TestBed.inject(FlowLanguageStore) };
  }
  const apiWith = (t: OwnerTree) => ({ getFlowOwnerTree: vi.fn(() => of(t)), listFlowTrees: vi.fn() });

  it('lists the nodes in tree order, indented, with the "After tapping" heading for follow-ups', async () => {
    const { el } = await panel(apiWith(tree([entry(), followUp()])));
    const heads = Array.from(el.querySelectorAll('.flp-head')).map((h) => text(h as HTMLElement));
    expect(heads).toEqual(['Entry message', 'After tapping “Yes please”']);
    const nodes = el.querySelectorAll<HTMLElement>('.flp-node');
    expect(nodes[0].style.marginInlineStart).toBe('0px');
    expect(nodes[1].style.marginInlineStart).toBe('14px');
  });

  it('shows English status for the entry message, "free reply" for follow-ups and the Arabic state', async () => {
    const { el } = await panel(apiWith(tree([entry(), followUp({}, [ver({ metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', sendable: false })])])));
    const t = text(el);
    expect(t).toContain('Approved');
    expect(t).toContain('Free reply, no WhatsApp approval needed');
    expect(t).toContain('Sends in Arabic');
    expect(t).toContain('Not required');
    expect(t).toContain('Needs native review');
  });

  it('shows "No Arabic yet" with an Add link for a node without an Arabic version', async () => {
    const { el } = await panel(apiWith(tree([entry({}, [])])));
    expect(text(el)).toContain('No Arabic yet - customers receive English.');
    expect(hrefs(el)).toContain('/arabic/flows?node=n1');
  });

  it('shows an out-of-date Arabic follow-up', async () => {
    const { el } = await panel(apiWith(tree([entry(), followUp({}, [ver({ metaStatus: 'NOT_REQUIRED', stale: true, sendable: false })])])));
    expect(text(el)).toContain('Out of date');
  });

  it('says Arabic is used only after the English entry message is approved', async () => {
    const { el } = await panel(apiWith(tree([entry({ templateStatus: 'pending' })])));
    expect(text(el)).toContain('Arabic is used only after the English message is approved.');
  });

  it('shows the bilingual row only when a bilingual version exists', async () => {
    const without = await panel(apiWith(tree([entry()])));
    expect(text(without.el)).not.toContain('Bilingual');
    TestBed.resetTestingModule();
    const withB = await panel(apiWith(tree([entry({}, [ver(), ver({ language: 'bilingual' })])])));
    expect(text(withB.el)).toContain('Used only when you send a campaign as bilingual.');
  });

  it('the toggle drives the previews: English, Arabic (RTL) or both side by side', async () => {
    const { fixture, el, store } = await panel(apiWith(tree([entry()])));
    expect(store.previewMode()).toBe('both');
    expect(el.querySelectorAll('app-wa-preview').length).toBe(2);
    const click = (label: string) => (Array.from(el.querySelectorAll<HTMLButtonElement>('.plt-btn')).find((b) => b.textContent?.trim() === label)!).click();
    click('English');
    fixture.detectChanges();
    expect(el.querySelectorAll('app-wa-preview').length).toBe(1);
    expect(el.querySelector('app-wa-preview .wap-frame')?.getAttribute('dir')).toBe('ltr');
    click('Arabic');
    fixture.detectChanges();
    const frames = el.querySelectorAll('app-wa-preview .wap-frame');
    expect(frames.length).toBe(1);
    expect(frames[0].getAttribute('lang')).toBe('ar');
    expect(frames[0].getAttribute('dir')).toBe('rtl');
    expect(text(el)).toContain('مرحباً {name}، اشتقنا لك');
    expect(text(el)).toContain('نعم');
    expect(el.querySelector<HTMLButtonElement>('.plt-btn[aria-pressed="true"]')?.textContent?.trim()).toBe('Arabic');
  });

  it('matches Arabic button labels by position (opt-out with position null is not shown against an English button)', async () => {
    const { el } = await panel(apiWith(tree([entry()])));
    const arabicButtons = Array.from(el.querySelectorAll('.flp-col:last-child .wap-btn')).map((b) => text(b as HTMLElement));
    expect(arabicButtons).toEqual(['نعم', 'إلغاء الاشتراك']);
  });

  it('reloads when the anchor changes (the host replaced the saved node) and keeps the old tree meanwhile', async () => {
    const answers: Subject<OwnerTree>[] = [];
    const api = { getFlowOwnerTree: vi.fn(() => { const s = new Subject<OwnerTree>(); answers.push(s); return s; }), listFlowTrees: vi.fn() };
    const { fixture, el } = await panel(api, { anchor: { v: 1 } });
    answers[0].next(tree([entry()]));
    await settle(fixture);
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('anchor', { v: 2 });
    await settle(fixture);
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(2);
    expect(text(el)).toContain('Entry message'); // old tree still visible while loading
    answers[1].next(tree([entry({ bodyText: 'Edited body' })]));
    await settle(fixture);
    expect(text(el)).toContain('Edited body');
    fixture.componentRef.setInput('anchor', { v: 2 }); // a new reference with the same content still reloads
    await settle(fixture);
    expect(api.getFlowOwnerTree).toHaveBeenCalledTimes(3);
  });

  it('shows the fixed-message note for a default-template flow (no nodes, no toggle)', async () => {
    const { el } = await panel(apiWith(tree([], 'default_template')), { ownerType: 'flow' });
    expect(text(el)).toContain('This flow sends a fixed English message.');
    expect(el.querySelector('.plt')).toBeNull();
  });

  it('shows the edit note unless readonly', async () => {
    const editable = await panel(apiWith(tree([entry()])));
    expect(text(editable.el)).toContain('A follow-up\'s Arabic version stops sending until it is re-reviewed.');
    TestBed.resetTestingModule();
    const ro = await panel(apiWith(tree([entry()])), { readonly: true });
    expect(text(ro.el)).not.toContain('stops sending until it is re-reviewed');
  });

  it('renders nothing for an unsaved owner, and on 402 / 404', async () => {
    const none = await panel(apiWith(tree([entry()])), { ownerId: null });
    expect(none.el.querySelector('section')).toBeNull();
    TestBed.resetTestingModule();
    for (const status of [402, 404]) {
      const api = { getFlowOwnerTree: vi.fn(() => throwError(() => ({ status }))), listFlowTrees: vi.fn() };
      const r = await panel(api);
      expect(r.el.querySelector('section')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('offers a retry on a server error', async () => {
    const getFlowOwnerTree = vi.fn().mockReturnValueOnce(throwError(() => ({ status: 500 }))).mockReturnValue(of(tree([entry()])));
    const { fixture, el } = await panel({ getFlowOwnerTree, listFlowTrees: vi.fn() });
    expect(text(el)).toContain('Could not load the language versions.');
    el.querySelector<HTMLButtonElement>('button.btn')!.click();
    await settle(fixture);
    expect(text(el)).toContain('Entry message');
  });

  it('keeps English labels (no Arabic, no raw keys) when the stored UI language is Arabic', async () => {
    const { el } = await panel(apiWith(tree([entry(), followUp()])), {}, 'ar');
    // strip the intended Arabic MESSAGE text (inside the preview frames) and look at the labels only
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('app-wa-preview').forEach((n) => n.remove());
    const t = text(clone);
    expect(t).toContain('Languages');
    expect(t).toContain('Sends in Arabic');
    expect(t).not.toMatch(/\p{Script=Arabic}/u);
    expect(t).not.toMatch(/(promolang|flowlang|status|common)\.[a-zA-Z]/);
  });

  it('renders Arabic labels only when explicitly asked to', async () => {
    const { el } = await panel(apiWith(tree([entry()])), { uiLang: 'ar' }, 'ar');
    expect(text(el)).toContain('اللغات');
  });
});

describe('NodeLanguageStrip', () => {
  @Component({
    imports: [NodeLanguageStrip],
    template: `<app-node-language-strip ownerType="promotion" [ownerId]="ownerId()" [nodeId]="nodeId()" />`,
  })
  class Host {
    ownerId = signal<string | null>('p1');
    nodeId = signal('n1');
  }

  async function strip(t: OwnerTree | null, state: 'ready' | '402' = 'ready') {
    const api = { getFlowOwnerTree: vi.fn(() => (state === '402' ? throwError(() => ({ status: 402 })) : of(t))), listFlowTrees: vi.fn() };
    await boot(api);
    const store = TestBed.inject(FlowLanguageStore);
    if (t || state === '402') store.reloadOwner('promotion', 'p1');
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  it('shows the Arabic status chips and (mode Both) an RTL read-only Arabic card under the node', async () => {
    const { el } = await strip(tree([entry(), followUp({}, [ver({ metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', sendable: false })])]));
    expect(text(el)).toContain('AR');
    expect(text(el)).toContain('Sends in Arabic');
    expect(el.querySelector('.wap-frame')?.getAttribute('dir')).toBe('rtl');
    expect(hrefs(el)).toContain('/arabic/templates/t1');
  });

  it('English mode shows chips only', async () => {
    const { el, store, fixture } = await strip(tree([entry()]));
    store.previewMode.set('en');
    fixture.detectChanges();
    expect(text(el)).toContain('Sends in Arabic');
    expect(el.querySelector('app-wa-preview')).toBeNull();
  });

  it('shows the Add link for a follow-up without an Arabic version', async () => {
    const { el, fixture } = await strip(tree([entry(), followUp()]));
    fixture.componentInstance.nodeId.set('n2');
    await settle(fixture);
    expect(text(el)).toContain('No Arabic yet');
    expect(hrefs(el)).toContain('/arabic/flows?node=n2');
  });

  it('renders nothing for a node that is not in the tree, an unknown owner, or an unavailable tree', async () => {
    const { el, fixture } = await strip(tree([entry()]));
    fixture.componentInstance.nodeId.set('missing');
    await settle(fixture);
    expect(el.textContent?.trim()).toBe('');
    fixture.componentInstance.nodeId.set('n1');
    fixture.componentInstance.ownerId.set(null);
    await settle(fixture);
    expect(el.textContent?.trim()).toBe('');
    TestBed.resetTestingModule();
    const u = await strip(null, '402');
    expect(u.el.textContent?.trim()).toBe('');
  });
});

describe('FlowLanguageChip', () => {
  @Component({
    imports: [FlowLanguageChip],
    template: `@for (id of ids; track id) { <app-flow-language-chip [flowId]="id" /> }`,
  })
  class Host {
    ids = ['f1', 'f2', 'f3', 'f4'];
  }
  const row = (flowId: string, messageSource: FlowTreeItem['messageSource'], nodes: TreeNode[]): FlowTreeItem => ({
    flowId, flowName: flowId, triggerType: 'inactive_customer', status: 'active', promotionId: null, promotionName: null, messageSource, nodes,
  });

  it('shows one line per flow from ONE request and the right wording for each state', async () => {
    const items = [
      row('f1', 'promotion', [entry(), followUp({}, [ver({ metaStatus: 'NOT_REQUIRED' })]), followUp({ messageNodeId: 'n3' })]),
      row('f2', 'default_template', []),
      row('f3', 'promotion', [entry({}, [ver({ metaStatus: 'PENDING', sendable: false })])]),
      row('f4', 'promotion', [entry({}, [])]),
    ];
    const api = { listFlowTrees: vi.fn(() => of({ items })), getFlowOwnerTree: vi.fn() };
    await boot(api);
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    expect(api.listFlowTrees).toHaveBeenCalledTimes(1);
    const lines = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.flc')).map((n) => text(n as HTMLElement));
    expect(lines).toEqual([
      'Arabic: sends in Arabic. Follow-ups ready: 1 of 2',
      'Arabic: English only (fixed message)',
      'Arabic not ready: Waiting for WhatsApp',
      'Arabic: no version yet',
    ]);
  });

  it('renders nothing on 402 / 404 / 500, or for a flow that is not in the answer', async () => {
    for (const status of [402, 404, 500]) {
      const api = { listFlowTrees: vi.fn(() => throwError(() => ({ status }))), getFlowOwnerTree: vi.fn() };
      await boot(api);
      const fixture = TestBed.createComponent(Host);
      await settle(fixture);
      expect((fixture.nativeElement as HTMLElement).querySelector('.flc')).toBeNull();
      TestBed.resetTestingModule();
    }
    const api = { listFlowTrees: vi.fn(() => of({ items: [row('other', 'promotion', [entry()])] })), getFlowOwnerTree: vi.fn() };
    await boot(api);
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.flc')).toBeNull();
  });
});
