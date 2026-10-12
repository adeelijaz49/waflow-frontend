import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { FlowLanguageStore } from '../embedded/flow-language.store';
import { LocUiService } from '../shared/loc-ui.service';
import type { FlowNodeVersion, FlowTreeNode, FlowTreeRow, PromotionTreeRow } from '../localization.types';
import { FlowsTab } from './flows-tab';

// Loading the real catalogues (and the Arabic one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const arEntry = (over: Partial<FlowNodeVersion> = {}): FlowNodeVersion => ({
  language: 'ar', body: 'نفتقدك يا {name}', buttons: [{ position: 0, role: 'flow_button', text: 'تسوق الآن' }, { position: null, role: 'opt_out', text: 'إلغاء الاشتراك' }],
  metaStatus: 'APPROVED', reviewStatus: 'reviewed', stale: false, sendable: true, contentVersion: null, editUrl: '/arabic/templates/t1', ...over,
});
const arFollow = (over: Partial<FlowNodeVersion> = {}): FlowNodeVersion => ({
  language: 'ar', body: 'رائع {name}', buttons: [{ position: 0, role: 'flow_button', text: 'نعم' }],
  metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', stale: false, sendable: false, contentVersion: 2, editUrl: '/arabic/flows?node=n2', ...over,
});

const ENTRY: FlowTreeNode = {
  messageNodeId: 'n1', parentNodeId: null, parentButtonPosition: null, depth: 0, isEntry: true,
  bodyText: 'We miss you {{1}}!', bodyFields: 'We miss you {name}!', slotFields: ['name'],
  buttons: [{ position: 0, label: 'Shop now', action: 'send_message', targetNodeId: 'n2' }, { position: 1, label: 'Stop', action: 'end_flow', targetNodeId: null }],
  templateStatus: 'approved', versions: [arEntry()], canAddArabic: true, addArabicUrl: null,
};
const FOLLOW: FlowTreeNode = {
  messageNodeId: 'n2', parentNodeId: 'n1', parentButtonPosition: 0, depth: 1, isEntry: false,
  bodyText: 'Great {{1}}, here is your code', bodyFields: 'Great {name}, here is your code', slotFields: ['name'],
  buttons: [{ position: 0, label: 'Redeem', action: 'apply_discount', targetNodeId: null }],
  templateStatus: null, versions: [arFollow()], canAddArabic: true, addArabicUrl: null,
};
const LONELY: FlowTreeNode = {
  ...ENTRY, messageNodeId: 'n5', bodyText: 'Points reminder', bodyFields: null, buttons: [], templateStatus: 'pending', versions: [],
};

const FLOWS: FlowTreeRow[] = [
  {
    flowId: 'f1', flowName: 'Win-back', triggerType: 'inactive_customer', status: 'active', promotionId: 'p1', promotionName: 'Summer sale',
    messageSource: 'promotion', nodes: [ENTRY, FOLLOW],
  },
  {
    flowId: 'f2', flowName: 'Points nudge', triggerType: 'points_balance_reminder', status: 'paused', promotionId: null, promotionName: null,
    messageSource: 'default_template', nodes: [],
  },
  {
    flowId: 'f3', flowName: 'No Arabic yet', triggerType: 'post_purchase_points', status: 'active', promotionId: 'p3', promotionName: 'Gift',
    messageSource: 'custom_entry', nodes: [LONELY],
  },
];

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    listFlowTrees: vi.fn(() => of({ items: FLOWS })),
    listPromotionTrees: vi.fn(() => of({ items: [] as PromotionTreeRow[], truncated: false })),
    localizeFlowMessage: vi.fn(() => of({ id: 't9' })),
    saveFollowUp: vi.fn(() => of({ variant: { body: 'نص جديد', buttons: [{ position: 0, text: 'نعم' }], reviewStatus: 'draft', contentVersion: 3, sendable: false, stale: false } })),
    reviewFollowUp: vi.fn(),
    aiTranslate: vi.fn(),
    aiSaudiFriendly: vi.fn(),
    getFlowOwnerTree: vi.fn(() => of({ ownerType: 'flow', ownerId: 'f1', messageSource: 'promotion', nodes: [] })),
    ...over,
  };
}

async function setup(api: ReturnType<typeof fakeApi>, opts: { lang?: 'en' | 'ar'; node?: string } = {}) {
  localStorage.clear();
  const query = new BehaviorSubject(convertToParamMap(opts.node ? { node: opts.node } : {}));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocalizationApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { queryParamMap: query.asObservable(), snapshot: { queryParamMap: query.value } } },
    ],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.ensureLoaded('ar');
  await i18n.use(opts.lang ?? 'en', false);
  const fixture = TestBed.createComponent(FlowsTab);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, i18n, query };
}

const btn = (el: HTMLElement, re: RegExp) =>
  Array.from(el.querySelectorAll<HTMLElement>('button, a')).find((b) => re.test(b.textContent?.replace(/\s+/g, ' ').trim() ?? ''))!;
const card = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`#fl-node-${id}`)!;
const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('FlowsTab', () => {
  it('renders every flow with its whole tree: entry message, then the follow-up under the button it hangs from', async () => {
    const { el } = await setup(fakeApi());
    expect(el.textContent).toContain('Win-back');
    expect(el.textContent).toContain('Inactive customer');
    expect(el.textContent).toContain('Summer sale');
    expect(text(card(el, 'n1'))).toContain('Entry message');
    expect(text(card(el, 'n1'))).toContain('We miss you {{1}}!');
    expect(text(card(el, 'n2'))).toContain('After tapping "Shop now"');
    expect(text(card(el, 'n2'))).toContain('Great {{1}}, here is your code');
    expect(text(card(el, 'n2'))).toContain('Redeem - applies the discount');
    expect(text(card(el, 'n1'))).toContain('Stop - ends the flow');
    expect(el.textContent).not.toMatch(/(flows|common|status|flowlang)\.[a-zA-Z_]+/);
    // parent before child, indented by depth
    const ids = Array.from(el.querySelectorAll('app-loc-flow-node-card')).map((c) => c.id);
    expect(ids).toEqual(['fl-node-n1', 'fl-node-n2', 'fl-node-n5']);
    expect(card(el, 'n1').style.getPropertyValue('--fl-depth')).toBe('0');
    expect(card(el, 'n2').style.getPropertyValue('--fl-depth')).toBe('1');
  });

  it('shows the status of each language: Meta approval for the entry message, "not required" for a free reply', async () => {
    const { el } = await setup(fakeApi());
    const entry = text(card(el, 'n1'));
    expect(entry).toContain('English message on WhatsApp: Approved');
    expect(entry).toContain('Arabic status:Sends in Arabic');
    expect(entry).toContain('Bilingual');
    expect(entry).toContain('Used only when you send a campaign as bilingual.');
    const follow = text(card(el, 'n2'));
    expect(follow).toContain('Free reply, no WhatsApp approval needed');
    expect(follow).toContain('Not required');
    expect(follow).toContain('Draft');
    expect(follow).toContain('Arabic status:Needs native review');
    expect(text(card(el, 'n5'))).toContain('Arabic status:No Arabic yet');
    // the Arabic text and its buttons are listed per node
    expect(entry).toContain('Arabic text');
    expect(entry).toContain('نفتقدك يا {name}');
    expect(entry).toContain('إلغاء الاشتراك');
    expect(follow).toContain('رائع {name}');
    const notRequired = Array.from(card(el, 'n2').querySelectorAll('.badge')).find((b) => b.textContent?.trim() === 'Not required');
    expect(notRequired?.classList.contains('badge-neutral')).toBe(true);
    expect(el.querySelectorAll('.fl-chip')[0].textContent).toContain('Arabic: sends in Arabic');
    expect(el.querySelectorAll('.fl-chip')[2].textContent).toContain('Arabic: no version yet');
  });

  it('summarises each flow: follow-ups ready, fixed message, no version', async () => {
    const { el } = await setup(fakeApi());
    const chips = Array.from(el.querySelectorAll('.fl-chip')).map((c) => text(c));
    expect(chips).toEqual([
      'Arabic: sends in Arabic. Follow-ups ready: 0 of 1',
      'Arabic: English only (fixed message)',
      'Arabic: no version yet',
    ]);
  });

  it('warns when the English text changed after the Arabic was written', async () => {
    const stale = { ...FOLLOW, versions: [arFollow({ stale: true })] };
    const api = fakeApi({ listFlowTrees: vi.fn(() => of({ items: [{ ...FLOWS[0], nodes: [ENTRY, stale] }] })) });
    const { el } = await setup(api);
    const c = text(card(el, 'n2'));
    expect(c).toContain('The Arabic version is out of date');
    expect(c).toContain('Customers receive the English reply until you check the Arabic text');
    expect(c).toContain('Arabic status:Out of date');
  });

  it('says a fixed default message cannot have Arabic, shows no nodes and links to the flows page', async () => {
    const { el } = await setup(fakeApi());
    const flow = Array.from(el.querySelectorAll('.fl-flow'))[1];
    expect(flow.textContent).toContain('Points nudge');
    expect(flow.textContent).toContain('This flow sends a fixed English message that is shared by every WaFlow workspace');
    expect(flow.querySelector('app-loc-flow-node-card')).toBeNull();
    expect(flow.querySelector('a[href="/flows"]')).toBeTruthy();
  });

  it('links an entry message that has a template to its editor and offers to create one otherwise', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    const edit = card(el, 'n1').querySelector<HTMLAnchorElement>('a[href="/arabic/templates/t1"]');
    expect(edit?.textContent).toContain('Edit language versions');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    btn(card(el, 'n5'), /Add Arabic version/).click();
    fixture.detectChanges();
    expect(api.localizeFlowMessage).toHaveBeenCalledWith('n5');
    expect(nav).toHaveBeenCalledWith(['/arabic/templates', 't9']);
  });

  it('shows a localised error when creating the version fails', async () => {
    const api = fakeApi({ localizeFlowMessage: vi.fn(() => throwError(() => ({ status: 500 }))) });
    const { fixture, el } = await setup(api);
    btn(card(el, 'n5'), /Add Arabic version/).click();
    fixture.detectChanges();
    expect(el.querySelector('.loc-error')?.textContent).toContain('Something went wrong');
  });

  it('previews as an Arabic customer, an English customer or both; a missing Arabic version is flagged', async () => {
    const { fixture, el } = await setup(fakeApi());
    btn(card(el, 'n5'), /^Preview$/).click();
    fixture.detectChanges();
    expect(card(el, 'n5').textContent).toContain('No Arabic version yet');
    btn(card(el, 'n1'), /^Preview$/).click();
    fixture.detectChanges();
    expect(card(el, 'n1').querySelector('app-wa-preview')?.textContent).toContain('نفتقدك يا سارة');
    btn(el, /English customer/).click();
    fixture.detectChanges();
    expect(card(el, 'n1').querySelector('app-wa-preview')?.textContent).toContain('We miss you Sara!');
    expect(card(el, 'n1').querySelectorAll('app-wa-preview').length).toBe(1);
    expect(card(el, 'n1').querySelector('app-wa-preview')?.textContent).not.toContain('نفتقدك');
    btn(el, /^Both$/).click();
    fixture.detectChanges();
    expect(card(el, 'n1').querySelectorAll('app-wa-preview').length).toBe(2);
    expect(btn(el, /^Both$/).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the Arabic editor of a follow-up in place and saves it, then re-reads the trees', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    expect(el.querySelector('app-loc-followup-editor')).toBeNull();
    btn(card(el, 'n2'), /Edit Arabic text/).click();
    fixture.detectChanges();
    expect(el.querySelector('app-loc-followup-editor')).toBeTruthy();
    expect(api.listFlowTrees).toHaveBeenCalledTimes(1);
    const body = el.querySelector<HTMLTextAreaElement>('app-loc-followup-editor textarea')!;
    body.value = 'نص جديد';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.saveFollowUp).toHaveBeenCalledWith('n2', expect.objectContaining({ body: 'نص جديد', source: 'merchant' }));
    expect(api.listFlowTrees).toHaveBeenCalledTimes(2); // quiet re-read
    expect(el.querySelector('app-loc-followup-editor')).toBeTruthy(); // still open, nothing flickered away
  });

  // The real backend (flowTree.js) reports canAddArabic=false for a follow-up as soon as an Arabic version EXISTS:
  // that must not hide the editor (found by the ACC-FE browser QA: an out-of-date or draft follow-up could not be edited).
  it('still offers the editor for a follow-up that already has an Arabic version (backend canAddArabic=false) and opens it from the deep link', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const flows: FlowTreeRow[] = [{ ...FLOWS[0], nodes: [{ ...ENTRY, canAddArabic: false }, { ...FOLLOW, canAddArabic: false, versions: [arFollow({ stale: true })] }] }];
    const api = fakeApi({ listFlowTrees: vi.fn(() => of({ items: flows })) });
    const { fixture, el } = await setup(api);
    expect(btn(card(el, 'n2'), /Edit Arabic text/)).toBeTruthy();
    btn(card(el, 'n2'), /Edit Arabic text/).click();
    fixture.detectChanges();
    expect(card(el, 'n2').querySelector('app-loc-followup-editor')).toBeTruthy();
    TestBed.resetTestingModule();
    const deep = await setup(api, { node: 'n2' });
    await new Promise((r) => setTimeout(r, 10));
    deep.fixture.detectChanges();
    expect(card(deep.el, 'n2').querySelector('app-loc-followup-editor')).toBeTruthy();
  });

  it('refreshes what the Automated Flows / Promotions screens cached only if they loaded it', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    const store = TestBed.inject(FlowLanguageStore);
    const doSave = async () => {
      if (!el.querySelector('app-loc-followup-editor')) btn(card(el, 'n2'), /Edit Arabic text/).click();
      fixture.detectChanges();
      const body = el.querySelector<HTMLTextAreaElement>('app-loc-followup-editor textarea')!;
      body.value = `x${Math.random()}`;
      body.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      btn(el, /Save draft/).click();
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await doSave();
    expect(api.getFlowOwnerTree).not.toHaveBeenCalled();
    expect(store.all().state).toBe('idle');
    store.ensureAll();
    store.ensureOwner('promotion', 'p1');
    const treeCalls = api.listFlowTrees.mock.calls.length;
    const ownerCalls = api.getFlowOwnerTree.mock.calls.length;
    await doSave();
    // quiet tab re-read + store reloadAll; promotion owner reloaded, the flow owner was never loaded
    expect(api.listFlowTrees.mock.calls.length).toBe(treeCalls + 2);
    expect(api.getFlowOwnerTree.mock.calls.length).toBe(ownerCalls + 1);
    expect(api.getFlowOwnerTree).toHaveBeenLastCalledWith('promotion', 'p1');
  });

  it('asks before the card button closes an editor that has unsaved Arabic text', async () => {
    const { fixture, el } = await setup(fakeApi());
    const confirm = vi.spyOn(TestBed.inject(LocUiService), 'confirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    btn(card(el, 'n2'), /Edit Arabic text/).click();
    fixture.detectChanges();
    btn(card(el, 'n2'), /^Close$/).click(); // nothing typed: closes without asking
    await fixture.whenStable();
    fixture.detectChanges();
    expect(confirm).not.toHaveBeenCalled();
    expect(el.querySelector('app-loc-followup-editor')).toBeNull();
    btn(card(el, 'n2'), /Edit Arabic text/).click();
    fixture.detectChanges();
    const body = el.querySelector<HTMLTextAreaElement>('app-loc-followup-editor textarea')!;
    body.value = 'نص غير محفوظ';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    btn(card(el, 'n2'), /^Close$/).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-loc-followup-editor')).toBeTruthy(); // kept: the merchant said no
    btn(card(el, 'n2'), /^Close$/).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('app-loc-followup-editor')).toBeNull();
  });

  it('ignores a slow older read that answers after a newer one, and never leaves the spinner on', async () => {
    const first = new Subject<{ items: FlowTreeRow[] }>();
    const second = new Subject<{ items: FlowTreeRow[] }>();
    let n = 0;
    const api = fakeApi({ listFlowTrees: vi.fn(() => (++n === 1 ? first : second).asObservable()) });
    const { fixture, el } = await setup(api);
    expect(el.textContent).toContain('Loading');
    fixture.componentInstance.load(true); // a newer (quiet) read supersedes the first
    second.next({ items: [FLOWS[1]] });
    fixture.detectChanges();
    expect(text(el.querySelector('.fl-flow'))).toContain('Points nudge');
    first.next({ items: [FLOWS[0]] }); // older answer arrives late: ignored
    fixture.detectChanges();
    expect(el.querySelectorAll('.fl-flow').length).toBe(1);
    expect(text(el.querySelector('.fl-flow'))).toContain('Points nudge');
  });

  it('shows the error when a newer quiet read fails while the first full read was still loading', async () => {
    const first = new Subject<{ items: FlowTreeRow[] }>();
    const second = new Subject<{ items: FlowTreeRow[] }>();
    let n = 0;
    const api = fakeApi({ listFlowTrees: vi.fn(() => (++n === 1 ? first : second).asObservable()) });
    const { fixture, el } = await setup(api);
    fixture.componentInstance.load(true);
    second.error({ status: 500 });
    fixture.detectChanges();
    expect(el.querySelector('.loading')).toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(btn(el, /Try again/)).toBeTruthy();
  });

  it('Refresh re-reads in place: an open editor and its unsaved text survive, and a failure is reported', async () => {
    let fail = false;
    const api = fakeApi({ listFlowTrees: vi.fn(() => (fail ? throwError(() => ({ status: 500 })) : of({ items: FLOWS }))) });
    const { fixture, el } = await setup(api);
    btn(card(el, 'n2'), /Edit Arabic text/).click();
    fixture.detectChanges();
    const body = el.querySelector<HTMLTextAreaElement>('app-loc-followup-editor textarea')!;
    body.value = 'نص غير محفوظ';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    btn(el, /^Refresh$/).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.listFlowTrees).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.loading')).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('app-loc-followup-editor textarea')!.value).toBe('نص غير محفوظ');
    fail = true;
    btn(el, /^Refresh$/).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('app-loc-followup-editor')).toBeTruthy(); // the list stays
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
  });

  describe('deep link ?node=<messageNodeId>', () => {
    it('opens the Arabic editor of a follow-up node and scrolls to it', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { fixture, el } = await setup(fakeApi(), { node: 'n2' });
      await new Promise((r) => setTimeout(r, 10));
      fixture.detectChanges();
      expect(card(el, 'n2').classList.contains('focused')).toBe(true);
      expect(card(el, 'n2').querySelector('app-loc-followup-editor')).toBeTruthy();
      expect(card(el, 'n1').querySelector('app-loc-followup-editor')).toBeNull();
      expect(scroll).toHaveBeenCalled();
      expect(el.textContent).not.toContain("We couldn't find that message in your flows");
    });

    it('expands the preview of an entry node', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { fixture, el } = await setup(fakeApi(), { node: 'n1' });
      fixture.detectChanges();
      expect(card(el, 'n1').classList.contains('focused')).toBe(true);
      expect(card(el, 'n1').querySelector('app-wa-preview')).toBeTruthy();
      expect(card(el, 'n2').querySelector('app-wa-preview')).toBeNull();
    });

    it('says so when the node is not in any flow, and follows later link changes', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { fixture, el, query } = await setup(fakeApi(), { node: 'nope' });
      expect(el.textContent).toContain("We couldn't find that message in your flows");
      query.next(convertToParamMap({ node: 'n5' }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.textContent).not.toContain("We couldn't find that message in your flows");
      expect(card(el, 'n5').classList.contains('focused')).toBe(true);
    });
  });

  it('shows the empty state, the error state with a retry, and a not-enabled message', async () => {
    const empty = await setup(fakeApi({ listFlowTrees: vi.fn(() => of({ items: [] })) }));
    expect(empty.el.querySelector('a[href="/flows"]')).toBeTruthy();
    TestBed.resetTestingModule();
    const failing = vi.fn(() => throwError(() => ({ status: 500 })));
    const api = fakeApi({ listFlowTrees: failing });
    const failed = await setup(api);
    expect(failed.el.querySelector('.loc-error')).toBeTruthy();
    api.listFlowTrees.mockReturnValueOnce(of({ items: FLOWS }) as never);
    btn(failed.el, /^Try again$/).click();
    failed.fixture.detectChanges();
    expect(failed.el.textContent).toContain('Win-back');
    TestBed.resetTestingModule();
    const off = await setup(fakeApi({ listFlowTrees: vi.fn(() => throwError(() => ({ status: 402, error: { code: 'ARABIC_NOT_ENABLED' } }))) }));
    expect(off.el.querySelector('.loc-error')?.textContent).toContain("Arabic isn't switched on");
  });

  it('renders Arabic (rtl) with no raw keys', async () => {
    const { el, i18n } = await setup(fakeApi(), { lang: 'ar' });
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('المسارات الآلية');
    expect(text(card(el, 'n2'))).toContain('بعد الضغط على');
    expect(el.textContent).not.toMatch(/(flows|common|status|flowlang)\.[a-zA-Z_]+/);
  });
});

// Promotions that send their own message from the Promotions screen and are not used by any flow
// (GET /flows/promotion-trees): their messages and follow-up replies must be reachable in the hub.
const PENTRY: FlowTreeNode = {
  messageNodeId: 'pe1', parentNodeId: null, parentButtonPosition: null, depth: 0, isEntry: true,
  bodyText: 'Spring is here {{1}}!', bodyFields: 'Spring is here {name}!', slotFields: ['name', 'item', 'price', 'promo_name'],
  buttons: [{ position: 0, label: 'Tell me more', action: 'send_message', targetNodeId: 'pf1' }],
  templateStatus: 'pending', versions: [], canAddArabic: true, addArabicUrl: '/arabic/flows?node=pe1',
};
const PFOLLOW: FlowTreeNode = {
  messageNodeId: 'pf1', parentNodeId: 'pe1', parentButtonPosition: 0, depth: 1, isEntry: false,
  bodyText: 'Here is more {{1}}', bodyFields: 'Here is more {name}', slotFields: ['name', 'item', 'price', 'promo_name'],
  buttons: [{ position: 0, label: 'Done', action: 'end_flow', targetNodeId: null }],
  templateStatus: null, versions: [], canAddArabic: true, addArabicUrl: '/arabic/flows?node=pf1',
};
const PFOLLOW2: FlowTreeNode = {
  ...PFOLLOW, messageNodeId: 'pf2', parentNodeId: 'pf1', parentButtonPosition: 0, depth: 2, bodyText: 'Last word {{1}}', bodyFields: 'Last word {name}',
  buttons: [], versions: [arFollow({ editUrl: '/arabic/flows?node=pf2' })], canAddArabic: false, addArabicUrl: null,
};
const PROMO_ROW: PromotionTreeRow = {
  ownerType: 'promotion', promotionId: 'pp1', promotionName: 'Spring offer', promotionStatus: 'active', messageSource: 'promotion',
  entryTemplateStatus: 'pending', nodes: [PENTRY, { ...PFOLLOW, buttons: [{ position: 0, label: 'Last', action: 'send_message', targetNodeId: 'pf2' }] }, PFOLLOW2],
};
const promoApi = (items: PromotionTreeRow[] = [PROMO_ROW], over: Partial<Record<string, unknown>> = {}) =>
  fakeApi({ listPromotionTrees: vi.fn(() => of({ items, truncated: false })), ...over });
const promoSection = (el: HTMLElement) => el.querySelector<HTMLElement>('.fl-promos');

describe('FlowsTab: promotion messages not used by a flow', () => {
  it('lists them in their own clearly labelled section below the flows, with the whole tree and the same cards', async () => {
    const api = promoApi();
    const { el } = await setup(api);
    expect(api.listPromotionTrees).toHaveBeenCalledTimes(1);
    const section = promoSection(el)!;
    expect(section).toBeTruthy();
    expect(text(section.querySelector('h3'))).toBe('Promotion messages - not used by a flow');
    expect(text(section)).toContain('These promotions send their own message from the Promotions screen, without a flow.');
    expect(text(section.querySelector('.fl-promo .card-title'))).toBe('Spring offer');
    expect(text(section.querySelector('.fl-promo .badge'))).toBe('Active');
    // the flows are untouched and come first
    expect(el.querySelectorAll('.fl-flow').length).toBe(3);
    expect(section.compareDocumentPosition(el.querySelector('.fl-flow')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // parent before child, indented by depth, same node cards
    expect(Array.from(section.querySelectorAll('app-loc-flow-node-card')).map((c) => c.id)).toEqual(['fl-node-pe1', 'fl-node-pf1', 'fl-node-pf2']);
    expect(text(card(el, 'pe1'))).toContain('Entry message');
    expect(text(card(el, 'pe1'))).toContain('English message on WhatsApp: Pending');
    expect(text(card(el, 'pf1'))).toContain('After tapping "Tell me more"');
    expect(text(card(el, 'pf1'))).toContain('Here is more {{1}}');
    expect(text(card(el, 'pf2'))).toContain('After tapping "Last"');
    expect(card(el, 'pf2').style.getPropertyValue('--fl-depth')).toBe('2');
    expect(text(card(el, 'pf2'))).toContain('Arabic status:Needs native review'); // a stored draft version
    expect(section.querySelector('.fl-chip')?.textContent).toContain('Arabic: no version yet');
    expect(section.querySelector('a[href="/promotions"]')?.textContent).toContain('Open Promotions');
    expect(el.textContent).not.toMatch(/(flows|common|status|flowlang)\.[a-zA-Z_]+/);
  });

  it('shows no section (and no placeholder) when no promotion has a message of its own', async () => {
    const { el } = await setup(promoApi([]));
    expect(promoSection(el)).toBeNull();
    expect(el.textContent).not.toContain('not used by a flow');
    expect(el.querySelectorAll('.fl-flow').length).toBe(3);
  });

  it('previews and add-Arabic work the same as for a flow row: preview toggle, "Add Arabic version" for the entry message, editor for a follow-up', async () => {
    const api = promoApi();
    const { fixture, el } = await setup(api);
    btn(card(el, 'pe1'), /^Preview$/).click();
    fixture.detectChanges();
    expect(card(el, 'pe1').textContent).toContain('No Arabic version yet');
    btn(el, /English customer/).click();
    fixture.detectChanges();
    expect(card(el, 'pe1').querySelector('app-wa-preview')?.textContent).toContain('Spring is here Sara!');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    btn(card(el, 'pe1'), /Add Arabic version/).click();
    fixture.detectChanges();
    expect(api.localizeFlowMessage).toHaveBeenCalledWith('pe1');
    expect(nav).toHaveBeenCalledWith(['/arabic/templates', 't9']);
    btn(card(el, 'pf1'), /Add Arabic text|Edit Arabic text/).click();
    fixture.detectChanges();
    expect(card(el, 'pf1').querySelector('app-loc-followup-editor')).toBeTruthy();
  });

  it('saves a follow-up of a promotion row, shows it at once, re-reads both lists and refreshes the promotion\'s cached tree only if loaded', async () => {
    const api = promoApi();
    const { fixture, el } = await setup(api);
    const store = TestBed.inject(FlowLanguageStore);
    btn(card(el, 'pf1'), /Add Arabic text|Edit Arabic text/).click();
    fixture.detectChanges();
    const body = el.querySelector<HTMLTextAreaElement>('#fl-node-pf1 app-loc-followup-editor textarea')!;
    body.value = 'مزيد من التفاصيل يا {name}';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.saveFollowUp).toHaveBeenCalledWith('pf1', expect.objectContaining({ body: 'مزيد من التفاصيل يا {name}', source: 'merchant' }));
    expect(api.listFlowTrees).toHaveBeenCalledTimes(2); // quiet re-read of both lists
    expect(api.listPromotionTrees).toHaveBeenCalledTimes(2);
    expect(api.getFlowOwnerTree).not.toHaveBeenCalled(); // nobody loaded this promotion's cached tree
    expect(card(el, 'pf1').querySelector('app-loc-followup-editor')).toBeTruthy();
    store.ensureOwner('promotion', 'pp1');
    const calls = api.getFlowOwnerTree.mock.calls.length;
    body.value = 'نص آخر يا {name}';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.getFlowOwnerTree.mock.calls.length).toBe(calls + 1);
    expect(api.getFlowOwnerTree).toHaveBeenLastCalledWith('promotion', 'pp1');
  });

  describe('deep link ?node=<messageNodeId>', () => {
    it('opens the Arabic editor of a follow-up of a promotion that has no flow, and scrolls to it', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { fixture, el } = await setup(promoApi(), { node: 'pf1' });
      await new Promise((r) => setTimeout(r, 10));
      fixture.detectChanges();
      expect(card(el, 'pf1').classList.contains('focused')).toBe(true);
      expect(card(el, 'pf1').querySelector('app-loc-followup-editor')).toBeTruthy();
      expect(card(el, 'pe1').querySelector('app-loc-followup-editor')).toBeNull();
      expect(scroll).toHaveBeenCalled();
      expect(el.textContent).not.toContain("We couldn't find that message in your flows");
    });

    it('expands the preview of the entry message of such a promotion', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { fixture, el } = await setup(promoApi(), { node: 'pe1' });
      fixture.detectChanges();
      expect(card(el, 'pe1').classList.contains('focused')).toBe(true);
      expect(card(el, 'pe1').querySelector('app-wa-preview')).toBeTruthy();
      expect(card(el, 'pf1').querySelector('app-wa-preview')).toBeNull();
    });

    it('a flow node still resolves, and a bogus / foreign id still shows the not-found state (also with promotion rows present)', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const flowNode = await setup(promoApi(), { node: 'n2' });
      await new Promise((r) => setTimeout(r, 10));
      flowNode.fixture.detectChanges();
      expect(card(flowNode.el, 'n2').classList.contains('focused')).toBe(true);
      TestBed.resetTestingModule();
      const bogus = await setup(promoApi(), { node: 'someone-elses-node' });
      expect(bogus.el.textContent).toContain("We couldn't find that message in your flows");
      expect(bogus.el.querySelector('.focused')).toBeNull();
    });

    it('does not claim the message is gone while the promotion list is still loading or failed', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const pending = new Subject<{ items: PromotionTreeRow[]; truncated: boolean }>();
      const loading = await setup(promoApi([], { listPromotionTrees: vi.fn(() => pending.asObservable()) }), { node: 'pf1' });
      expect(loading.el.textContent).not.toContain("We couldn't find that message in your flows");
      pending.next({ items: [PROMO_ROW], truncated: false });
      loading.fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 10));
      loading.fixture.detectChanges();
      expect(card(loading.el, 'pf1').classList.contains('focused')).toBe(true);
      TestBed.resetTestingModule();
      const failed = await setup(promoApi([], { listPromotionTrees: vi.fn(() => throwError(() => ({ status: 500 }))) }), { node: 'pf1' });
      expect(failed.el.textContent).not.toContain("We couldn't find that message in your flows");
      expect(failed.el.querySelector('.fl-promos-error [role="alert"]')).toBeTruthy();
    });
  });

  describe('empty, error and unavailable states', () => {
    it('with no flows but a promotion message: the section and the preview toggle show, the "no flows" state does not', async () => {
      const { el } = await setup(promoApi([PROMO_ROW], { listFlowTrees: vi.fn(() => of({ items: [] })) }));
      expect(el.querySelector('.empty-state')).toBeNull();
      expect(promoSection(el)).toBeTruthy();
      expect(el.querySelector('.fl-toggle')).toBeTruthy();
    });

    it('with no flows, Refresh still re-reads in place: an open promotion editor and its unsaved text survive', async () => {
      const pending = new Subject<{ items: FlowTreeRow[] }>();
      let calls = 0;
      const api = promoApi([PROMO_ROW], { listFlowTrees: vi.fn(() => (++calls === 1 ? of({ items: [] }) : pending)) });
      const { fixture, el } = await setup(api);
      btn(card(el, 'pf1'), /Add Arabic text|Edit Arabic text/).click();
      fixture.detectChanges();
      const body = el.querySelector<HTMLTextAreaElement>('#fl-node-pf1 app-loc-followup-editor textarea')!;
      body.value = 'نص غير محفوظ';
      body.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      btn(el, /^Refresh$/).click(); // the flows read is still in flight
      fixture.detectChanges();
      expect(api.listFlowTrees).toHaveBeenCalledTimes(2);
      expect(api.listPromotionTrees).toHaveBeenCalledTimes(2);
      expect(el.querySelector('.loading')).toBeNull();
      expect(el.querySelector<HTMLTextAreaElement>('#fl-node-pf1 app-loc-followup-editor textarea')!.value).toBe('نص غير محفوظ');
      pending.next({ items: [] });
      pending.complete();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector<HTMLTextAreaElement>('#fl-node-pf1 app-loc-followup-editor textarea')!.value).toBe('نص غير محفوظ');
    });

    it('with neither flows nor promotion messages: the existing empty state', async () => {
      const { el } = await setup(promoApi([], { listFlowTrees: vi.fn(() => of({ items: [] })) }));
      expect(el.querySelector('.empty-state a[href="/flows"]')).toBeTruthy();
      expect(promoSection(el)).toBeNull();
      expect(el.querySelector('.fl-toggle')).toBeNull();
    });

    it('a failed promotion list shows its own error with a retry and never hides the flows', async () => {
      const failing = vi.fn(() => throwError(() => ({ status: 500 })));
      const api = promoApi([], { listPromotionTrees: failing });
      const { fixture, el } = await setup(api);
      expect(el.textContent).toContain('Win-back');
      const err = el.querySelector('.fl-promos-error')!;
      expect(err.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong');
      expect(text(err.querySelector('h3'))).toBe('Promotion messages - not used by a flow');
      api.listPromotionTrees.mockReturnValueOnce(of({ items: [PROMO_ROW], truncated: false }) as never);
      btn(err as HTMLElement, /^Try again$/).click();
      fixture.detectChanges();
      expect(el.querySelector('.fl-promos-error')).toBeNull();
      expect(promoSection(el)).toBeTruthy();
      expect(api.listFlowTrees).toHaveBeenCalledTimes(1); // only the promotion list was asked again
    });

    it('with no flows and a failed promotion list: the error is shown, not the "no flows" state', async () => {
      const { el } = await setup(promoApi([], { listFlowTrees: vi.fn(() => of({ items: [] })), listPromotionTrees: vi.fn(() => throwError(() => ({ status: 500 }))) }));
      expect(el.querySelector('.fl-promos-error')).toBeTruthy();
      expect(el.querySelector('.empty-state')).toBeNull();
    });

    it('an older backend (404) or Arabic off (402) simply has no section and no error', async () => {
      for (const status of [404, 402]) {
        TestBed.resetTestingModule();
        const { el } = await setup(promoApi([], { listPromotionTrees: vi.fn(() => throwError(() => ({ status }))) }));
        expect(promoSection(el)).toBeNull();
        expect(el.querySelector('.fl-promos-error')).toBeNull();
        expect(el.textContent).toContain('Win-back');
      }
    });

    it('a failed flows list still shows the page error (and the promotion list is not shown)', async () => {
      const { el } = await setup(promoApi([PROMO_ROW], { listFlowTrees: vi.fn(() => throwError(() => ({ status: 500 }))) }));
      expect(el.querySelector('.loc-error')).toBeTruthy();
      expect(promoSection(el)).toBeNull();
    });

    it('Refresh re-reads both lists in place; a failing quiet re-read keeps the promotion rows on screen', async () => {
      let fail = false;
      const api = promoApi([PROMO_ROW], { listPromotionTrees: vi.fn(() => (fail ? throwError(() => ({ status: 500 })) : of({ items: [PROMO_ROW], truncated: false }))) });
      const { fixture, el } = await setup(api);
      btn(el, /^Refresh$/).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(api.listPromotionTrees).toHaveBeenCalledTimes(2);
      expect(promoSection(el)).toBeTruthy();
      fail = true;
      btn(el, /^Refresh$/).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(promoSection(el)).toBeTruthy();
      expect(el.querySelector('.fl-promos-error')).toBeNull();
    });

    it('says when only the newest promotions are listed', async () => {
      const api = fakeApi({ listPromotionTrees: vi.fn(() => of({ items: [PROMO_ROW], truncated: true })) });
      const { el } = await setup(api);
      expect(text(promoSection(el))).toContain('Only the newest 1 promotions are shown.');
    });
  });

  it('renders in Arabic (rtl) with Arabic section texts and no raw keys', async () => {
    const { el, i18n } = await setup(promoApi(), { lang: 'ar' });
    expect(i18n.dir()).toBe('rtl');
    expect(text(promoSection(el)!.querySelector('h3'))).toBe('رسائل العروض الترويجية - غير مستخدمة في أي مسار');
    expect(text(promoSection(el)!.querySelector('.badge'))).toBe('نشط');
    expect(promoSection(el)!.textContent).toContain('فتح العروض الترويجية');
    expect(text(card(el, 'pf1'))).toContain('بعد الضغط على');
    expect(el.textContent).not.toMatch(/(flows|common|status|flowlang)\.[a-zA-Z_]+/);
  });
});
