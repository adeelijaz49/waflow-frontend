// Shared types for the Arabic localisation feature — the CONTRACT between the
// frontend pages and the backend routes under /api/localization (see the
// backend's routes/localization/* and shared/localization/*). Every response
// shape the pages consume is defined here; the backend returns exactly these.
//
// Conventions:
//  * ids are 24-hex strings, dates are ISO-8601 strings;
//  * server messages are NEVER shown verbatim when a `code` is present — pages
//    map codes to catalogue keys (errors.<code>, templates.issue.<code>, ...);
//  * `Lang` (the UI language) lives in ../../i18n; message languages add 'bilingual'.
import type { Lang } from '../../i18n';

export type { Lang };

export type MessageLanguage = 'en' | 'ar' | 'bilingual';
export type CustomerLang = 'en' | 'ar' | 'unknown';
export type LanguageSource = 'merchant_set' | 'csv_import' | 'inferred' | 'customer_chose';
export type LanguageMode = 'per_customer' | 'en' | 'ar' | 'bilingual';
export type BilingualOrder = 'ar_first' | 'en_first';
export type AiLanguagePref = 'auto' | 'en' | 'ar';

// Meta's real template statuses (Graph v25) + our own NOT_CREATED/ERROR. FLAGGED is NOT a status
// (it is a webhook event) — see TemplateVariant.metaFlagged. Unknown Graph values are kept in
// metaStatusRaw and shown as a non-sendable status.
export type MetaStatus =
  | 'NOT_CREATED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL'
  | 'PENDING_DELETION' | 'DELETED' | 'LIMIT_EXCEEDED' | 'ARCHIVED' | 'ERROR';
export type ReviewStatus = 'draft' | 'reviewed';
export type TemplateCategory = 'MARKETING' | 'UTILITY';
export type TemplateUseCase =
  | 'comeback' | 'loyalty_reminder' | 'points_balance' | 'points_expiring' | 'payment_reminder'
  | 'booking_confirmation' | 'booking_reminder' | 'order_confirmation' | 'referral_invite'
  | 'referral_reward' | 'welcome_optin' | 'promotion' | 'greeting' | 'custom';
// opt_in / decline = consent-request buttons (payload consent_yes_/consent_no_<customerId>);
// opt_out = marketing opt-out (payload optout_<campaignId>); url = a static https link;
// flow_button = a button of a linked Automated-Flows message (payload msgnode_<nodeId>_<position>).
export type ButtonRole = 'opt_in' | 'decline' | 'opt_out' | 'url' | 'flow_button';
export type VariantSource = 'merchant' | 'library' | 'ai' | 'import';

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';
export type SendStatus =
  | 'queued' | 'sending' | 'sent' | 'failed' | 'skipped_no_consent' | 'skipped_opted_out'
  | 'skipped_blocked' | 'skipped_no_credit' | 'skipped_demo' | 'skipped_error';

// ── Generic ────────────────────────────────────────────────────────────────
export interface ApiErrorBody { error: string; code?: string }
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export interface ValidationIssue { code: string; field?: string; detail?: Record<string, string | number> }

// ── Settings & overview ────────────────────────────────────────────────────
export interface LocalizationSettings {
  arabicEnabled: boolean;
  arabicEnabledAt: string | null;
  defaultCustomerLanguage: Lang;
  bilingualOrder: BilingualOrder;
}
export interface MyLanguagePrefs { uiLanguage: Lang; aiLanguage: AiLanguagePref }
export interface OverviewSummary {
  customers: { total: number; en: number; ar: number; unknown: number };
  templates: {
    total: number; withArabic: number; arabicApproved: number; arabicPending: number;
    arabicRejected: number; arabicNotSubmitted: number; arabicOther: number; // paused / archived / deleted / limit...
  };
  campaigns: { total: number; lastSentAt: string | null };
  review: { templatesDraft: number; catalogDraft: number; backendStringsDraft: number };
}

// ── Customers ──────────────────────────────────────────────────────────────
export interface CustomerLanguageRow {
  id: string;
  name: string;
  phone: string;
  language: CustomerLang;
  languageSource: LanguageSource | null;
  effectiveLanguage: Lang;
  marketingConsent: boolean;
  optedOut: boolean;
}
export interface CustomerLanguageCounts { en: number; ar: number; unknown: number; total: number }
export interface CustomerLanguageList extends Page<CustomerLanguageRow> { counts: CustomerLanguageCounts }
export type ImportOutcome =
  | 'updated' | 'unchanged' | 'unmatched' | 'invalid_language' | 'invalid_phone' | 'duplicate' | 'protected';
export interface LanguageImportRow { line: number; phone: string; language: string; outcome: ImportOutcome }
export interface LanguageImportResult {
  dryRun: boolean;
  encoding: string;
  delimiter: string;
  summary: { rows: number; updated: number; unchanged: number; unmatched: number; invalid: number; duplicate: number; protected: number };
  rows: LanguageImportRow[];
  truncated: boolean;
}

// ── Templates ──────────────────────────────────────────────────────────────
export interface TemplateButton { role: ButtonRole; text: string; url?: string }
export interface VariantInput {
  header?: string;
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
  bilingualOrder?: BilingualOrder;
  source?: VariantSource;
}
export interface VariantValidation {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  positionalText: string;
  params: string[];
}
export interface TemplateVariant {
  language: MessageLanguage;
  bilingualOrder: BilingualOrder | null;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  metaTemplateName: string | null;
  metaStatus: MetaStatus;
  metaRejectedReason: string | null;
  // What Meta reports back (Meta may re-classify UTILITY as MARKETING). Consent gating uses metaCategory || template category.
  metaCategory: TemplateCategory | null;
  metaPreviousCategory: TemplateCategory | null;
  metaFlagged: boolean;
  metaStatusRaw: string | null;
  metaLastCheckedAt: string | null;
  submittedAt: string | null;
  submissionCount: number;
  lastError: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  source: VariantSource;
  validation: VariantValidation;
  sendable: boolean;
  // not_submitted | pending | rejected | paused | disabled | flagged | not_approved | not_reviewed | missing
  notSendableReason: string | null;
  updatedAt: string;
}
export interface LocalizedTemplate {
  id: string;
  key: string;
  name: string;
  useCase: TemplateUseCase;
  category: TemplateCategory;
  archived: boolean;
  linkedMessageNodeId: string | null;
  variants: TemplateVariant[];
  createdAt: string;
  updatedAt: string;
}
export interface LibraryEntry {
  key: string;
  useCase: TemplateUseCase;
  category: TemplateCategory;
  name: { en: string; ar: string };
  fields: string[];
  variants: { en: VariantInput; ar: VariantInput };
}
export interface RenderedPreview {
  language: MessageLanguage;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  usedValues: Record<string, string>;
  missingFields: string[];
}
// WhatsApp allows 250 templates per account and every language version of every revision uses a slot
// (deleting is forbidden), so submissions are refused at a ceiling (default 90).
export interface TemplatesUsage {
  used: number | null; // null when Meta could not be reached
  limit: number | null;
  ceiling: number;
  atCeiling: boolean;
}
export interface SubmitResult {
  template: LocalizedTemplate;
  submission: { metaTemplateName: string; metaStatus: MetaStatus; dryRun: boolean };
}

// ── Campaigns ──────────────────────────────────────────────────────────────
export type SegmentKey = 'language' | 'inactive_days' | 'has_points' | 'awaiting_consent';
export interface AudienceSpec {
  kind: 'all_eligible' | 'customer_ids' | 'segment';
  customerIds?: string[];
  segmentKey?: SegmentKey;
  segmentParams?: { language?: CustomerLang; days?: number; minPoints?: number };
}
export interface CampaignPlanVariantRow {
  language: MessageLanguage;
  present: boolean;
  metaStatus: MetaStatus;
  reviewStatus: ReviewStatus;
  sendable: boolean;
  notSendableReason: string | null;
  recipients: number;
}
export interface CampaignPlan {
  templateId: string;
  templateName: string;
  category: TemplateCategory;
  languageMode: LanguageMode;
  audience: { selected: number; eligible: number };
  skipped: { noConsent: number; optedOut: number; demo: number; invalidPhone: number };
  byLanguage: { en: number; ar: number; bilingual: number };
  fallbacks: Array<{ from: MessageLanguage; to: MessageLanguage; reason: string; count: number }>;
  blocked: Array<{ reason: string; count: number }>;
  variants: CampaignPlanVariantRow[];
  missingFieldValues: string[];
  warnings: Array<{ code: string; detail?: Record<string, string | number> }>;
  canSend: boolean;
  needsAcknowledgement: boolean;
  sampleRecipients: Array<{ customerId: string; name: string; language: MessageLanguage; fallback: boolean; preview: string }>;
}
export interface CampaignPlanRequest {
  templateId: string;
  languageMode: LanguageMode;
  audience: AudienceSpec;
  fieldValues?: Record<string, string>;
}
export interface CampaignCreateRequest extends CampaignPlanRequest { name: string }
export interface CampaignStats {
  total: number; sent: number; failed: number; skipped: number;
  byLanguage: { en: number; ar: number; bilingual: number };
}
export interface LocalizedCampaignView {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  languageMode: LanguageMode;
  audience: AudienceSpec;
  fieldValues: Record<string, string>;
  status: CampaignStatus;
  plan: CampaignPlan | null;
  stats: CampaignStats;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CampaignRecipientRow {
  customerId: string;
  name: string;
  phone: string;
  requestedLanguage: MessageLanguage | null;
  usedLanguage: MessageLanguage | null;
  fallback: boolean;
  fallbackReason: string | null;
  status: SendStatus;
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null;
  wamid: string | null;
  error: string | null;
  // Meta error code of a failed send (132001 template missing/unapproved, 132015 paused, 132016 disabled,
  // 132000/132012/132018 parameters, 131049/131050 marketing limit / user stopped marketing, 131047 outside window...).
  errorCode: string | null;
}
export interface CampaignReport {
  campaignId: string;
  status: CampaignStatus;
  stats: CampaignStats;
  byLanguage: Record<'en' | 'ar' | 'bilingual', { sent: number; delivered: number; read: number; failed: number }>;
  byStatus: Partial<Record<SendStatus, number>>;
  fallbackCount: number;
}
export interface SegmentOption { key: SegmentKey; params: Array<'language' | 'days' | 'minPoints'> }

// ── AI assist (always drafts; never auto-applied, never auto-sent) ──────────
export type AiAssistContext = 'template_body' | 'template_header' | 'template_footer' | 'button' | 'caption' | 'inbox' | 'product';
export interface AiWarning { code: string; detail?: Record<string, string | number> }
export interface AiTextResult {
  text: string;
  draft: true;
  from: Lang | 'auto';
  to: Lang;
  warnings: AiWarning[];
  // tokens that MUST be unchanged ({fields}, numbers, URLs, dates) and whether they were verified
  protectedTokens: { count: number; verified: boolean };
}
export interface AiSaudiFriendlyResult extends Omit<AiTextResult, 'from' | 'to'> {
  buttons?: string[];
}
export interface AiInboundTranslation { translation: string; detectedLanguage: Lang | 'unknown'; draft: true }
export interface AiProductSuggestion { name: string; description: string; draft: true; warnings: AiWarning[] }

// ── Catalogue (Arabic names/descriptions for products & services) ──────────
export type CatalogKind = 'product' | 'service';
export interface CatalogTranslation {
  name: string;
  description: string;
  status: ReviewStatus;
  source: 'merchant' | 'csv' | 'ai';
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}
export interface CatalogItemRow {
  kind: CatalogKind;
  refId: string;
  name: string;
  description: string;
  category: string;
  active: boolean;
  translation: CatalogTranslation | null;
}
export interface CatalogList extends Page<CatalogItemRow> { counts: { missing: number; draft: number; reviewed: number } }
export interface CatalogImportResult {
  dryRun: boolean;
  encoding: string;
  summary: { rows: number; updated: number; unchanged: number; unmatched: number; invalid: number };
  rows: Array<{ line: number; name: string; outcome: ImportOutcome | 'ambiguous' }>;
  truncated: boolean;
}

// ── Inbox (Arabic-ready inbox page; list/thread/snapshot reuse InboxApiService) ──
export interface InboxConversation {
  customerId: string; name: string; phone: string; optedOut: boolean; unreadCount: number;
  lastMessageAt: string | null; lastMessagePreview: string | null; tags: string[];
  language: CustomerLang;
}
export interface InboxContext { customerId: string; language: CustomerLang; languageSource: LanguageSource | null; effectiveLanguage: Lang }
export interface InboxActionResult { sent: boolean; reason?: string; fallbackAvailable?: boolean; messageId?: string }

// ── AI Mode (Arabic) ───────────────────────────────────────────────────────
export interface AiModeMessage { role: 'user' | 'assistant'; text: string; createdAt: string }
export interface AiModePendingAction { id: string; toolName: string; args: Record<string, unknown>; summary: string; createdAt: string }
export interface AiModeSession { sessionId: string; messages: AiModeMessage[]; pendingAction: AiModePendingAction | null }
export interface AiModeTurn {
  sessionId: string;
  reply: string;
  pendingAction: AiModePendingAction | null;
  language: Lang;
  usage: { inputTokens: number; outputTokens: number };
}
export interface AiModeConfirmResult { reply: string; pendingAction: null }
export interface AiModeInsight {
  insightKey: string; category: string; categoryLabel: string; icon: string; title: string; message: string;
  metricLabel: string; metricValue: string; primaryCtaLabel: string | null; primaryCta: unknown; secondaryCtaLabel: string | null;
  secondaryCta: unknown; localized: boolean;
}

// ── Flows overlay ──────────────────────────────────────────────────────────
export interface FlowMessageNodeRow {
  messageNodeId: string;
  bodyText: string;
  buttons: Array<{ position: number; label: string }>;
  templateStatus: 'not_created' | 'pending' | 'approved' | 'rejected';
  localizedTemplateId: string | null;
  variantStatus: Array<{ language: MessageLanguage; metaStatus: MetaStatus; reviewStatus: ReviewStatus }>;
}
export interface FlowMessageRow {
  flowId: string;
  flowName: string;
  triggerType: string;
  status: 'active' | 'paused';
  promotionId: string | null;
  nodes: FlowMessageNodeRow[];
}

// ── Review (native-review counts) ──────────────────────────────────────────
export interface ReviewSummary {
  templates: { draft: number; reviewed: number };
  catalog: { draft: number; reviewed: number; missing: number };
  backendStrings: { total: number; draft: number; reviewed: number; needsLegalApproval: number };
}
