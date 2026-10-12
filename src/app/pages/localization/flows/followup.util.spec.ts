import type { FlowNodeVersion, FlowTreeNode } from '../localization.types';
import {
  allowedFields, arabicOf, bodyLimit, checkForm, englishPreviewText, fillSamples, formOf, issuesOfView, sameForm, toSaveInput,
  variantOfView, versionOfView,
} from './followup.util';

const node = (over: Partial<FlowTreeNode> = {}): FlowTreeNode => ({
  messageNodeId: 'n2', parentNodeId: 'n1', parentButtonPosition: 0, depth: 1, isEntry: false,
  bodyText: 'Great {{1}}, here is your code', bodyFields: 'Great {name}, here is your code', slotFields: ['name', 'points'],
  buttons: [
    { position: 0, label: 'Shop now', action: 'send_message', targetNodeId: null },
    { position: 2, label: 'Not now', action: 'end_flow', targetNodeId: null },
  ],
  templateStatus: null, versions: [], canAddArabic: true, addArabicUrl: null, ...over,
});

const version = (over: Partial<FlowNodeVersion> = {}): FlowNodeVersion => ({
  language: 'ar', body: 'رائع {name}', buttons: [{ position: 0, role: 'flow_button', text: 'تسوق الآن' }, { position: 2, role: 'flow_button', text: 'ليس الآن' }],
  metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', stale: false, sendable: false, contentVersion: 3, editUrl: '/arabic/flows?node=n2', ...over,
});

describe('follow-up rules', () => {
  it('uses the node slot fields, or only {name} when it has none', () => {
    expect(allowedFields(node())).toEqual(['name', 'points']);
    expect(allowedFields(node({ slotFields: [] }))).toEqual(['name']);
  });

  it('limits the body to 1024 with buttons and 4096 without', () => {
    expect(bodyLimit(node())).toBe(1024);
    expect(bodyLimit(node({ buttons: [] }))).toBe(4096);
  });

  it('builds the form from the Arabic version by button position (non-contiguous positions kept)', () => {
    const n = node({ versions: [version()] });
    const form = formOf(n);
    expect(form.body).toBe('رائع {name}');
    expect(form.labels).toEqual({ 0: 'تسوق الآن', 2: 'ليس الآن' });
    expect(formOf(node()).labels).toEqual({ 0: '', 2: '' });
    expect(arabicOf(n)?.contentVersion).toBe(3);
  });

  it('compares forms and builds the save body in node button order', () => {
    const n = node({ versions: [version()] });
    const a = formOf(n);
    expect(sameForm(a, { body: a.body, labels: { ...a.labels } }, n)).toBe(true);
    expect(sameForm(a, { body: a.body, labels: { ...a.labels, 2: 'x' } }, n)).toBe(false);
    expect(toSaveInput(n, a, 'ai')).toEqual({
      body: 'رائع {name}', source: 'ai', buttons: [{ position: 0, text: 'تسوق الآن' }, { position: 2, text: 'ليس الآن' }],
    });
  });

  it('accepts a good draft', () => {
    const n = node();
    const r = checkForm(n, { body: 'أهلاً {name}، عندك {points}', labels: { 0: 'تسوق', 2: 'لاحقاً' } });
    expect(r.errors).toEqual([]);
  });

  it('reports every structural problem with a stable code', () => {
    const n = node();
    const codes = (body: string, labels: Record<number, string>) => checkForm(n, { body, labels }).errors.map((e) => e.code);
    expect(codes('', { 0: 'a', 2: 'b' })).toEqual(['body_required']);
    expect(codes('x {{1}}', { 0: 'a', 2: 'b' })).toEqual(['meta_positional_syntax']);
    expect(codes('x {name', { 0: 'a', 2: 'b' })).toEqual(['unbalanced_braces']);
    expect(codes('x name}', { 0: 'a', 2: 'b' })).toEqual(['unbalanced_braces']);
    expect(codes('x {discount}', { 0: 'a', 2: 'b' })).toEqual(['followup_unknown_field']);
    expect(codes('x', { 0: '', 2: 'b' })).toEqual(['button_label_empty']);
    expect(codes('x', { 0: 'Same', 2: ' same ' })).toEqual(['duplicate_button_label']);
  });

  it('counts code points: a label of 20 emoji-free letters passes, 21 fails, an astral emoji counts once', () => {
    const n = node({ buttons: [{ position: 0, label: 'a', action: 'send_message', targetNodeId: null }] });
    const labelErrors = (label: string) => checkForm(n, { body: 'x', labels: { 0: label } }).errors;
    expect(labelErrors('ا'.repeat(20))).toEqual([]);
    expect(labelErrors('ا'.repeat(21))).toEqual([{ code: 'button_label_too_long', detail: { length: 21, max: 20 }, field: 'button_0' }]);
    expect(labelErrors('ا'.repeat(19) + '\u{1F600}')).toEqual([]);
  });

  it('applies the 1024 limit for a node with buttons and 4096 for one without', () => {
    const withButtons = node();
    const long = 'ا'.repeat(1025);
    expect(checkForm(withButtons, { body: long, labels: { 0: 'a', 2: 'b' } }).errors).toEqual([
      { code: 'body_too_long', detail: { length: 1025, max: 1024 }, field: 'body' },
    ]);
    const plain = node({ buttons: [] });
    expect(checkForm(plain, { body: long, labels: {} }).errors).toEqual([]);
    expect(checkForm(plain, { body: 'ا'.repeat(4097), labels: {} }).errors.map((e) => e.code)).toEqual(['body_too_long']);
  });

  it('warns when the Arabic text drops a field the English reply uses', () => {
    const n = node({ bodyFields: 'Hi {name}, you have {points}' });
    const r = checkForm(n, { body: 'أهلاً {name}', labels: { 0: 'a', 2: 'b' } });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([{ code: 'followup_field_dropped', detail: { field: 'points' }, field: 'body' }]);
    expect(checkForm(node({ bodyFields: null }), { body: 'أهلاً', labels: { 0: 'a', 2: 'b' } }).warnings).toEqual([]);
  });
});

describe('reading endpoint answers', () => {
  it('reads a nested variant, a flat one and none', () => {
    expect(variantOfView({ messageNodeId: 'n2', variant: { body: 'x', reviewStatus: 'draft' } })?.body).toBe('x');
    expect(variantOfView({ messageNodeId: 'n2', body: 'y', reviewStatus: 'draft' })?.body).toBe('y');
    expect(variantOfView({ messageNodeId: 'n2', variant: null })).toBeNull();
    expect(variantOfView(null)).toBeNull();
    expect(variantOfView({ messageNodeId: 'n2' })).toBeNull();
  });

  it('collects issues from the top level or from the variant', () => {
    expect(issuesOfView({ issues: [{ code: 'body_required' }], warnings: [{ code: 'followup_field_dropped', detail: { field: 'points' } }] })).toEqual({
      errors: [{ code: 'body_required', detail: undefined, field: undefined }],
      warnings: [{ code: 'followup_field_dropped', detail: { field: 'points' }, field: undefined }],
    });
    expect(issuesOfView({ variant: { issues: [{ code: 'unbalanced_braces' }] } }).errors.map((e) => e.code)).toEqual(['unbalanced_braces']);
    expect(issuesOfView(null)).toEqual({ errors: [], warnings: [] });
  });

  it('builds a tree version from an answer, or null when the answer is too thin', () => {
    const v = versionOfView({
      variant: { body: 'نص', buttons: [{ position: 1, text: 'زر' }], reviewStatus: 'reviewed', contentVersion: 5, sendable: true, stale: false },
    }, 'n9');
    expect(v).toEqual({
      language: 'ar', body: 'نص', buttons: [{ position: 1, role: 'flow_button', text: 'زر' }], metaStatus: 'NOT_REQUIRED',
      reviewStatus: 'reviewed', stale: false, sendable: true, contentVersion: 5, editUrl: '/arabic/flows?node=n9',
    });
    expect(versionOfView({ variant: { body: 'نص' } }, 'n9')).toBeNull();
    expect(versionOfView({}, 'n9')).toBeNull();
  });
});

describe('preview helpers', () => {
  it('fills known fields and leaves unknown ones visible', () => {
    const sample = (f: string) => (f === 'name' ? 'سارة' : null);
    expect(fillSamples('أهلاً {name}، {discount}', sample)).toBe('أهلاً سارة، {discount}');
  });

  it('shows the English text with {{1}} as the customer name when it has no field form', () => {
    expect(englishPreviewText({ bodyFields: null, bodyText: 'Hi {{1}}, welcome' })).toBe('Hi {name}, welcome');
    expect(englishPreviewText({ bodyFields: 'Hi {name}', bodyText: 'Hi {{1}}' })).toBe('Hi {name}');
  });
});
