// Types of the WhatsApp onboarding flow (DF 1.x, contract DB-backend section 5 as amended by DECISIONS.md section 2).
// Every field the client reads is optional: a missing field is "unknown" and the UI falls back to neutral wording.

export type OnbSubState = 'none' | 'pending' | 'active' | 'past_due' | 'cancelled';
export type OnbView = 'billing' | 'setup' | 'done';
export type OnbStepKey = 'business' | 'number' | 'connect' | 'approvals' | 'promotion';
export const ONB_STEP_KEYS: readonly OnbStepKey[] = ['business', 'number', 'connect', 'approvals', 'promotion'] as const;
export type OnbNextStep = 'business' | 'number' | 'connect' | 'approvals' | 'customers' | 'products' | 'promotion';
// Server step statuses are free text on purpose ('todo' | 'in_progress' | 'done' | 'skipped' | 'waiting' | 'paused' ...).
export type OnbStepStatus = string;
export type OnbLevel = 'connected' | 'needs_attention' | 'reconnect_needed';
/** Level in a GET /connection snapshot: also 'not_connected' (in /state the same case is connection.level === null). */
export type OnbSnapshotLevel = OnbLevel | 'not_connected';
/** WhatsAppConnection.status as the backend stores it (the status of /connect/complete, /connect/resume and /connection answers). */
export type OnbConnectionStatus =
  | 'not_connected' | 'connecting' | 'waba_only' | 'connected' | 'needs_attention' | 'reconnect_required' | 'disconnected' | 'error';
export type OnbPromptState = 'pending' | 'skipped' | 'done';
export type OnbPromptKind = 'customers' | 'products';

export interface OnbSubscription {
  state?: OnbSubState;
  source?: string | null;
  retry?: { checkout?: boolean; billingPortal?: boolean; reconnect?: boolean };
}

export interface OnbStepInfo { status?: OnbStepStatus; completedAt?: string | null; [k: string]: unknown }

export interface OnbConnection {
  level?: OnbLevel | null;
  /** Raw connection status ('not_connected' without a row); the Step 3 screen uses it to skip a GET /connection. */
  status?: OnbConnectionStatus | null;
  numberMasked?: string | null;
  numberFull?: string | null;
  verifiedName?: string | null;
  causeCode?: string | null;
  causePath?: string | null;
  checkedAt?: string | null;
}

export interface OnbBusiness {
  name?: string | null;
  country?: string | null;
  industry?: string | null;
  website?: string | null;
  instagram?: string | null;
  crNumber?: string | null;
  crSkipped?: boolean;
  contactEmail?: string | null;
  uiLanguage?: 'en' | 'ar' | null;
  languages?: string[] | null;
  industryOptions?: string[] | null;
}

export interface OnbPromptInfo { state?: OnbPromptState }

export interface OnbCheckout {
  available?: boolean;
  plans?: { code: string; name?: string | null }[];
}

export interface OnbState {
  enrolled: boolean;
  view?: OnbView;
  subscription?: OnbSubscription;
  checkout?: OnbCheckout;
  prefill?: { businessName?: string | null; email?: string | null; planCode?: string | null } | null;
  locked?: boolean;
  unlockAt?: string | null;
  nextStep?: OnbNextStep | null;
  currentStep?: string | null;
  steps?: Partial<Record<OnbStepKey, OnbStepInfo>>;
  progress?: { completedAt?: string | null; status?: string | null } | null;
  business?: OnbBusiness | null;
  number?: { path?: string | null; usage?: string | null; paused?: boolean; [k: string]: unknown } | null;
  connection?: OnbConnection | null;
  prompts?: {
    customers?: OnbPromptInfo;
    products?: OnbPromptInfo;
    counts?: { customers?: number | null; products?: number | null; services?: number | null };
  } | null;
  firstPromotion?: {
    state?: string | null;
    suggestedKey?: string | null;
    /** Distinct phone numbers the server sent a test to (0 = no test yet). */
    testMessageCount?: number | null;
    testPhoneMasked?: string | null;
    startedAt?: string | null;
    doneAt?: string | null;
    [k: string]: unknown;
  } | null;
  sendingPaused?: { code: string } | null;
  notifications?: { unread?: number };
  lastError?: { code?: string; at?: string; step?: string | null } | null;
  checkedAt?: string | null;
}

export interface OnbHelpContext {
  businessName?: string | null;
  step?: number | null;
  stepKey?: string | null;
  lastError?: { code?: string; at?: string; step?: string | null } | null;
  supportEmail?: string | null;
  supportWhatsapp?: string | null;
  prefilledText?: string | null;
}

/** GET /notifications: `{ notifications, unread }` (a bare array is tolerated). */
export interface OnbNotificationsResponse { notifications?: OnbNotification[]; unread?: number }
export interface OnbNotification {
  id: string;
  kind: string;
  severity?: string;
  titleKey?: string;
  bodyKey?: string;
  params?: Record<string, string | number | null> | null;
  actionPath?: string | null;
  createdAt?: string;
  readAt?: string | null;
}

export interface OnbUrlResponse { url: string }
export interface OnbBillingRefreshResponse { changed: boolean; subscription?: OnbSubscription }

/** The connection object inside a /connect/complete or /connect/resume answer (masked number only: the full number lives in /state). */
export interface OnbConnectionSummary {
  status?: OnbConnectionStatus | null;
  numberMasked?: string | null;
  numberFull?: string | null;
  verifiedName?: string | null;
  phoneConnected?: boolean;
  webhookSubscribed?: boolean;
  needsReconnect?: boolean;
}

/** POST /connect/complete and POST /connect/resume (backend connect.js resultOf). nextStep is 'approvals' once connected. */
export interface OnbConnectResult {
  status?: OnbConnectionStatus | null;
  /** connected | needs_attention | reconnect_needed | not_connected (connect.js levelOf; the screen prefers status). */
  level?: OnbSnapshotLevel | null;
  steps?: Record<string, string>;
  connection?: OnbConnectionSummary | null;
  nextStep?: string | null;
}

/** GET /connection and POST /connection/refresh (statusRefresh.snapshot plus status; secret-free, masked number only). */
export interface OnbConnectionSnapshot {
  status?: OnbConnectionStatus | null;
  level?: OnbSnapshotLevel | null;
  numberMasked?: string | null;
  verifiedName?: string | null;
  needsReconnect?: boolean;
  reconnectReason?: string | null;
  cause?: { code?: string | null; path?: string | null } | null;
  causeCode?: string | null;
  causePath?: string | null;
  checkedAt?: string | null;
  lastStatusCheckAt?: string | null;
  /** Last four digits of the number (statusRefresh.snapshot); the UI uses numberMasked. */
  last4?: string | null;
  waitingForNumber?: boolean;
  webhookSubscribed?: boolean;
  /** Other statusRefresh.snapshot fields (verification, displayName, payment, messagingLimit, quality, health, webhook, token, nextCheckAt, checkFailures, lastError): not read by the UI. */
  [k: string]: unknown;
}

export interface OnbConnectConfig {
  enabled?: boolean;
  appId?: string;
  configId?: string;
  graphVersion?: string;
  extras?: Record<string, unknown>;
  sdkLocale?: string;
  attemptId?: string;
  expiresInSec?: number;
  reconnect?: { expectedWabaId: string | null } | null;
}

export interface OnbConnectEventBody {
  attemptId: string;
  event: 'CANCEL' | 'ERROR' | 'NO_FACEBOOK';
  currentStep?: string;
  errorCode?: string;
  errorMessage?: string;
}
export interface OnbConnectEventResponse { outcome?: string; code?: string; nextStep?: string | null; copyKey?: string }

export interface OnbConnectCompleteBody {
  attemptId: string;
  code: string;
  session: { event?: string; phone_number_id?: string; waba_id?: string; business_id?: string };
}

export interface OnbNumberPathBody {
  hasNumber: boolean;
  usage?: 'unused' | 'personal' | 'business_app' | 'landline';
  acknowledgeRemoval?: boolean;
  businessAppChoice?: 'coexistence' | 'migrate' | 'different_number';
}
export interface OnbNumberPathResponse {
  path?: string;
  nextStep?: string | null;
  guidance?: { keys?: string[]; coexistence?: 'unknown' | 'maybe_available'; callRequired?: boolean; waitMinutes?: number };
}

/** POST /number/ready. */
export interface OnbNumberReadyResponse { path?: string; numberReady?: boolean; nextStep?: string | null }
/** POST /number/support-request. */
export interface OnbSupportRequestResponse { ok?: boolean; duplicate?: boolean; requestId?: string }
/** POST /preferences. */
export interface OnbPreferencesResponse { uiLanguage?: 'en' | 'ar'; languages?: string[] }
/** POST /prompts/customers and /prompts/products. */
export interface OnbPromptResponse {
  kind?: OnbPromptKind;
  state?: OnbPromptState;
  nextStep?: string | null;
  prompts?: { customers?: OnbPromptInfo; products?: OnbPromptInfo };
}
/** POST /approvals/payment-confirmed (self-attestation: never "verified"). */
export interface OnbPaymentConfirmedResponse { ok?: boolean; payment?: { status?: string; confirmedAt?: string | null }; alreadyConfirmed?: boolean }
/** POST /display-name. */
export interface OnbDisplayNameResponse { ok?: boolean; displayName?: { value?: string; status?: string; editsRemaining?: number } }
/** POST /templates/:key/:language/resubmit. */
export interface OnbTemplateResubmitResponse { template?: OnbTemplateRow }
/** POST /first-promotion/state. */
export interface OnbFirstPromotionStateResponse {
  state?: string;
  sendPolicy?: 'block' | 'platform_number';
  firstPromotion?: { state?: string; startedAt?: string | null; doneAt?: string | null };
}
/** POST /connection/disconnect. */
export interface OnbDisconnectResponse { status?: string; unsubscribed?: boolean }
/** POST /notifications/read. */
export interface OnbNotificationsReadResponse { modified?: number; unread?: number }

export type OnbApprovalRowKey = 'verification' | 'displayName' | 'payment' | 'messagingLimit' | 'templates';
export interface OnbApprovalRow {
  key: OnbApprovalRowKey | string;
  status: 'done' | 'waiting' | 'needs_you' | string;
  valueKey?: string | null;
  /** displayName: the requested or verified name (string); messagingLimit: the tier number or the raw Meta value; others: text. */
  value?: unknown;
  reasonKey?: string | null;
  blocking?: boolean;
  links?: { securityCenter?: string; paymentHelp?: string; paymentSettings?: string; whatsappManager?: string };
  checkedAt?: string | null;
  // displayName row (backend approvals.js: sibling fields of the row, not inside value)
  canEdit?: boolean | null;
  editsRemaining?: number | null;
  rejectionKey?: string | null;
  // messagingLimit row
  tierNumber?: number | null;
  raw?: string | null;
  // templates row
  counts?: { approved?: number; total?: number; waiting?: number; problem?: number };
  rejectedReason?: string | null;
}
export interface OnbApprovalsResponse { rows: OnbApprovalRow[]; overall?: string; checkedAt?: string | null; level?: string | null }

/** Why a template row is never submitted: arabic_not_reviewed or legal (shown as "Arabic version waiting for review"), invalid (hidden). */
export type OnbTemplateBlockedReason = 'arabic_not_reviewed' | 'legal' | 'invalid';
export interface OnbTemplateRow {
  key: string;
  language: string;
  /** Backend uiStatus: queued | pending | approved | rejected | paused | unavailable | blocked (Meta words are tolerated). */
  status: string;
  category?: string | null;
  title?: { en?: string; ar?: string };
  reasonKey?: string | null;
  rejectedReason?: string | null;
  recommendation?: string | null;
  blockedReason?: OnbTemplateBlockedReason | string | null;
  revision?: number;
  canResubmit?: boolean;
}
export interface OnbTemplateCapacity {
  ceiling?: number; metaLimit?: number; used?: number; remaining?: number; total?: number; approved?: number; pending?: number;
  rejected?: number; queued?: number; blocked?: number; arabicRequested?: boolean;
}
export interface OnbTemplatesResponse {
  templates?: OnbTemplateRow[];
  capacity?: OnbTemplateCapacity | null;
  submitted?: number;
  failed?: number;
  blocked?: { code?: string; nextStep?: string | null };
}

export interface OnbFirstPromotion {
  ready?: boolean;
  /** The sidecar state: locked | ready | started | done | skipped. */
  state?: string | null;
  missing?: { audience?: boolean; products?: boolean; template?: boolean };
  suggestion?: {
    templateKey?: string;
    titleKey?: string;
    title?: { en?: string; ar?: string };
    bodyPreview?: { en?: string; ar?: string };
    audience?: { optedIn?: number; total?: number };
    campaignType?: 'store_wide_offer' | 'product_promotion' | 'loyalty_reminder';
  };
  testRecipient?: { masked?: string | null; needsPhone?: boolean };
  builderHint?: { path?: string };
  sendPolicy?: 'block' | 'platform_number';
}

export type OnbEventType = 'step_enter' | 'step_complete' | 'step_skip' | 'help_opened' | 'step_fail';
export type OnbEventStep = 'business' | 'number' | 'connect' | 'approvals' | 'customers' | 'products' | 'promotion' | 'billing';
export interface OnbEventBody { type: OnbEventType; step: OnbEventStep; code?: string; durationMs?: number }
export const ONB_EVENT_TYPES: readonly OnbEventType[] = ['step_enter', 'step_complete', 'step_skip', 'help_opened', 'step_fail'] as const;
export const ONB_EVENT_STEPS: readonly OnbEventStep[] = [
  'business', 'number', 'connect', 'approvals', 'customers', 'products', 'promotion', 'billing',
] as const;

// Industry keys (DECISIONS C9); the backend also returns them as state.business.industryOptions.
export const ONB_INDUSTRY_KEYS: readonly string[] = [
  'restaurant', 'salon_beauty', 'fashion', 'grocery', 'electronics', 'health', 'fitness', 'home_furniture', 'services', 'other',
] as const;

// Backend error catalogue (DB 4.7) ...
export const ONB_BACKEND_ERROR_CODES = [
  // access
  'ONBOARDING_NOT_AVAILABLE', 'SUBSCRIPTION_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_PAST_DUE', 'SUBSCRIPTION_CANCELLED',
  'WHATSAPP_NOT_CONNECTED', 'WHATSAPP_RECONNECT_REQUIRED', 'SENDING_NOT_AVAILABLE_YET', 'OWNER_ONLY', 'NOT_A_MEMBER', 'LEGAL_ACCEPTANCE_REQUIRED',
  // input
  'VALIDATION_FAILED', 'STEP_PREREQUISITE', 'NUMBER_PERSONAL_WARNING_REQUIRED', 'NUMBER_ALREADY_CONNECTED', 'RATE_LIMITED',
  // billing
  'CHECKOUT_NOT_CONFIGURED', 'PLAN_UNKNOWN', 'BILLING_PORTAL_UNAVAILABLE', 'STRIPE_ERROR', 'SUBSCRIPTION_EXISTS',
  // connect
  'CONNECT_NOT_CONFIGURED', 'ENCRYPTION_NOT_CONFIGURED', 'CONNECT_IN_PROGRESS', 'CONNECT_ATTEMPT_INVALID',
  'CONNECT_CODE_INVALID_OR_EXPIRED', 'CONNECT_WABA_MISMATCH', 'CONNECT_NUMBER_IN_USE_BY_OTHER_ACCOUNT',
  'CONNECT_NUMBER_REGISTERED_ELSEWHERE', 'CONNECT_VERIFICATION_FAILED', 'CONNECT_CANCELLED', 'CONNECT_NO_FACEBOOK_ACCOUNT',
  'CONNECT_COEXISTENCE_UNAVAILABLE', 'CONNECT_REGISTER_RATE_LIMITED', 'CONNECT_PARTIAL', 'CONNECT_AMBIGUOUS_WABA',
  // meta
  'META_UNREACHABLE', 'META_ERROR', 'META_TOKEN_REVOKED', 'META_PERMISSION_MISSING', 'META_RATE_LIMITED', 'META_NOT_CONFIGURED',
  // templates / test
  'TEMPLATE_LIMIT_REACHED', 'TEMPLATE_REJECTED', 'TEST_RATE_LIMITED', 'TEST_NO_APPROVED_TEMPLATE', 'TEST_RECIPIENT_OPTED_OUT',
  'TEST_PHONE_INVALID', 'TEST_NUMBER_LIMIT',
] as const;

// ... plus the client-only codes (DF 6; the six ONB_* step_fail codes are also the analytics whitelist, DECISIONS C4).
export const ONB_CLIENT_ERROR_CODES = [
  'ONB_NETWORK', 'ONB_GENERIC', 'ONB_STATE_UNAVAILABLE', 'ONB_SDK_BLOCKED', 'ONB_SDK_TIMEOUT', 'ONB_POPUP_BLOCKED',
  'ONB_IN_APP_BROWSER', 'ONB_CODE_HANDOFF_SLOW', 'ONB_IMPORT_TOO_MANY', 'ONB_IMPORT_BAD_FILE', 'ONB_IMPORT_NO_ROWS',
] as const;

export const ONB_ERROR_CODES: readonly string[] = [...ONB_BACKEND_ERROR_CODES, ...ONB_CLIENT_ERROR_CODES];

export const ONB_STEP_FAIL_CODES: readonly string[] = [
  'ONB_SDK_BLOCKED', 'ONB_SDK_TIMEOUT', 'ONB_POPUP_BLOCKED', 'ONB_IN_APP_BROWSER', 'ONB_NETWORK', 'ONB_CODE_HANDOFF_SLOW',
] as const;
export const ONB_STEP_SKIP_CODES: readonly string[] = ['customers_skipped', 'products_skipped', 'number_paused', 'cr_skipped'] as const;
