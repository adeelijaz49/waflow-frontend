import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { DialogService } from '../../shared/dialog.service';
import { MessageNodeEditor, MessageNodeDraft, MessageNodeButtonDraft } from '../../shared/message-node-editor/message-node-editor';
import {
  CONSENT_BODY_SUGGESTIONS, CONSENT_WRITING_GUIDANCE, ConsentWordingIssue, actionName, checkConsentWording,
  consentWordingHash, consentWordingSignature, isConsentAction, labelLimitFor,
} from '../../shared/message-node-editor/consent-wording';
import { ConversationFlowViewer } from '../../shared/conversation-flow-viewer/conversation-flow-viewer';
import { InsightCardComponent, Insight } from '../../shared/insight-card/insight-card';
import { InsightActionsService } from '../../shared/insight-actions.service';
import { LocalizationFlagService } from '../../services/localization-flag.service';
import { PromotionLanguagePanel } from '../localization/embedded/promotion-language-panel';
import { SenderLanguageNote } from '../localization/embedded/sender-language-note';
import { FlowLanguagePanel } from '../localization/embedded/flow-language-panel';
import { LanguagePlanBridge } from '../localization/embedded/language-plan-bridge';
import { TrackedSet } from '../localization/embedded/tracked-set';

const MAX_BRANCH_DEPTH = 3; // mirrors shared/operations.js#MAX_BRANCH_DEPTH
export const TEMPLATE_POLL_MS = 60000; // how often a pending template is re-checked with Meta while it is on screen (every check is a read Meta rate-limits per WhatsApp account)
const CONSENT_FILTERS = ['opted_in', 'not_responded', 'opted_out'] as const;
export type AudienceFilter = '' | typeof CONSENT_FILTERS[number];

// Guided creation paths — picking one pre-fills sensible defaults + a suggested
// message (dropped into `description`, which the WhatsApp send now includes)
// so a merchant can start from something reasonable instead of a blank form.
const CAMPAIGN_TYPES = [
  {
    value: 'product_promotion', icon: '🛍️', label: 'Product Promotion',
    blurb: 'Discount on specific products or a category.',
    defaults: { scope: 'products', customerType: 'cash', type: 'specific_products', discountPercent: 20 },
    suggestedMessage: "Check out our latest offer — handpicked products at a special price, just for you!",
  },
  {
    value: 'service_booking_campaign', icon: '✂️', label: 'Service Booking Campaign',
    blurb: 'Fill appointment slots for your services.',
    defaults: { scope: 'services', customerType: 'cash', discountPercent: 15 },
    suggestedMessage: 'Treat yourself! Book an appointment with us this week and enjoy a special rate.',
  },
  {
    value: 'loyalty_reminder', icon: '💎', label: 'Loyalty Points Campaign',
    blurb: 'Encourage points customers to redeem their balance.',
    defaults: { scope: 'products', customerType: 'points', type: 'specific_products', pointsPrice: 100 },
    suggestedMessage: "You've earned it! Redeem your loyalty points on these items before they're gone.",
  },
  {
    value: 'inactive_customer_comeback', icon: '💌', label: 'Win Back Inactive Customers',
    blurb: "Targets customers who haven't ordered in a while, with a stronger offer.",
    defaults: { scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: 25 },
    targetSegment: 'Inactive customers',
    suggestedMessage: 'We miss you! Come back and enjoy an exclusive discount, on us.',
  },
  {
    value: 'store_wide_offer', icon: '🏪', label: 'Store-Wide Offer',
    blurb: 'One broad discount across everything, for everyone.',
    defaults: { scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: 15 },
    suggestedMessage: "Everything's on sale! Don't miss this store-wide offer.",
  },
  {
    // Not a promotion of products: its only job is to ask customers for permission to send them offers on WhatsApp.
    value: 'consent_request', icon: '🤝', label: 'Ask customers to opt in',
    blurb: 'Ask customers for permission to send them offers on WhatsApp, with your own Yes / No buttons.',
    defaults: { scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: 0, purpose: 'consent_request' },
    suggestedMessage: 'Ask customers to opt in to WhatsApp offers',
  },
];

@Component({
  selector: 'app-promotions',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, StatusBadgePipe, MessageNodeEditor, ConversationFlowViewer, InsightCardComponent, PromotionLanguagePanel, SenderLanguageNote, FlowLanguagePanel],
  templateUrl: './promotions.html',
  styleUrls: ['./promotions.css', './promotions-consent.css'],
})
export class Promotions implements OnInit, OnDestroy {
  promotions: any[] = [];
  categories: string[] = [];
  allProducts: any[] = [];
  allServices: any[] = [];
  loading = false;

  // Create / Edit / View form
  showCreateModal = false;
  saving = false;
  editingPromoId: string | null = null;
  viewMode = false;
  viewingPromo: any = null;
  form: any = this.emptyForm();
  campaignTypes = CAMPAIGN_TYPES;
  pickingType = false;

  // Custom entry message (see models/MessageNode.js) — DEFECT-02: the same
  // branching editor Flows already had, reused here rather than a second
  // implementation. Edit-mode only, since a MessageNode needs a real
  // promotion id as its owner (mirrors pages/flows/flows.ts exactly).
  useCustomEntry = false;
  existingEntryNode: any = null;
  entryDraft: MessageNodeDraft = { bodyText: '', buttons: [] };
  savingEntryNode = false;
  submittingTemplate = false;
  refreshingStatus = false;
  entryError: string | null = null;
  editorViewMode: 'flat' | 'conversation' = 'flat';

  // Consent request (purpose 'consent_request'): the wording guard. The acknowledgement is of one specific wording,
  // so it is remembered together with that wording's signature and stops counting the moment the wording changes.
  consentAck = false;
  private consentAckSig = '';
  private consentAckHash = ''; // fingerprint of the wording that was acknowledged and saved (Promotion.consentWordingAck.textHash)
  private issuesCache: { sig: string; issues: ConsentWordingIssue[] } | null = null;
  readonly bodySuggestions = CONSENT_BODY_SUGGESTIONS;
  readonly writingGuidance = CONSENT_WRITING_GUIDANCE;
  readonly actionName = actionName;

  // Campaign panel
  activePromo: any = null;
  recommendedCustomers: any[] = [];
  selectedCustomerIds = new TrackedSet<string>();
  recommendLimit = 100;
  loadingRecs = false;

  // Consent audience filter of the two customer lists. '' = everyone (what the panel always showed). A consent
  // request starts on "Not yet responded". Only changes the parameters of the requests the panel already makes.
  audienceFilter: AudienceFilter = '';
  private recsStale = false;
  // Customers seen in the lists so far (id -> row): lets the "will be skipped" warning count selected customers
  // that are on another page or tab.
  private knownCustomers = new Map<string, any>();

  // The server refused a send because the custom message is not approved yet (HTTP 409 template_not_approved).
  // submitFailed: the server could not even send it to Meta (its own reason is in `message`), so "being sent for approval" would be untrue.
  templateBlock: { message: string; submittedNow: boolean; submitFailed?: boolean } | null = null;
  private templatePollTimer: any = null;
  private templatePollSeq = 0; // bumped whenever polling stops or the promotion changes: older answers are ignored

  // "All Customers" tab — DEFECT-04B: the Recommended panel is always RFM-ranked
  // and capped, so it's not a substitute for browsing/searching the merchant's
  // full customer base. Selection (selectedCustomerIds) is shared across both tabs.
  customerViewMode: 'recommended' | 'all' = 'recommended';
  allCustomers: any[] = [];
  allCustomersTotal = 0;
  allCustomersPage = 1;
  allCustomersPageSize = 50;
  allCustomersSearch = '';
  loadingAllCustomers = false;
  sending = false;
  sendResult: any = null;
  campaignReport: any = null;
  loadingReport = false;
  // What WhatsApp did with the send just made (accepted vs delivered vs refused, with the reasons) — see checkDelivery().
  delivery: any = null;
  // Why messages of this promotion were refused (whole promotion), listed under the Campaign Report when any failed.
  reportFailures: any[] = [];
  deliveryUnavailable = false; // the delivery check itself failed (shown instead of "Checking delivery…")
  private sendStartedAt = 0;
  private deliveryTimer: any = null;
  private sendSeq = 0; // bumped by every send and every promotion switch: answers carrying an older number are stale and ignored
  preview: any = null;
  loadingPreview = false;
  previewError: string | null = null;
  testPhone = '';
  sendingTest = false;
  testResult: any = null;

  // Loyalty reminder
  showLoyaltyModal = false;
  sendingLoyalty = false;
  loyaltyResult: any = null;

  // Smart Insights
  insights: Insight[] = [];
  // Customer selection lives in the post-save Campaign Panel, not the create
  // form itself — a "Create Comeback Campaign" insight CTA can't pre-select
  // the exact 20 inactive customers at create time, so this is stashed here
  // and applied once the newly-created promotion's Campaign Panel opens
  // (see savePromotion()).
  private pendingInsightCustomerIds: string[] | null = null;

  readonly loc = inject(LocalizationFlagService);
  private readonly langPlan = inject(LanguagePlanBridge);

  constructor(
    private api: ApiService, private route: ActivatedRoute, private dialog: DialogService,
    private insightActions: InsightActionsService,
  ) {}

  ngOnInit() {
    this.loadPromotions();
    this.api.getProductCategories().subscribe(cats => this.categories = cats);
    this.api.getProducts({ limit: 500 }).subscribe(res => this.allProducts = res.products);
    this.api.getServices().subscribe(svcs => this.allServices = svcs);
    this.api.getInsights('campaigns').subscribe({ next: (data) => { this.insights = data; }, error: () => {} });

    const params = this.route.snapshot.queryParamMap;
    if (params.get('openLoyalty') === 'true') this.showLoyaltyModal = true;

    if (params.get('openCreate') === 'true') {
      const campaignType = params.get('campaignType');
      const customerIds = params.get('customerIds')?.split(',').filter(Boolean);
      const productName = params.get('productName') || undefined;
      this.openCreateFromInsight(campaignType, customerIds, productName);
    }
    const viewId = params.get('viewPromotionId');
    if (viewId) this.api.getPromotion(viewId).subscribe({ next: (p) => this.openViewEdit(p), error: () => {} });

    const runAgainId = params.get('runAgainPromotionId');
    if (runAgainId) this.api.getPromotion(runAgainId).subscribe({ next: (p) => this.duplicatePromotion(p), error: () => {} });
  }

  ngOnDestroy() {
    clearTimeout(this.deliveryTimer);
    this.stopTemplatePolling();
  }

  dismissInsight(insight: Insight)   { this.insightActions.dismiss(insight, this.insights); }
  insightPrimary(insight: Insight)   { this.insightActions.primaryAction(insight, this.insights); }
  insightSecondary(insight: Insight) { this.insightActions.secondaryAction(insight); }

  // "Create Comeback Campaign" / "Create Product Campaign" / "Send Loyalty
  // Reward" insight CTAs all land here — skips the manual type-picker screen
  // since the insight already determined the right campaign type.
  openCreateFromInsight(campaignType: string | null, customerIds?: string[], productName?: string) {
    this.openCreate();
    const ct = this.campaignTypes.find(c => c.value === campaignType);
    if (ct) this.selectCampaignType(ct);
    if (productName) {
      const match = this.allProducts.find(p => p.name === productName);
      if (match) this.form.selectedProducts = [match._id];
      // No exact match — the suggested description already names the
      // product in plain text, which is enough context for the merchant to
      // pick it manually below.
      else this.form.description = `${this.form.description} Featuring ${productName}.`.trim();
    }
    this.pendingInsightCustomerIds = customerIds?.length ? customerIds : null;
  }

  // "Run Again" — duplicates the campaign setup and opens it for review
  // before sending; never sends anything itself.
  duplicatePromotion(source: any) {
    this.openCreate();
    this.pickingType = false;
    this.form = {
      ...this.emptyForm(),
      name: `${source.name} (Copy)`,
      description: source.description || '',
      scope: source.scope || 'products',
      customerType: source.customerType || 'cash',
      type: source.type || 'specific_products',
      campaignType: source.campaignType || null,
      purpose: this.isConsentPromo(source) ? 'consent_request' : 'standard',
      discountPercent: source.discountPercent ?? 20,
      pointsPrice: source.pointsPrice ?? 100,
      categories: [...(source.categories || [])],
      selectedProducts: (source.products || []).map((x: any) => x._id ?? x),
      selectedServices: (source.services || []).map((x: any) => x._id ?? x),
    };
    if (this.isConsentForm) this.useCustomEntry = true;
  }

  emptyForm() {
    return {
      name: '', description: '', scope: 'products', customerType: 'cash', type: 'specific_products',
      campaignType: null as string | null,
      // 'consent_request' = ask customers to opt in (no products or discount); the default keeps every promotion as before.
      purpose: 'standard' as 'standard' | 'consent_request',
      discountPercent: 20, pointsPrice: 100, categories: [] as string[],
      selectedProducts: [] as string[], selectedServices: [] as string[], startDate: '', endDate: '', status: 'draft',
      // Separate, additive send-format choice (see waflow-backend's
      // shared/promotionCarousel.js) — default keeps every new promotion
      // behaving exactly as before unless the merchant explicitly opts in.
      sendFormat: 'separate' as 'separate' | 'carousel',
    };
  }

  loadPromotions() {
    this.loading = true;
    this.api.getPromotions().subscribe({
      next: (data) => { this.promotions = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.editingPromoId = null;
    this.viewMode = false;
    this.viewingPromo = null;
    this.form = this.emptyForm();
    this.pickingType = true;
    this.showCreateModal = true;
    this.resetCustomEntry();
  }

  selectCampaignType(ct: typeof CAMPAIGN_TYPES[number]) {
    this.form = { ...this.emptyForm(), ...ct.defaults, campaignType: ct.value, description: ct.suggestedMessage };
    this.pickingType = false;
    // The message IS the promotion for a consent request: its editor is always on (it opens once the promotion exists).
    this.useCustomEntry = this.isConsentForm;
  }

  get isConsentForm(): boolean { return this.form?.purpose === 'consent_request'; }

  // A consent request is told apart by purpose (campaignType is the fallback for rows saved before purpose existed).
  isConsentPromo(p: any): boolean {
    return p?.purpose === 'consent_request' || p?.campaignType === 'consent_request';
  }

  // The Purpose choice beside Message Format. A consent request has no discount or products and is always sent as
  // separate messages (the carousel format cannot carry consent buttons).
  setPurpose(purpose: 'standard' | 'consent_request') {
    if (this.form.purpose === purpose) return;
    this.form.purpose = purpose;
    if (purpose === 'consent_request') {
      this.form.campaignType = 'consent_request';
      this.form.sendFormat = 'separate';
      this.form.scope = 'products';
      this.form.customerType = 'cash';
      this.form.type = 'store_wide';
      this.form.discountPercent = 0;
      this.form.selectedProducts = [];
      this.form.selectedServices = [];
      this.form.categories = [];
      this.useCustomEntry = true;
    } else {
      if (this.form.campaignType === 'consent_request') this.form.campaignType = null;
      if (!this.form.discountPercent) this.form.discountPercent = 20;
      if (!this.existingEntryNode) this.useCustomEntry = false;
    }
  }

  openViewEdit(p: any) {
    this.editingPromoId = p._id;
    this.viewMode = (p.sentCount || 0) > 0;
    this.viewingPromo = p;
    this.pickingType = false;
    this.form = {
      name:             p.name,
      description:      p.description || '',
      scope:            p.scope || 'products',
      customerType:     p.customerType || 'cash',
      type:             p.type || 'specific_products',
      campaignType:     p.campaignType || null,
      purpose:          (this.isConsentPromo(p) ? 'consent_request' : 'standard') as 'standard' | 'consent_request',
      discountPercent:  p.discountPercent ?? 0,
      pointsPrice:      p.pointsPrice ?? 0,
      categories:       [...(p.categories || [])],
      selectedProducts: (p.products  || []).map((x: any) => x._id  ?? x),
      selectedServices: (p.services  || []).map((x: any) => x._id  ?? x),
      startDate:        p.startDate ? p.startDate.slice(0, 10) : '',
      endDate:          p.endDate   ? p.endDate.slice(0, 10)   : '',
      status:           p.status || 'draft',
      // Existing promotions (created before this field existed) come back
      // with sendFormat undefined — default to 'separate', matching the
      // backend schema default, so they keep behaving exactly as before.
      sendFormat:       (p.sendFormat || 'separate') as 'separate' | 'carousel',
    };
    this.showCreateModal = true;
    this.resetCustomEntry();
    this.consentAck = !!p.consentWordingAck?.at; // acknowledged before: counts only for the SAME wording, checked once it is loaded (see loadExistingEntryNode)
    this.consentAckHash = String(p.consentWordingAck?.textHash || '');
    this.consentAckSig = '';
    if (this.isConsentForm) this.useCustomEntry = true;
    // entryNodeId comes back populated ({_id, templateStatus}) from getPromotions/
    // getPromotion so the list view can show template status without a second
    // round-trip — extract the plain id here regardless of which shape it is.
    const entryNodeId = p.entryNodeId?._id || p.entryNodeId;
    if (entryNodeId) {
      this.useCustomEntry = true;
      this.loadExistingEntryNode(entryNodeId).catch((err) => console.error('loadExistingEntryNode failed:', err));
    }
  }

  closeModal() {
    this.showCreateModal = false;
    this.editingPromoId = null;
    this.viewMode = false;
    this.viewingPromo = null;
    this.pickingType = false;
    this.syncTemplatePolling(); // the editor's pending template is no longer on screen
  }

  resetCustomEntry() {
    this.useCustomEntry = false;
    this.existingEntryNode = null;
    this.entryDraft = { bodyText: '', buttons: [] };
    this.editorViewMode = 'flat';
    this.entryError = null;
    this.consentAck = false;
    this.consentAckSig = '';
    this.consentAckHash = '';
    this.issuesCache = null;
  }

  toggleCustomEntry() {
    this.useCustomEntry = !this.useCustomEntry;
    this.entryError = null;
    if (this.useCustomEntry && !this.existingEntryNode) {
      this.entryDraft = { bodyText: '', buttons: [] };
    }
  }

  // DEFECT-06: "duplicate an existing template as a starting point" — since a
  // template here is just a promotion's custom entry message, duplicating one
  // means copying its whole message tree (recursively, including follow-ups)
  // into this draft as *unsaved* content — stripping every targetNodeId so
  // "Save Custom Message" creates fresh MessageNodes rather than re-parenting
  // the source promotion's real ones.
  duplicateFromPromoId: string | null = null;

  get promotionsWithEntryNode(): any[] {
    return this.promotions.filter(p => (p.entryNodeId?._id || p.entryNodeId) && p._id !== this.editingPromoId);
  }

  async duplicateEntryFrom() {
    if (!this.duplicateFromPromoId) return;
    const source = this.promotions.find(p => p._id === this.duplicateFromPromoId);
    const sourceNodeId = source?.entryNodeId?._id || source?.entryNodeId;
    if (!sourceNodeId) return;
    const promoId = this.editingPromoId;
    const { draft } = await this.loadNodeDraftRecursive(sourceNodeId);
    if (this.editingPromoId !== promoId) return; // the editor was closed, or opened for another promotion, while the copy was loading
    // The copy goes into THIS promotion's own message when it already has one: the root keeps its id, so Save updates the message the
    // promotion points at instead of creating a second one that nothing points at. The copied follow-ups are new messages.
    this.entryDraft = { ...this.stripTargetIds(draft), targetNodeId: this.entryDraft.targetNodeId };
    this.duplicateFromPromoId = null;
  }

  private stripTargetIds(draft: MessageNodeDraft): MessageNodeDraft {
    return {
      bodyText: draft.bodyText,
      buttons: draft.buttons.map((b): MessageNodeButtonDraft => ({
        position: b.position,
        label: b.label,
        nextAction: b.nextAction,
        ...(b.replyText !== undefined ? { replyText: b.replyText } : {}),
        followUp: b.followUp ? this.stripTargetIds(b.followUp) : undefined,
      })),
    };
  }

  // Recursively reverse-maps a saved MessageNode (real nextAction.targetNodeId
  // shape) back into the editor's nested draft shape — identical to
  // pages/flows/flows.ts, since MessageNode CRUD is fully ownerType-agnostic.
  async loadExistingEntryNode(nodeId: string) {
    const promoId = this.editingPromoId;
    const node = await this.loadNodeDraftRecursive(nodeId);
    // The editor was closed, or opened for another promotion, while this loaded: this message is not the one on screen.
    if (this.editingPromoId !== promoId) return;
    this.existingEntryNode = node.raw;
    this.entryDraft = node.draft;
    // The saved wording counts as acknowledged only if it IS the wording that was acknowledged: it may have been changed since
    // (another screen, the API), and a tick must never carry over to words the merchant has not confirmed.
    if (this.consentAck && this.consentAckHash && consentWordingHash(this.entryDraft) === this.consentAckHash) this.consentAckSig = consentWordingSignature(this.entryDraft);
    else this.consentAck = false;
    this.syncTemplatePolling();
  }

  private async loadNodeDraftRecursive(nodeId: string): Promise<{ draft: MessageNodeDraft; raw: any }> {
    const raw = await firstValueFrom(this.api.getMessageNode(nodeId));
    const buttons: MessageNodeButtonDraft[] = [];
    for (const b of raw.buttons) {
      const draftButton: MessageNodeButtonDraft = {
        position: b.position, label: b.label, nextAction: b.nextAction.type, targetNodeId: b.nextAction.targetNodeId,
      };
      if (isConsentAction(b.nextAction.type)) draftButton.replyText = b.nextAction.replyText ?? '';
      if (b.nextAction.type === 'send_message' && b.nextAction.targetNodeId) {
        const child = await this.loadNodeDraftRecursive(b.nextAction.targetNodeId);
        draftButton.followUp = child.draft;
      }
      buttons.push(draftButton);
    }
    return { draft: { bodyText: raw.bodyText, buttons, targetNodeId: raw._id }, raw };
  }

  // Walks the whole draft tree (not just the entry node) so "Save" can be
  // disabled with a clear reason instead of surfacing a raw backend
  // validation error after several sequential save requests have already run.
  hasIncompleteButtons(draft: MessageNodeDraft, depth = 0): boolean {
    return draft.buttons.some(b => !b.label?.trim() || b.label.length > labelLimitFor(depth) || (b.nextAction === 'send_message' && b.followUp && this.hasIncompleteButtons(b.followUp, depth + 1)));
  }

  private entrySaveSeq = 0;

  saveCustomEntry() {
    if (!this.editingPromoId) return;
    if (!this.canSaveCustomEntry) return;
    // A message is saved in several requests, and the merchant may close the editor - or open another promotion - while they run. What is
    // DONE (the owner of the new messages, the link, the acknowledgement) goes to the promotion this Save was started for, from what the
    // editor held when the button was pressed; only what is SHOWN is limited to the editor that is still open for it.
    const promoId = this.editingPromoId;
    const stillHere = () => this.editingPromoId === promoId;
    const needsLink = !this.existingEntryNode; // the promotion does not point at this message yet
    const consent = this.isConsentForm;
    // A consent request also records the merchant's acknowledgement of this wording (consentWordingAck) with the save; the server stamps
    // the time and the signed-in person, the fingerprint says which wording was acknowledged.
    const ackHash = consent && this.consentAckValid ? consentWordingHash(this.entryDraft) : null;
    const mine = ++this.entrySaveSeq;
    const finished = () => { if (mine === this.entrySaveSeq) this.savingEntryNode = false; }; // only the newest Save ends the "saving" state
    this.entryError = null;
    this.savingEntryNode = true;
    this.saveNodeDraftRecursive(this.entryDraft, true, 0, promoId).then((node) => {
      // The message itself is saved now, and the server may have reset its template (an approved message that was edited needs approval
      // again). For a message the promotion already points at, take that over at once: if the call below fails, the editor must still
      // tell the truth about the message instead of showing "approved" for words that are not. (A message that is not linked yet stays
      // unset until it is, because that is what makes the next Save link it.)
      if (stillHere() && this.existingEntryNode) { this.existingEntryNode = node; this.syncActivePromoNode(node); this.syncTemplatePolling(); }
      const afterLink = () => {
        finished();
        this.loadPromotions();
        if (!stillHere()) return;
        this.existingEntryNode = node;
        this.syncActivePromoNode(node);
        this.syncTemplatePolling();
      };
      const link: any = {};
      if (needsLink) link.entryNodeId = node._id;
      if (ackHash) link.consentWordingAck = { textHash: ackHash };
      if (!Object.keys(link).length) afterLink();
      else this.api.updatePromotion(promoId, link).subscribe({
        next: () => {
          if (ackHash && stillHere()) this.consentAckHash = ackHash; // what the server now holds as acknowledged
          afterLink();
        },
        error: (err) => { if (stillHere()) this.entryError = this.errMessage(err, 'Failed to save.'); finished(); },
      });
    }).catch((err) => {
      if (stillHere()) this.entryError = this.errMessage(err, 'Failed to save.');
      finished();
    });
  }

  // The server's plain-language reason when it gives one (error / message, possibly nested), else the fallback.
  private errMessage(err: any, fallback: string): string {
    const body = err?.error;
    const pick = (v: any): string | null => {
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object') return pick(v.message) || pick(v.error_user_msg) || pick(v.error) || null;
      return null;
    };
    return pick(body) || pick(err?.message) || fallback;
  }

  // Save Custom Message: the wording needs a body and complete buttons; a consent request additionally needs the
  // merchant's acknowledgement of this wording and no blocking issue found by the guard.
  get canSaveCustomEntry(): boolean {
    if (this.savingEntryNode || !this.entryDraft.bodyText || this.hasIncompleteButtons(this.entryDraft)) return false;
    if (this.isConsentForm) return this.consentAckValid && this.consentErrors.length === 0;
    return true;
  }

  // ── Consent wording guard ──────────────────────────────────────────────────
  get consentIssues(): ConsentWordingIssue[] {
    const sig = consentWordingSignature(this.entryDraft);
    if (!this.issuesCache || this.issuesCache.sig !== sig) this.issuesCache = { sig, issues: checkConsentWording(this.entryDraft) };
    return this.issuesCache.issues;
  }
  get consentErrors(): ConsentWordingIssue[] { return this.consentIssues.filter((i) => i.level === 'error'); }
  get consentWarnings(): ConsentWordingIssue[] { return this.consentIssues.filter((i) => i.level === 'warning'); }

  // The tick counts only for the wording it was given to.
  get consentAckValid(): boolean {
    return this.consentAck && this.consentAckSig === consentWordingSignature(this.entryDraft);
  }

  setConsentAck(checked: boolean) {
    this.consentAck = checked;
    this.consentAckSig = checked ? consentWordingSignature(this.entryDraft) : '';
  }

  useSuggestedBody(key: string) {
    const s = this.bodySuggestions.find((x) => x.key === key);
    if (!s) return;
    this.entryDraft = { ...this.entryDraft, bodyText: s.body };
  }

  // Persists a draft node bottom-up: a button's follow-up is created/updated
  // before the node containing that button, since the button's own
  // nextAction.targetNodeId needs the follow-up's real id. depth is tracked
  // through the recursion (0 = entry) and capped at MAX_BRANCH_DEPTH,
  // matching the server-side cap in shared/operations.js.
  private async saveNodeDraftRecursive(draft: MessageNodeDraft, isEntryNode: boolean, depth: number, promoId: string | null): Promise<any> {
    const buttons = [];
    for (const b of draft.buttons) {
      let targetNodeId: string | undefined;
      if (b.nextAction === 'send_message' && b.followUp && depth < MAX_BRANCH_DEPTH) {
        const savedChild = await this.saveNodeDraftRecursive(b.followUp, false, depth + 1, promoId);
        targetNodeId = savedChild._id;
      }
      // replyText (the confirmation sent after a tap) only exists on the consent actions; empty means "use the standard one".
      const nextAction: any = { type: b.nextAction, targetNodeId };
      if (isConsentAction(b.nextAction)) nextAction.replyText = (b.replyText ?? '').trim();
      buttons.push({ position: b.position, label: b.label, nextAction });
    }

    const payload = { bodyText: draft.bodyText, buttons };
    const saved = draft.targetNodeId
      ? await firstValueFrom(this.api.updateMessageNode(draft.targetNodeId, payload))
      : await firstValueFrom(this.api.createMessageNode({ ownerType: 'promotion', ownerId: promoId, isEntryNode, bodyText: draft.bodyText, buttons, depth }));
    // Remember which node this editor now holds: a second Save in the same open editor must update it, not create another
    // message that the promotion never points at.
    if (saved && saved._id) draft.targetNodeId = saved._id;
    return saved;
  }

  submitEntryTemplate() {
    if (!this.existingEntryNode) return;
    if (this.isConsentForm && !(this.consentAckValid && this.consentErrors.length === 0)) return;
    this.submittingTemplate = true;
    this.entryError = null;
    this.api.submitMessageNodeTemplate(this.existingEntryNode._id).subscribe({
      next: (node) => { this.existingEntryNode = node; this.submittingTemplate = false; this.syncActivePromoNode(node); this.syncTemplatePolling(); },
      // The server says why (a rule of WhatsApp's, a too-long label...): show it instead of failing silently.
      error: (err) => { this.submittingTemplate = false; this.entryError = this.errMessage(err, 'Could not send this message for approval - please try again.'); },
    });
  }

  refreshEntryTemplateStatus() {
    if (!this.existingEntryNode) return;
    this.refreshingStatus = true;
    this.api.refreshMessageNodeTemplateStatus(this.existingEntryNode._id).subscribe({
      next: (node) => { this.refreshingStatus = false; this.applyRefreshedNode(node); },
      error: () => { this.refreshingStatus = false; },
    });
  }

  // ── Template approval: banner states, block-and-notify, polling ────────────
  // The custom entry message of a promotion as the list/panel know it (populated by the server), or null.
  entryNodeOf(p: any): any | null {
    const n = p?.entryNodeId;
    return n && typeof n === 'object' ? n : null;
  }

  templateStatusOf(p: any): string | null {
    return this.entryNodeOf(p)?.templateStatus ?? null;
  }

  // Not submitted yet or with Meta for review: sending is paused either way.
  templateWaiting(p: any): boolean {
    const st = this.templateStatusOf(p);
    return st === 'pending' || st === 'not_created';
  }

  templateRejected(p: any): boolean {
    return this.templateStatusOf(p) === 'rejected';
  }

  // What Meta said, as one sentence. The server stores a sentence ("Facebook (Meta) did not approve this message (CODE)." / "...has
  // paused this message..."); a bare code from an older record is put into one.
  rejectionText(node: any): string {
    const reason = String(node?.templateRejectedReason || '').trim();
    if (!reason) return 'Facebook (Meta) did not approve this message.';
    return /\s/.test(reason) ? reason : `Facebook (Meta) did not approve this message: ${reason}.`;
  }

  // "Your message was approved - you can now send the messages you intended": the server records the intended send
  // (sendRequest) when it blocked one, and raises the notice when the template is approved.
  approvedNotice(p: any): boolean {
    const r = p?.sendRequest;
    if (!r?.approvedNoticeAt || r.dismissedAt) return false;
    const st = this.templateStatusOf(p);
    return !st || st === 'approved';
  }

  // One click: open the campaign panel with the customers of the blocked send already selected.
  reviewAndSend(p: any) {
    const ids: string[] = (p?.sendRequest?.customerIds || []).map((x: any) => String(x?._id ?? x));
    if (this.activePromo?._id !== p._id) this.openCampaign(p);
    ids.forEach((id) => this.selectedCustomerIds.add(id));
  }

  dismissSendRequest(p: any) {
    this.api.dismissSendRequest(p._id).subscribe({
      next: () => {
        const stamp = (x: any) => { if (x && x._id === p._id) x.sendRequest = { ...(x.sendRequest || {}), dismissedAt: new Date().toISOString() }; };
        this.promotions.forEach(stamp);
        stamp(this.activePromo);
        stamp(p);
      },
      error: (err) => this.dialog.error(this.errMessage(err, 'Could not dismiss this notice - please try again.')),
    });
  }

  // Which pending templates are on screen right now: the open promotion's (campaign panel) and the one in the editor.
  private pendingTemplateNodeIds(): string[] {
    const ids = new Set<string>();
    const a = this.entryNodeOf(this.activePromo);
    if (a?.templateStatus === 'pending' && a._id) ids.add(a._id);
    if (this.showCreateModal && this.existingEntryNode?.templateStatus === 'pending' && this.existingEntryNode._id) ids.add(this.existingEntryNode._id);
    return [...ids];
  }

  // Polls ONLY while a pending template is on screen; starts or stops itself whenever that changes.
  syncTemplatePolling() {
    if (!this.pendingTemplateNodeIds().length) { this.stopTemplatePolling(); return; }
    if (this.templatePollTimer !== null) return;
    const seq = this.templatePollSeq;
    this.templatePollTimer = setTimeout(() => { if (seq === this.templatePollSeq) this.pollTemplates(); }, TEMPLATE_POLL_MS);
  }

  private stopTemplatePolling() {
    clearTimeout(this.templatePollTimer);
    this.templatePollTimer = null;
    this.templatePollSeq++;
  }

  private async pollTemplates() {
    this.templatePollTimer = null;
    const ids = this.pendingTemplateNodeIds();
    if (!ids.length) return;
    const seq = this.templatePollSeq;
    await Promise.all(ids.map((id) => firstValueFrom(this.api.refreshMessageNodeTemplateStatus(id)).then(
      (node) => { if (seq === this.templatePollSeq) this.applyRefreshedNode(node, false); },
      () => { /* a failed check is retried on the next round */ },
    )));
    if (seq === this.templatePollSeq) this.syncTemplatePolling();
  }

  // A fresh status for a node: update everything that shows it (editor, campaign panel, list) and, when it just got
  // approved or refused, bring the promotion itself in (the server raises the "approved" notice with it).
  private applyRefreshedNode(node: any, resync = true) {
    if (!node?._id) return;
    const before = this.entryNodeOf(this.activePromo)?.templateStatus ?? this.existingEntryNode?.templateStatus;
    if (this.existingEntryNode?._id === node._id) this.existingEntryNode = node;
    this.syncActivePromoNode(node);
    if (before !== node.templateStatus && (node.templateStatus === 'approved' || node.templateStatus === 'rejected')) {
      this.refreshActivePromo();
      this.loadPromotions();
    }
    if (resync) this.syncTemplatePolling();
  }

  // The panel's promotion keeps the node status the list gave it: mirror a newer one without replacing the object.
  private syncActivePromoNode(node: any) {
    const a = this.entryNodeOf(this.activePromo);
    if (!a || a._id !== node?._id) return;
    this.activePromo.entryNodeId = {
      ...a,
      templateStatus: node.templateStatus,
      templateVersion: node.templateVersion ?? a.templateVersion,
      templateRejectedReason: node.templateRejectedReason ?? (node.templateStatus === 'rejected' ? a.templateRejectedReason : undefined),
      templateApprovedAt: node.templateApprovedAt ?? a.templateApprovedAt,
    };
  }

  // Re-reads the open promotion (status, sendRequest...) into the object the panel already shows.
  private refreshActivePromo() {
    const id = this.activePromo?._id;
    if (!id) return;
    this.api.getPromotion(id).subscribe({
      next: (fresh) => {
        if (this.activePromo?._id !== id || !fresh || typeof fresh !== 'object') return;
        for (const k of ['entryNodeId', 'sendRequest', 'status', 'sentCount', 'purpose', 'consentWordingAck']) {
          if (k in fresh) this.activePromo[k] = fresh[k];
        }
        this.syncTemplatePolling();
      },
      error: () => {},
    });
  }

  // HTTP 409 template_not_approved from a send or a test send: the server has already submitted the message (or knows
  // it is waiting), so show the banner for what it said instead of an error.
  private handleTemplateNotApproved(body: any) {
    this.templateBlock = {
      message: body?.message || 'This message is being sent to Facebook (Meta) for approval - sending is paused until it is approved.',
      submittedNow: !!body?.submittedNow,
      submitFailed: !!body?.reason && !body?.submittedNow, // the server adds `reason` when its own attempt to submit the message failed
    };
    const a = this.entryNodeOf(this.activePromo);
    const rawId = this.activePromo?.entryNodeId;
    if (a || typeof rawId === 'string') {
      const base = a || { _id: rawId };
      const status = body?.submittedNow ? 'pending' : (body?.templateStatus || base.templateStatus);
      this.activePromo.entryNodeId = { ...base, templateStatus: status };
    }
    this.refreshActivePromo();
    this.loadPromotions();
    this.syncTemplatePolling();
  }

  private isTemplateNotApproved(err: any): boolean {
    return err?.status === 409 && err?.error?.error === 'template_not_approved';
  }

  // A custom entry message Meta has not approved yet: the server will not send the promotion until it is (it submits the
  // message for approval itself and tells the merchant), so this shows that state up front, in the list and the panel.
  needsTemplateApproval(p: any): boolean {
    const entryNodeId = p?.entryNodeId;
    if (!entryNodeId) return false;
    const status = entryNodeId?.templateStatus;
    return status !== undefined ? status !== 'approved' : false;
  }

  toggleProduct(id: string) {
    const s: string[] = this.form.selectedProducts;
    this.form.selectedProducts = s.includes(id) ? s.filter((x: string) => x !== id) : [...s, id];
  }

  toggleCategory(cat: string) {
    const c: string[] = this.form.categories;
    this.form.categories = c.includes(cat) ? c.filter((x: string) => x !== cat) : [...c, cat];
  }

  toggleService(id: string) {
    const s: string[] = this.form.selectedServices;
    this.form.selectedServices = s.includes(id) ? s.filter((x: string) => x !== id) : [...s, id];
  }

  isServicePromo(): boolean { return this.form.scope === 'services'; }

  savePromotion() {
    this.saving = true;
    const consent = this.isConsentForm;
    const isService = !consent && this.form.scope === 'services';
    const payload: any = {
      name:            this.form.name,
      description:     this.form.description,
      // A consent request has no products, services or discount: it only asks for permission.
      scope:           consent ? 'products' : this.form.scope,
      customerType:    consent ? 'cash' : this.form.customerType,
      type:            consent ? 'store_wide' : (isService ? 'specific_services' : this.form.type),
      campaignType:    consent ? 'consent_request' : (this.form.campaignType || undefined),
      discountPercent: !consent && this.form.customerType === 'cash' ? +this.form.discountPercent : 0,
      pointsPrice:     !consent && this.form.customerType === 'points' ? +this.form.pointsPrice : 0,
      products:        consent || isService ? [] : this.form.selectedProducts,
      services:        !consent && isService ? this.form.selectedServices : [],
      categories:      consent ? [] : this.form.categories,
      startDate:       this.form.startDate || undefined,
      endDate:         this.form.endDate || undefined,
      status:          this.form.status,
      sendFormat:      consent ? 'separate' : this.form.sendFormat,
    };
    // Only a consent request, or an edit of an existing promotion, names its purpose: creating an ordinary promotion
    // sends exactly what it always sent.
    if (consent || this.editingPromoId) payload.purpose = this.form.purpose;
    const isNew = !this.editingPromoId;
    const req = this.editingPromoId
      ? this.api.updatePromotion(this.editingPromoId, payload)
      : this.api.createPromotion(payload);
    req.subscribe({
      next: (saved) => {
        this.saving = false;
        this.loadPromotions();
        // A new consent request: the message is the whole point of it, and the editor needs a real promotion id, so
        // carry straight on into editing it (instead of closing the form and leaving the merchant to find the editor).
        if (isNew && consent && saved?._id) { this.openViewEdit(saved); return; }
        this.closeModal();
        // An insight CTA ("Create Comeback Campaign" etc.) pre-selected
        // specific customers — apply them the moment the new promotion's
        // Campaign Panel opens, since the create form itself has no
        // customer-selection step.
        if (isNew && this.pendingInsightCustomerIds) {
          const ids = this.pendingInsightCustomerIds;
          this.pendingInsightCustomerIds = null;
          this.openCampaign(saved);
          ids.forEach(id => this.selectedCustomerIds.add(id));
        }
      },
      error: (err) => { this.saving = false; this.dialog.error(err.error?.error || 'Could not save this promotion — please try again.'); },
    });
  }

  async deletePromotion(id: string) {
    const ok = await this.dialog.confirm('Delete this promotion?', { title: 'Delete promotion', confirmLabel: 'Delete', type: 'error' });
    if (!ok) return;
    this.api.deletePromotion(id).subscribe({
      next: () => this.loadPromotions(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not delete this promotion — please try again.'),
    });
  }

  openCampaign(promo: any) {
    this.dropPendingPanelLoads(); // answers for the promotion that was on screen must not land on this one
    this.activePromo = promo;
    this.selectedCustomerIds.clear();
    this.recommendedCustomers = [];
    this.knownCustomers.clear();
    this.recsStale = false;
    this.templateBlock = null;
    this.audienceFilter = this.isConsentPromo(promo) ? 'not_responded' : '';
    this.stopTemplatePolling(); // answers for the previous promotion no longer matter
    this.customerViewMode = 'recommended';
    this.allCustomers = [];
    this.allCustomersPage = 1;
    this.allCustomersSearch = '';
    this.sendResult = null;
    this.campaignReport = null;
    clearTimeout(this.deliveryTimer);
    this.sendSeq++;
    this.delivery = null;
    this.deliveryUnavailable = false;
    this.reportFailures = [];
    this.preview = null;
    this.testResult = null;
    this.loadRecommended(true);
    this.loadPreview();
    if (promo.sentCount > 0) this.loadCampaignReport();
    this.syncTemplatePolling();
  }

  closeCampaign() {
    this.dropPendingPanelLoads();
    this.activePromo = null;
    this.templateBlock = null;
    this.stopTemplatePolling();
  }

  // Every request that fills the campaign panel (customer lists, preview, report) belongs to the promotion that was open when it
  // was asked: once another one is opened, or the panel is closed, an answer still on its way is ignored - it would show the old
  // promotion's customers, message or numbers in the new one - and the spinner it would have ended is ended here.
  private dropPendingPanelLoads() {
    this.allCustomersSeq++; this.recsSeq++; this.previewSeq++; this.reportSeq++;
    this.loadingAllCustomers = false; this.loadingRecs = false; this.loadingPreview = false; this.loadingReport = false;
  }

  loadCampaignReport() {
    const seq = ++this.reportSeq;
    this.loadingReport = true;
    this.api.getCampaignReport(this.activePromo._id).subscribe({
      next: (data) => {
        if (seq !== this.reportSeq) return; // another promotion was opened (or the report asked for again) since
        this.campaignReport = data; this.loadingReport = false;
        if (data?.messagesFailed > 0) this.loadReportFailures(); else this.reportFailures = [];
      },
      error: () => { if (seq === this.reportSeq) this.loadingReport = false; },
    });
  }

  // The reasons behind "N message(s) failed to deliver" (whole promotion), in plain language.
  private loadReportFailures() {
    const id = this.activePromo?._id;
    if (!id) return;
    this.api.getPromotionDelivery(id).subscribe({
      next: (d) => { if (this.activePromo?._id === id) this.reportFailures = d?.failures || []; },
      error: () => {},
    });
  }

  // WhatsApp answering "OK" to a send only means it ACCEPTED the request. Delivery - or a refusal such as "the customer has not
  // written to you in 24 hours" - is reported a moment later, so after a send we look at what actually happened (3 s, 10 s and
  // 25 s after the send came back, while some messages are still waiting) instead of announcing success.
  private scheduleDeliveryCheck(step: number, token: number) {
    const delays = [3000, 7000, 15000];
    if (step >= delays.length) return;
    clearTimeout(this.deliveryTimer);
    this.deliveryTimer = setTimeout(() => this.checkDelivery(step, token), delays[step]);
  }

  private checkDelivery(step: number, token: number) {
    const promoId = this.activePromo?._id;
    if (!promoId || token !== this.sendSeq) return;
    // Elapsed time, not a clock timestamp: the server subtracts it from ITS clock, so a wrong clock on this PC cannot matter.
    const sinceSeconds = Math.ceil((performance.now() - this.sendStartedAt) / 1000) + 5;
    this.api.getPromotionDelivery(promoId, sinceSeconds).subscribe({
      next: (d) => {
        if (this.activePromo?._id !== promoId || token !== this.sendSeq) return;
        this.delivery = d;
        if (d?.waiting > 0 && step < 2) this.scheduleDeliveryCheck(step + 1, token);
        else this.loadCampaignReport(); // settled (or out of checks): bring the report numbers in step
      },
      error: () => { if (this.activePromo?._id === promoId && token === this.sendSeq) this.deliveryUnavailable = true; },
    });
  }

  loadPreview() {
    const seq = ++this.previewSeq;
    this.loadingPreview = true;
    this.previewError = null;
    this.preview = null;
    this.api.previewPromotionMessage(this.activePromo._id).subscribe({
      next: (data) => { if (seq !== this.previewSeq) return; this.preview = data; this.loadingPreview = false; },
      error: (err) => {
        if (seq !== this.previewSeq) return;
        this.loadingPreview = false; this.previewError = err.error?.error || 'Something went wrong loading the preview — please try again.';
      },
    });
  }

  sendTestMessage() {
    if (!this.testPhone.trim()) return;
    this.sendingTest = true;
    this.testResult = null;
    this.api.sendTestMessage(this.activePromo._id, this.testPhone.trim()).subscribe({
      next: () => { this.sendingTest = false; this.testResult = { ok: true }; },
      error: (err) => {
        this.sendingTest = false;
        if (this.isTemplateNotApproved(err)) {
          // Same block as a real send: the server has the message with Meta, say so instead of the raw error code.
          this.testResult = { ok: false, message: err.error?.message || 'This message is being sent to Facebook (Meta) for approval - sending is paused until it is approved.' };
          this.handleTemplateNotApproved(err.error);
          return;
        }
        // the server's sentence when it gives one (consent_request_invalid / whatsapp_number_unavailable carry a `message`), else its error text
        this.testResult = { ok: false, message: err.error?.message || err.error?.error };
      },
    });
  }

  switchCustomerView(mode: 'recommended' | 'all') {
    this.customerViewMode = mode;
    if (mode === 'all' && !this.allCustomers.length) this.loadAllCustomers();
    if (mode === 'recommended' && this.recsStale) { this.recsStale = false; this.loadRecommended(); }
  }

  // Only the newest request of each customer list may fill it: a quick change of the audience filter, the page or the promotion
  // must not let an older, slower answer overwrite the list the person is now looking at (the Customers screen has the same guard).
  private allCustomersSeq = 0;
  private recsSeq = 0;
  private previewSeq = 0; // the same rule for the message preview and the campaign report of the open promotion
  private reportSeq = 0;

  loadAllCustomers() {
    const seq = ++this.allCustomersSeq;
    this.loadingAllCustomers = true;
    // Only the parameters that are set go on the request (an unset one used to travel as the text "undefined").
    const params: any = { isDemo: false, page: this.allCustomersPage, limit: this.allCustomersPageSize };
    if (this.allCustomersSearch) params.search = this.allCustomersSearch;
    if (this.audienceFilter) params.consent = this.audienceFilter;
    this.api.getCustomers(params).subscribe({
      next: (res) => {
        if (seq !== this.allCustomersSeq) return; // superseded by a newer request
        this.allCustomers = res.customers;
        this.allCustomersTotal = res.total;
        this.loadingAllCustomers = false;
        this.remember(res.customers);
      },
      error: () => { if (seq === this.allCustomersSeq) this.loadingAllCustomers = false; },
    });
  }

  // ── Consent audience ───────────────────────────────────────────────────────
  // Narrows both customer lists by consent. Only the visible list is reloaded; the other one reloads when it is opened.
  setAudienceFilter(value: string) {
    const v = (CONSENT_FILTERS as readonly string[]).includes(value) ? (value as AudienceFilter) : '';
    if (v === 'opted_out' && this.isConsentPromo(this.activePromo)) return; // an opted-out customer is never asked again
    this.audienceFilter = v;
    this.allCustomersPage = 1;
    if (this.customerViewMode === 'all') {
      this.recsStale = true;
      this.loadAllCustomers();
    } else {
      this.allCustomers = [];
      this.allCustomersSeq++; this.loadingAllCustomers = false; // a slow answer for the previous filter must not refill the list just emptied
      this.loadRecommended();
    }
  }

  audienceHint(): string {
    const consent = this.isConsentPromo(this.activePromo);
    switch (this.audienceFilter) {
      case 'opted_in':
        return consent
          ? 'These customers have already opted in, so a consent request skips them.'
          : 'These customers have opted in, so they can receive this promotion.';
      case 'not_responded':
        return consent
          ? 'Customers who have not answered yet: the people to ask for permission.'
          : 'These customers have not opted in, so a promotion skips them. Create a Consent request to ask them.';
      case 'opted_out':
        return 'These customers asked to stop receiving messages. They are shown for information only and cannot be selected: no promotion and no consent request will ever be sent to them.';
      default:
        return '';
    }
  }

  private remember(rows: any[] | undefined) {
    for (const c of rows || []) if (c?._id) this.knownCustomers.set(c._id, c);
  }

  // opted_in | opted_out | not_responded, or 'unknown' when the row carries no consent information at all (an older
  // answer): unknown is never blocked here, the server decides.
  consentStatusOf(c: any): 'opted_in' | 'opted_out' | 'not_responded' | 'unknown' {
    if (!c) return 'unknown';
    const s = c.consentStatus;
    if (s === 'opted_in' || s === 'opted_out' || s === 'not_responded') return s;
    if (c.optedOut === true) return 'opted_out';
    if (c.marketingConsent === true) return 'opted_in';
    if (c.marketingConsent === false || 'marketingConsent' in c) return 'not_responded';
    return 'unknown';
  }

  // Whether the server would send THIS promotion to that customer. A standard promotion needs an opt-in (demo
  // customers aside); a consent request goes only to customers who have neither opted in nor out.
  eligibleForPromo(c: any): boolean {
    if (c?.isDemo || this.activePromo?.isDemo) return true;
    const st = this.consentStatusOf(c);
    if (st === 'unknown') return true;
    return this.isConsentPromo(this.activePromo) ? st === 'not_responded' : st === 'opted_in';
  }

  // The little tag on a row the promotion would skip: "No opt-in" for a standard promotion.
  consentRowTag(c: any): { text: string; title: string } | null {
    if (this.eligibleForPromo(c)) return null;
    const st = this.consentStatusOf(c);
    if (this.isConsentPromo(this.activePromo)) {
      return st === 'opted_out'
        ? { text: 'Opted out', title: 'This customer opted out and is never asked again.' }
        : { text: 'Already opted in', title: 'This customer has already opted in, so there is no need to ask again.' };
    }
    return {
      text: 'No opt-in',
      title: st === 'opted_out' ? 'This customer opted out, so promotions are never sent to them.' : 'This customer has not opted in yet, so this promotion would skip them. Create a Consent request to ask them.',
    };
  }

  customerSelectable(c: any): boolean {
    return this.customerCanAfford(c) && this.eligibleForPromo(c);
  }

  // Selected customers (that the lists have shown) the server will skip because they have not opted in.
  get noOptInSelectedCount(): number {
    if (this.isConsentPromo(this.activePromo)) return 0;
    let n = 0;
    for (const id of this.selectedCustomerIds) {
      const c = this.knownCustomers.get(id);
      if (c && !this.eligibleForPromo(c)) n++;
    }
    return n;
  }

  searchAllCustomers() {
    this.allCustomersPage = 1;
    this.loadAllCustomers();
  }

  allCustomersNextPage() {
    if (this.allCustomersPage * this.allCustomersPageSize >= this.allCustomersTotal) return;
    this.allCustomersPage++;
    this.loadAllCustomers();
  }

  allCustomersPrevPage() {
    if (this.allCustomersPage <= 1) return;
    this.allCustomersPage--;
    this.loadAllCustomers();
  }

  allCustomersTotalPages(): number {
    return Math.max(1, Math.ceil(this.allCustomersTotal / this.allCustomersPageSize));
  }

  loadRecommended(applyDefaultTargeting = false) {
    const seq = ++this.recsSeq;
    this.loadingRecs = true;
    this.api.getRecommendedCustomers(this.activePromo._id, this.recommendLimit, this.audienceFilter || undefined).subscribe({
      next: (data) => {
        if (seq !== this.recsSeq) return; // superseded by a newer request
        this.recommendedCustomers = data;
        this.remember(data);
        this.loadingRecs = false;
        if (applyDefaultTargeting) this.applyDefaultTargeting();
      },
      error: () => { if (seq === this.recsSeq) this.loadingRecs = false; },
    });
  }

  // A campaign type like "Win Back Inactive Customers" has an obvious default
  // audience (its whole point is the segment) — pre-select it on first open of
  // a not-yet-sent campaign, so the merchant isn't hand-picking from scratch.
  // Still fully editable — just a starting point, not forced.
  private applyDefaultTargeting() {
    if (!this.activePromo || this.activePromo.sentCount > 0) return;
    const ct = this.campaignTypes.find(c => c.value === this.activePromo.campaignType) as any;
    const segment = ct?.targetSegment;
    if (!segment) return;
    this.recommendedCustomers
      .filter(c => c.segment === segment && this.customerSelectable(c))
      .forEach(c => this.selectedCustomerIds.add(c._id));
  }

  toggleCustomer(c: any) {
    if (!this.customerSelectable(c)) return;
    if (this.selectedCustomerIds.has(c._id)) this.selectedCustomerIds.delete(c._id);
    else this.selectedCustomerIds.add(c._id);
  }

  // "Select All" only applies to whichever list is currently visible — for the
  // All Customers tab that's just the current page, not the whole customer base.
  selectAll() {
    const list = this.customerViewMode === 'all' ? this.allCustomers : this.recommendedCustomers;
    list.filter(c => this.customerSelectable(c)).forEach(c => this.selectedCustomerIds.add(c._id));
  }
  clearAll()  { this.selectedCustomerIds.clear(); }

  async sendCampaign() {
    if (!this.selectedCustomerIds.size) return;
    // The question is today's text word for word; only when some selected customers will be skipped does it say so.
    const skipped = this.noOptInSelectedCount;
    const skipNote = skipped > 0 ? ` ${skipped} of them ${skipped === 1 ? 'has' : 'have'} not opted in and will be skipped.` : '';
    const ok = await this.dialog.confirm(`Send WhatsApp promotion to ${this.selectedCustomerIds.size} customers?${this.langPlan.confirmNote(this.activePromo?._id, this.selectedCustomerIds.size)}${skipNote}`, {
      title: 'Send campaign', confirmLabel: 'Send', type: 'warning',
    });
    if (!ok) return;
    this.sending = true;
    this.sendResult = null;
    this.templateBlock = null;
    this.delivery = null;
    this.deliveryUnavailable = false;
    clearTimeout(this.deliveryTimer);
    this.sendStartedAt = performance.now();
    const promoId = this.activePromo._id;
    const token = ++this.sendSeq;
    this.api.sendPromotion(promoId, [...this.selectedCustomerIds]).subscribe({
      next: (res) => {
        this.sending = false; this.loadPromotions();
        // The merchant opened another promotion (or sent again) while this one was in flight: its answer no longer belongs on screen.
        if (this.activePromo?._id !== promoId || token !== this.sendSeq) return;
        this.sendResult = res; this.loadCampaignReport();
        if (this.activePromo.sendRequest) this.activePromo.sendRequest = undefined; // the intended send has now been made (the server clears it too)
        if (res?.sentCount > 0) this.scheduleDeliveryCheck(0, token);
      },
      error: (err) => {
        this.sending = false;
        if (this.activePromo?._id !== promoId || token !== this.sendSeq) return;
        // Not approved by Meta yet: nothing was sent, the server submitted the message and remembered who it was for.
        if (this.isTemplateNotApproved(err)) { this.handleTemplateNotApproved(err.error); return; }
        this.sendResult = { error: true, message: err.error?.message || err.error?.error };
      },
    });
  }

  sendLoyaltyReminder() {
    this.sendingLoyalty = true;
    this.loyaltyResult = null;
    this.api.sendLoyaltyReminders().subscribe({
      next: (res) => { this.loyaltyResult = res; this.sendingLoyalty = false; },
      error: () => { this.sendingLoyalty = false; },
    });
  }

  isPointsPromo(): boolean {
    return this.activePromo?.customerType === 'points';
  }

  // The tag shown on a preview button that opts customers in/out or records interest ('' for every other button).
  consentActionTag(action: string | undefined): string {
    return isConsentAction(action) ? actionName(action) : '';
  }

  // What the server left out of the send and why (plain language), for the counters it returns.
  skippedLines(res: any): string[] {
    if (!res || res.error) return [];
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const out: string[] = [];
    if (res.skippedNoConsent > 0) out.push(`${plural(res.skippedNoConsent, 'customer was', 'customers were')} skipped because they have not opted in. Create a Consent request to ask them.`);
    if (res.skippedOptedOut > 0) out.push(`${plural(res.skippedOptedOut, 'customer was', 'customers were')} skipped because they opted out.`);
    if (res.skippedAlreadyOptedIn > 0) out.push(`${plural(res.skippedAlreadyOptedIn, 'customer was', 'customers were')} skipped because they have already opted in.`);
    if (res.skippedAskedRecently > 0) out.push(`${plural(res.skippedAskedRecently, 'customer was', 'customers were')} skipped because they were asked recently.`);
    return out;
  }

  // A rate of the consent block of the Campaign Report (a percentage, as the server's conversionRate is), or "-" when absent.
  consentRate(v: any): string {
    return typeof v === 'number' ? `${v}%` : '-';
  }

  // Works for both the Recommended tab (which precomputes hasEnoughPoints) and
  // the All Customers tab (plain customer records, no precomputed field).
  customerCanAfford(c: any): boolean {
    if (!this.isPointsPromo()) return true;
    if (c.hasEnoughPoints !== undefined) return c.hasEnoughPoints;
    return (c.loyaltyPoints || 0) >= (this.activePromo?.pointsPrice || 0);
  }


  segmentColor(segment: string): string {
    const map: any = {
      'High-value customers':        '#10b981',
      'Best customers to target':    '#3b82f6',
      'Customers likely to return':  '#f59e0b',
      'Inactive customers':          '#94a3b8',
    };
    return map[segment] ?? '#94a3b8';
  }
}
