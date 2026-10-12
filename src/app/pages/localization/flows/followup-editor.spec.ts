import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { FlowNodeVersion, FlowTreeNode } from '../localization.types';
import { LocUiService } from '../shared/loc-ui.service';
import { FollowupEditor } from './followup-editor';

// Loading the real catalogues is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const NODE: FlowTreeNode = {
  messageNodeId: 'n2', parentNodeId: 'n1', parentButtonPosition: 0, depth: 1, isEntry: false,
  bodyText: 'Great {{1}}, your code is waiting', bodyFields: 'Great {name}, your code is waiting', slotFields: ['name', 'points'],
  buttons: [
    { position: 0, label: 'Shop now', action: 'send_message', targetNodeId: null },
    { position: 1, label: 'Not now', action: 'end_flow', targetNodeId: null },
  ],
  templateStatus: null, versions: [], canAddArabic: true, addArabicUrl: null,
};
const AR_BODY = 'رائع {name}، رمزك بانتظارك';
const arVersion = (over: Partial<FlowNodeVersion> = {}): FlowNodeVersion => ({
  language: 'ar', body: AR_BODY,
  buttons: [{ position: 0, role: 'flow_button', text: 'تسوق الآن' }, { position: 1, role: 'flow_button', text: 'ليس الآن' }],
  metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', stale: false, sendable: false, contentVersion: 4, editUrl: '/arabic/flows?node=n2', ...over,
});
const withAr = (over: Partial<FlowNodeVersion> = {}): FlowTreeNode => ({ ...NODE, versions: [arVersion(over)] });

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    saveFollowUp: vi.fn(() => of({ messageNodeId: 'n2', variant: { body: AR_BODY, buttons: [{ position: 0, text: 'تسوق' }, { position: 1, text: 'لاحقاً' }], reviewStatus: 'draft', contentVersion: 5, stale: false, sendable: false } })),
    reviewFollowUp: vi.fn(() => of({ messageNodeId: 'n2', variant: { body: AR_BODY, buttons: [], reviewStatus: 'reviewed', contentVersion: 5, sendable: true } })),
    aiTranslate: vi.fn(() => of({ text: 'مرحباً {name}', draft: true, from: 'en', to: 'ar', warnings: [], protectedTokens: { count: 1, verified: true } })),
    aiSaudiFriendly: vi.fn(() => of({ text: 'هلا {name}', draft: true, warnings: [], protectedTokens: { count: 1, verified: true } })),
    ...over,
  };
}

async function setup(api: ReturnType<typeof fakeApi>, node: FlowTreeNode, lang: 'en' | 'ar' = 'en') {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }] });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.ensureLoaded('ar');
  await i18n.use(lang, false);
  const fixture = TestBed.createComponent(FollowupEditor);
  fixture.componentRef.setInput('node', node);
  const events = { changed: [] as unknown[], reload: 0, closed: 0 };
  fixture.componentInstance.changed.subscribe((v) => events.changed.push(v));
  fixture.componentInstance.reloadRequested.subscribe(() => { events.reload += 1; });
  fixture.componentInstance.closed.subscribe(() => { events.closed += 1; });
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, events, i18n };
}

const btn = (el: HTMLElement, re: RegExp) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => re.test(b.textContent?.replace(/\s+/g, ' ').trim() ?? ''))!;
async function type(fixture: ComponentFixture<FollowupEditor>, el: Element, value: string) {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}
const body = (el: HTMLElement) => el.querySelector<HTMLTextAreaElement>('textarea')!;
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>('.fe-btn input[type="text"]'));

describe('FollowupEditor', () => {
  it('shows the English reply, only the merge fields this reply can fill, and one Arabic input per button', async () => {
    const { el } = await setup(fakeApi(), NODE);
    expect(el.querySelector('.fe-source')?.textContent).toContain('Great {name}, your code is waiting');
    const chips = Array.from(el.querySelectorAll('.fe-chip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Customer first name', 'Loyalty points']);
    expect(labels(el).length).toBe(2);
    expect(el.textContent).toContain('Shop now');
    expect(el.textContent).toContain('0 / 20');
    expect(el.textContent).not.toMatch(/(flows|common|templates|ai)\.[a-zA-Z_]+/);
  });

  it('falls back to {name} when the English reply has no merge fields', async () => {
    const { el } = await setup(fakeApi(), { ...NODE, slotFields: [] });
    expect(Array.from(el.querySelectorAll('.fe-chip')).map((c) => c.textContent?.trim())).toEqual(['Customer first name']);
  });

  it('keeps Save disabled for an empty form, then saves a draft as merchant text and reports the saved version', async () => {
    const api = fakeApi();
    const { fixture, el, events } = await setup(api, NODE);
    expect(btn(el, /Save draft/).disabled).toBe(true);
    await type(fixture, body(el), AR_BODY);
    const [a, b] = labels(el);
    await type(fixture, a, 'تسوق');
    await type(fixture, b, 'لاحقاً');
    expect(btn(el, /Save draft/).disabled).toBe(false);
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    expect(api.saveFollowUp).toHaveBeenCalledWith('n2', {
      body: AR_BODY, source: 'merchant', buttons: [{ position: 0, text: 'تسوق' }, { position: 1, text: 'لاحقاً' }],
    });
    expect((events.changed[0] as FlowNodeVersion).contentVersion).toBe(5);
    expect((events.changed[0] as FlowNodeVersion).reviewStatus).toBe('draft');
  });

  it('inserts a merge field at the caret from its chip', async () => {
    const { fixture, el } = await setup(fakeApi(), NODE);
    await type(fixture, body(el), 'مرحباً ');
    body(el).setSelectionRange(7, 7);
    (el.querySelector('.fe-chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.form().body).toBe('مرحباً {name}');
  });

  it('shows live issues: positional field, unknown field, 21-character label, duplicate label, long body', async () => {
    const { fixture, el } = await setup(fakeApi(), NODE);
    await type(fixture, body(el), 'مرحباً {{1}} {discount}');
    await type(fixture, labels(el)[0], 'ا'.repeat(21));
    await type(fixture, labels(el)[1], 'ا'.repeat(21));
    const text = el.querySelector('.loc-error')?.textContent ?? '';
    expect(text).toContain('Use the merge field buttons instead of numbered fields.');
    expect(text).toContain('A button label is too long: 21 of 20 characters.');
    expect(text).toContain('Two buttons have the same label.');
    await type(fixture, body(el), 'ا'.repeat(1025));
    expect(el.querySelector('.loc-error')?.textContent).toContain('The text is too long: 1025 of 1024 characters.');
    expect(el.querySelector('.fe-count.over')).toBeTruthy();
  });

  it('never applies an AI draft by itself: the notice shows, the text stays until "Use this draft", and saving marks it as AI', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api, NODE);
    expect(el.textContent).toContain('AI-suggested, human-approved');
    btn(el, /Translate to Arabic/).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.aiTranslate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Great {name}, your code is waiting', from: 'en', to: 'ar', context: 'template_body', maxLength: 1024 }));
    expect(el.textContent).toContain('مرحباً {name}');
    expect(body(el).value).toBe('');
    expect(api.saveFollowUp).not.toHaveBeenCalled();
    btn(el, /Use this draft/).click();
    fixture.detectChanges();
    expect(body(el).value).toBe('مرحباً {name}');
    expect(el.textContent).toContain('AI draft: review before using');
    await type(fixture, labels(el)[0], 'تسوق');
    await type(fixture, labels(el)[1], 'لاحقاً');
    btn(el, /Save draft/).click();
    expect(api.saveFollowUp).toHaveBeenCalledWith('n2', expect.objectContaining({ source: 'ai' }));
    expect(api.reviewFollowUp).not.toHaveBeenCalled();
  });

  it('translates one button label with the button context and the 20-character limit', async () => {
    const api = fakeApi({ aiTranslate: vi.fn(() => of({ text: 'تسوق الآن', draft: true, from: 'en', to: 'ar', warnings: [], protectedTokens: { count: 0, verified: true } })) });
    const { fixture, el } = await setup(api, NODE);
    const assists = Array.from(el.querySelectorAll('app-ai-assist'));
    expect(assists.length).toBe(3); // body + one per button
    (assists[1].querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.aiTranslate).toHaveBeenCalledWith(expect.objectContaining({ text: 'Shop now', context: 'button', maxLength: 20, to: 'ar' }));
    expect(labels(el)[0].value).toBe('');
    btn(el, /Use this draft/).click();
    fixture.detectChanges();
    expect(labels(el)[0].value).toBe('تسوق الآن');
  });

  it('offers the Saudi-friendly helper only once there is Arabic text', async () => {
    const { fixture, el } = await setup(fakeApi(), NODE);
    expect(btn(el, /Saudi-friendly/)).toBeUndefined();
    await type(fixture, body(el), 'أهلاً');
    expect(btn(el, /Saudi-friendly/)).toBeTruthy();
  });

  it('shows the out-of-date banner, allows re-saving an unchanged text and blocks marking it reviewed', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api, withAr({ stale: true }));
    expect(el.querySelector('.loc-warn')?.textContent).toContain('The Arabic version is out of date');
    expect(btn(el, /Mark as reviewed/).disabled).toBe(true);
    expect(btn(el, /Save draft/).disabled).toBe(false);
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    expect(api.saveFollowUp).toHaveBeenCalledTimes(1);
  });

  it('marks a clean, saved draft as reviewed with the contentVersion it read', async () => {
    const api = fakeApi();
    const { fixture, el, events } = await setup(api, withAr());
    expect(btn(el, /Mark as reviewed/).disabled).toBe(false);
    btn(el, /Mark as reviewed/).click();
    fixture.detectChanges();
    expect(api.reviewFollowUp).toHaveBeenCalledWith('n2', 'reviewed', 4);
    expect((events.changed[0] as FlowNodeVersion).reviewStatus).toBe('reviewed');
  });

  it('does not allow review while there are unsaved changes or issues', async () => {
    const { fixture, el } = await setup(fakeApi(), withAr());
    await type(fixture, body(el), 'نص جديد');
    expect(btn(el, /Mark as reviewed/).disabled).toBe(true);
    expect(el.textContent).toContain('Save your changes before reviewing.');
  });

  it('offers "Back to draft" for a reviewed version', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api, withAr({ reviewStatus: 'reviewed', sendable: true }));
    btn(el, /Back to draft/).click();
    fixture.detectChanges();
    expect(api.reviewFollowUp).toHaveBeenCalledWith('n2', 'draft', 4);
  });

  it('shows the server issues of a refused save (VARIANT_INVALID) and a localised message otherwise', async () => {
    const api = fakeApi({
      saveFollowUp: vi.fn(() => throwError(() => ({ status: 400, error: { code: 'VARIANT_INVALID', issues: [{ code: 'followup_button_mismatch' }] } }))),
    });
    const { fixture, el } = await setup(api, NODE);
    await type(fixture, body(el), 'نص');
    btn(el, /Save draft/).click();
    fixture.detectChanges();
    expect(el.textContent).toContain("The buttons don't match the English reply.");
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Fix the highlighted problems');
  });

  it('asks to reload on a 409 conflict and re-reads on request', async () => {
    const api = fakeApi({ reviewFollowUp: vi.fn(() => throwError(() => ({ status: 409 }))) });
    const { fixture, el, events } = await setup(api, withAr());
    btn(el, /Mark as reviewed/).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('This text was changed somewhere else');
    btn(el, /^Reload$/).click();
    expect(events.reload).toBe(1);
  });

  it('asks before closing with unsaved changes', async () => {
    const { fixture, el, events } = await setup(fakeApi(), NODE);
    const ui = TestBed.inject(LocUiService);
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    btn(el, /^Close$/).click();
    await fixture.whenStable();
    expect(confirm).not.toHaveBeenCalled(); // nothing to lose
    expect(events.closed).toBe(1);
    await type(fixture, body(el), 'نص');
    btn(el, /^Close$/).click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(events.closed).toBe(1);
    btn(el, /^Close$/).click();
    await fixture.whenStable();
    expect(events.closed).toBe(2);
  });

  it('names the promotion merge fields (item, price, promotion name) instead of showing raw tokens', async () => {
    const promoNode: FlowTreeNode = { ...NODE, slotFields: ['name', 'item', 'price', 'promo_name'] };
    const { el } = await setup(fakeApi(), promoNode);
    const chips = Array.from(el.querySelectorAll('.fe-chip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Customer first name', 'Item name', 'Price', 'Promotion name']);
  });

  it('previews Arabic, English or both with sample values filled in', async () => {
    const { fixture, el } = await setup(fakeApi(), withAr());
    expect(el.querySelectorAll('app-wa-preview').length).toBe(1);
    expect(el.querySelector('app-wa-preview')?.textContent).toContain('رائع سارة، رمزك بانتظارك');
    fixture.componentRef.setInput('mode', 'en');
    fixture.detectChanges();
    expect(el.querySelector('app-wa-preview')?.textContent).toContain('Great Sara, your code is waiting');
    fixture.componentRef.setInput('mode', 'both');
    fixture.detectChanges();
    expect(el.querySelectorAll('app-wa-preview').length).toBe(2);
  });

  it('renders in Arabic (rtl) with no raw keys', async () => {
    const { el, i18n } = await setup(fakeApi(), withAr(), 'ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('النسخة العربية لهذا الرد');
    expect(el.textContent).not.toMatch(/(flows|common|templates|ai)\.[a-zA-Z_]+/);
  });

  it('explains when the English text cannot be copied as fields', async () => {
    const { el } = await setup(fakeApi(), { ...NODE, bodyFields: null });
    expect(el.textContent).toContain('cannot be copied over automatically');
  });
});
