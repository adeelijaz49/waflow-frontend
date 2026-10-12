import type {
  FlowNodeVersion, FlowTreeNode, FollowUpSaveInput, FollowUpVariantView, FollowUpView, ValidationIssue,
} from '../localization.types';
import type { Lang } from '../../../i18n';
import { charCount, extractMergeFields } from '../shared/merge-fields';

// Pure rules for the Arabic version of a follow-up reply (the message sent after a customer taps a button of a
// flow message). They mirror the backend's evaluateVariant so the editor can tell the merchant what is wrong while
// typing; the server stays the authority (its `issues` are shown after every save / review).

export const FOLLOWUP_LIMITS = {
  label: 20,          // button label, in characters (code points)
  bodyInteractive: 1024, // body of a message that has buttons
  bodyText: 4096,     // body of a message without buttons
} as const;

export interface FollowUpForm {
  body: string;
  // The Arabic label of each button, keyed by the button's position in the English message.
  labels: Record<number, string>;
}

export interface DraftIssue { code: string; detail?: Record<string, string | number>; field?: string }

// Merge fields an Arabic follow-up may use: the ones the English node can fill, or {name} when it has none
// (the English reply always substitutes the first name).
export function allowedFields(node: Pick<FlowTreeNode, 'slotFields'>): string[] {
  const slots = node.slotFields ?? [];
  return slots.length ? slots : ['name'];
}

export function bodyLimit(node: Pick<FlowTreeNode, 'buttons'>): number {
  return node.buttons.length ? FOLLOWUP_LIMITS.bodyInteractive : FOLLOWUP_LIMITS.bodyText;
}

export function arabicOf(node: Pick<FlowTreeNode, 'versions'> | null | undefined): FlowNodeVersion | null {
  return node?.versions?.find((v) => v.language === 'ar') ?? null;
}

export function formOf(node: FlowTreeNode, version: FlowNodeVersion | null = arabicOf(node)): FollowUpForm {
  const labels: Record<number, string> = {};
  for (const b of node.buttons) {
    const own = version?.buttons.find((x) => x.position !== null && x.position === b.position);
    labels[b.position] = own?.text ?? '';
  }
  return { body: version?.body ?? '', labels };
}

export function sameForm(a: FollowUpForm, b: FollowUpForm, node: Pick<FlowTreeNode, 'buttons'>): boolean {
  if (a.body !== b.body) return false;
  return node.buttons.every((x) => (a.labels[x.position] ?? '') === (b.labels[x.position] ?? ''));
}

export function toSaveInput(node: Pick<FlowTreeNode, 'buttons'>, form: FollowUpForm, source: 'merchant' | 'ai'): FollowUpSaveInput {
  return {
    body: form.body,
    buttons: node.buttons.map((b) => ({ position: b.position, text: form.labels[b.position] ?? '' })),
    source,
  };
}

// Valid merge-field tokens are {name}; anything else with a curly bracket is a mistake.
const VALID_FIELD = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const POSITIONAL = /\{\{\s*\d+\s*\}\}/;

export function checkForm(node: FlowTreeNode, form: FollowUpForm): { errors: DraftIssue[]; warnings: DraftIssue[] } {
  const errors: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];
  const body = form.body;
  if (!body.trim()) errors.push({ code: 'body_required', field: 'body' });
  if (POSITIONAL.test(body)) {
    errors.push({ code: 'meta_positional_syntax', field: 'body' });
  } else if (/[{}]/.test(body.replace(VALID_FIELD, ''))) {
    errors.push({ code: 'unbalanced_braces', field: 'body' });
  }
  const allowed = allowedFields(node);
  for (const field of extractMergeFields(body)) {
    if (!allowed.includes(field)) errors.push({ code: 'followup_unknown_field', detail: { field }, field: 'body' });
  }
  const max = bodyLimit(node);
  const length = charCount(body);
  if (length > max) errors.push({ code: 'body_too_long', detail: { length, max }, field: 'body' });

  const seen = new Set<string>();
  for (const b of node.buttons) {
    const label = (form.labels[b.position] ?? '').trim();
    if (!label) { errors.push({ code: 'button_label_empty', field: `button_${b.position}` }); continue; }
    const n = charCount(label);
    if (n > FOLLOWUP_LIMITS.label) {
      errors.push({ code: 'button_label_too_long', detail: { length: n, max: FOLLOWUP_LIMITS.label }, field: `button_${b.position}` });
    }
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) errors.push({ code: 'duplicate_button_label', field: `button_${b.position}` });
    seen.add(key);
  }

  // English uses a field that the Arabic text leaves out: not an error, but worth a look.
  if (node.bodyFields && body.trim()) {
    const used = new Set(extractMergeFields(body));
    for (const field of extractMergeFields(node.bodyFields)) {
      if (!used.has(field)) warnings.push({ code: 'followup_field_dropped', detail: { field }, field: 'body' });
    }
  }
  return { errors, warnings };
}

export function fromValidationIssue(i: ValidationIssue): DraftIssue {
  return { code: i.code, detail: i.detail, field: i.field };
}

// ── Reading the answers of the follow-up endpoints (shape-tolerant) ──────────────────────────────────

// The Arabic variant inside an answer: either nested (`variant`) or flat. `variant: null` = none exists.
export function variantOfView(view: FollowUpView | null | undefined): FollowUpVariantView | null {
  if (!view) return null;
  if (view.variant !== undefined) return view.variant;
  return typeof view.body === 'string' ? view : null;
}

export function issuesOfView(view: FollowUpView | null | undefined): { errors: DraftIssue[]; warnings: DraftIssue[] } {
  const v = variantOfView(view);
  const errors = (view?.issues ?? v?.issues ?? []).map(fromValidationIssue);
  const warnings = (view?.warnings ?? v?.warnings ?? []).map(fromValidationIssue);
  return { errors, warnings };
}

// The tree entry the answer describes, so the screen can show the saved state at once (the tree is then
// re-read to confirm). null when the answer does not carry enough to build one.
export function versionOfView(view: FollowUpView | null | undefined, messageNodeId: string): FlowNodeVersion | null {
  const v = variantOfView(view);
  if (!v || typeof v.body !== 'string' || (v.reviewStatus !== 'draft' && v.reviewStatus !== 'reviewed')) return null;
  return {
    language: 'ar',
    body: v.body,
    buttons: (v.buttons ?? []).map((b) => ({ position: b.position, role: 'flow_button' as const, text: b.text })),
    metaStatus: 'NOT_REQUIRED',
    reviewStatus: v.reviewStatus,
    stale: v.stale === true,
    sendable: typeof v.sendable === 'boolean' ? v.sendable : null,
    contentVersion: typeof v.contentVersion === 'number' ? v.contentVersion : null,
    editUrl: `/arabic/flows?node=${messageNodeId}`,
  };
}

// Replaces {field} by a sample value so a preview reads like a real message; unknown fields stay visible.
export function fillSamples(text: string, sample: (field: string) => string | null): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, field: string) => sample(field) ?? whole);
}

// Sample values for the preview, from the catalogue (flows.sample.<field>) in the language of the pane.
export function sampleLookup(i18n: { has(key: string, lang?: Lang): boolean; t(key: string, params?: undefined, lang?: Lang): string }, lang: Lang): (field: string) => string | null {
  return (field) => {
    const key = `flows.sample.${field}`;
    return i18n.has(key, lang) ? i18n.t(key, undefined, lang) : null;
  };
}

// The English reply always puts the customer's first name where {{1}} stands.
export function englishPreviewText(node: Pick<FlowTreeNode, 'bodyFields' | 'bodyText'>): string {
  return node.bodyFields ?? node.bodyText.replace(/\{\{\s*1\s*\}\}/g, '{name}');
}
