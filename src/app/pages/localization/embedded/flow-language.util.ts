import type { MetaStatus, ReviewStatus } from '../localization.types';

// Shapes of the read-only flow tree answered by GET /api/localization/flows/owners/{flow|promotion}/{id}/tree
// and GET /api/localization/flows/tree (see the D2 contract). Kept local so the existing screens do not
// depend on how the hub's own flows tab models the same data; structurally identical.

export type VersionMetaStatus = MetaStatus | 'NOT_REQUIRED';
export type MessageSource = 'promotion' | 'custom_entry' | 'default_template';
export type OwnerType = 'flow' | 'promotion';

export interface TreeVersionButton { position: number | null; role: string; text: string }
export interface TreeVersion {
  language: 'en' | 'ar' | 'bilingual';
  body: string;
  buttons: TreeVersionButton[];
  metaStatus: VersionMetaStatus;
  reviewStatus: ReviewStatus | null;
  stale: boolean;
  sendable: boolean | null;
  contentVersion: number | null;
  editUrl: string | null;
}
export interface TreeButton {
  position: number;
  label: string;
  action: string;
  targetNodeId: string | null;
}
export interface TreeNode {
  messageNodeId: string;
  parentNodeId: string | null;
  parentButtonPosition: number | null;
  depth: number;
  isEntry: boolean;
  bodyText: string;
  bodyFields?: string | null;
  slotFields?: string[];
  buttons: TreeButton[];
  templateStatus: 'not_created' | 'pending' | 'approved' | 'rejected' | null;
  versions: TreeVersion[];
  canAddArabic: boolean;
  addArabicUrl: string | null;
}
export interface OwnerTree {
  ownerType: OwnerType;
  ownerId: string;
  messageSource: MessageSource;
  nodes: TreeNode[];
}
export interface FlowTreeItem {
  flowId: string;
  flowName: string;
  triggerType: string;
  status: string;
  promotionId: string | null;
  promotionName: string | null;
  messageSource: MessageSource;
  nodes: TreeNode[];
}

// What the merchant needs to know about one node's Arabic version, as one word.
export type ArabicState =
  | 'english_only' // a fixed default flow message: no Arabic exists for it
  | 'none'         // no Arabic version yet: customers receive English
  | 'stale'        // the English text changed after the Arabic was written
  | 'not_submitted'
  | 'waiting'      // submitted, waiting for WhatsApp
  | 'unusable'     // rejected / paused / disabled / ...
  | 'needs_review' // approved (or not needed) but not yet reviewed by a native speaker
  | 'not_ready'    // approved + reviewed but the backend still reports it as not sendable
  | 'english_pending' // sendable, but the entry node's ENGLISH message is not approved yet: the backend then sends English
  | 'sends';       // sends in Arabic

export function arabicVersion(node: TreeNode | null | undefined): TreeVersion | null {
  return node?.versions?.find((v) => v.language === 'ar') ?? null;
}

export function bilingualVersion(node: TreeNode | null | undefined): TreeVersion | null {
  return node?.versions?.find((v) => v.language === 'bilingual') ?? null;
}

export function arabicStateOf(node: TreeNode | null | undefined, messageSource?: MessageSource | null): ArabicState {
  if (messageSource === 'default_template') return 'english_only';
  const v = arabicVersion(node);
  if (!v) return 'none';
  if (v.stale) return 'stale';
  const meta = v.metaStatus;
  if (meta !== 'APPROVED' && meta !== 'NOT_REQUIRED') {
    if (meta === 'NOT_CREATED') return 'not_submitted';
    if (meta === 'PENDING' || meta === 'IN_APPEAL') return 'waiting';
    return 'unusable';
  }
  if (v.reviewStatus !== 'reviewed') return 'needs_review';
  if (!v.sendable) return 'not_ready';
  // An Arabic ENTRY message is used only once the English one is approved (D2): until then customers get English.
  return node && englishNotApproved(node) ? 'english_pending' : 'sends';
}

// True for an entry node whose ENGLISH message is not yet approved by WhatsApp: the backend sends an
// Arabic entry message only once the English one is approved (D2 F3c).
export function englishNotApproved(node: TreeNode | null | undefined): boolean {
  return !!node && node.isEntry && node.templateStatus !== null && node.templateStatus !== 'approved';
}

export type FlowSummaryKind = 'english_only' | 'none' | 'ready' | 'not_ready';
export interface FlowSummary {
  kind: FlowSummaryKind;
  entryState: ArabicState;
  followUpsReady: number;
  followUpsTotal: number;
}

export function summarizeFlow(row: Pick<FlowTreeItem, 'messageSource' | 'nodes'>): FlowSummary {
  if (row.messageSource === 'default_template') {
    return { kind: 'english_only', entryState: 'english_only', followUpsReady: 0, followUpsTotal: 0 };
  }
  const nodes = row.nodes ?? [];
  const entry = nodes.find((n) => n.isEntry) ?? null;
  const followUps = nodes.filter((n) => n !== entry);
  const followUpsReady = followUps.filter((n) => arabicStateOf(n, row.messageSource) === 'sends').length;
  const entryState = entry ? arabicStateOf(entry, row.messageSource) : 'none';
  const kind: FlowSummaryKind = entryState === 'sends' ? 'ready' : entryState === 'none' ? 'none' : 'not_ready';
  return { kind, entryState, followUpsReady, followUpsTotal: followUps.length };
}

// The label of the button at `position` in a version (entry-node opt-out / url buttons carry position null
// and are never matched to an English button).
export function buttonText(version: TreeVersion | null | undefined, position: number): string | null {
  if (!version) return null;
  const b = version.buttons.find((x) => x.position !== null && x.position === position);
  return b ? b.text : null;
}

// An in-app link from the tree API ("/arabic/flows?node=abc") as routerLink commands + query params, so the
// hub opens inside the SPA instead of reloading the page. Anything that is not an in-app path gives null.
export function splitAppUrl(url: string | null | undefined): { commands: string[]; queryParams: Record<string, string> } | null {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const queryParams: Record<string, string> = {};
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(url.slice(q + 1))) queryParams[k] = v;
  }
  return { commands: [path], queryParams };
}

// The label of the parent button a follow-up node hangs from (the "After tapping ..." heading).
export function parentButtonLabel(nodes: TreeNode[], node: TreeNode): string {
  if (!node.parentNodeId || node.parentButtonPosition === null) return '';
  const parent = nodes.find((n) => n.messageNodeId === node.parentNodeId);
  return parent?.buttons.find((b) => b.position === node.parentButtonPosition)?.label ?? '';
}
