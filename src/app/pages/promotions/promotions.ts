import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { MessageNodeEditor, MessageNodeDraft, MessageNodeButtonDraft } from '../../shared/message-node-editor/message-node-editor';
import { ConversationFlowViewer } from '../../shared/conversation-flow-viewer/conversation-flow-viewer';

const MAX_BRANCH_DEPTH = 3; // mirrors shared/operations.js#MAX_BRANCH_DEPTH

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
];

@Component({
  selector: 'app-promotions',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, StatusBadgePipe, MessageNodeEditor, ConversationFlowViewer],
  templateUrl: './promotions.html',
  styleUrl: './promotions.css',
})
export class Promotions implements OnInit {
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

  // Campaign panel
  activePromo: any = null;
  recommendedCustomers: any[] = [];
  selectedCustomerIds = new Set<string>();
  recommendLimit = 100;
  loadingRecs = false;

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
  preview: any = null;
  loadingPreview = false;
  testPhone = '';
  sendingTest = false;
  testResult: any = null;

  // Loyalty reminder
  showLoyaltyModal = false;
  sendingLoyalty = false;
  loyaltyResult: any = null;

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit() {
    this.loadPromotions();
    this.api.getProductCategories().subscribe(cats => this.categories = cats);
    this.api.getProducts({ limit: 500 }).subscribe(res => this.allProducts = res.products);
    this.api.getServices().subscribe(svcs => this.allServices = svcs);
    if (this.route.snapshot.queryParamMap.get('openLoyalty') === 'true') this.showLoyaltyModal = true;
  }

  emptyForm() {
    return {
      name: '', description: '', scope: 'products', customerType: 'cash', type: 'specific_products',
      campaignType: null as string | null,
      discountPercent: 20, pointsPrice: 100, categories: [] as string[],
      selectedProducts: [] as string[], selectedServices: [] as string[], startDate: '', endDate: '', status: 'draft',
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
      discountPercent:  p.discountPercent ?? 0,
      pointsPrice:      p.pointsPrice ?? 0,
      categories:       [...(p.categories || [])],
      selectedProducts: (p.products  || []).map((x: any) => x._id  ?? x),
      selectedServices: (p.services  || []).map((x: any) => x._id  ?? x),
      startDate:        p.startDate ? p.startDate.slice(0, 10) : '',
      endDate:          p.endDate   ? p.endDate.slice(0, 10)   : '',
      status:           p.status || 'draft',
    };
    this.showCreateModal = true;
    this.resetCustomEntry();
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
  }

  resetCustomEntry() {
    this.useCustomEntry = false;
    this.existingEntryNode = null;
    this.entryDraft = { bodyText: '', buttons: [] };
    this.editorViewMode = 'flat';
    this.entryError = null;
  }

  toggleCustomEntry() {
    this.useCustomEntry = !this.useCustomEntry;
    this.entryError = null;
    if (this.useCustomEntry && !this.existingEntryNode) {
      this.entryDraft = { bodyText: '', buttons: [] };
    }
  }

  // Recursively reverse-maps a saved MessageNode (real nextAction.targetNodeId
  // shape) back into the editor's nested draft shape — identical to
  // pages/flows/flows.ts, since MessageNode CRUD is fully ownerType-agnostic.
  async loadExistingEntryNode(nodeId: string) {
    const node = await this.loadNodeDraftRecursive(nodeId);
    this.existingEntryNode = node.raw;
    this.entryDraft = node.draft;
  }

  private async loadNodeDraftRecursive(nodeId: string): Promise<{ draft: MessageNodeDraft; raw: any }> {
    const raw = await firstValueFrom(this.api.getMessageNode(nodeId));
    const buttons: MessageNodeButtonDraft[] = [];
    for (const b of raw.buttons) {
      const draftButton: MessageNodeButtonDraft = {
        position: b.position, label: b.label, nextAction: b.nextAction.type, targetNodeId: b.nextAction.targetNodeId,
      };
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
  hasIncompleteButtons(draft: MessageNodeDraft): boolean {
    return draft.buttons.some(b => !b.label?.trim() || (b.nextAction === 'send_message' && b.followUp && this.hasIncompleteButtons(b.followUp)));
  }

  saveCustomEntry() {
    if (!this.editingPromoId) return;
    this.entryError = null;
    this.savingEntryNode = true;
    this.saveNodeDraftRecursive(this.entryDraft, true, 0).then((node) => {
      const afterLink = () => { this.existingEntryNode = node; this.savingEntryNode = false; this.loadPromotions(); };
      if (this.existingEntryNode) afterLink();
      else this.api.updatePromotion(this.editingPromoId!, { entryNodeId: node._id }).subscribe({
        next: afterLink,
        error: (err) => { this.entryError = err.error?.error || 'Failed to save.'; this.savingEntryNode = false; },
      });
    }).catch((err) => {
      this.entryError = err.error?.error || err.message || 'Failed to save.';
      this.savingEntryNode = false;
    });
  }

  // Persists a draft node bottom-up: a button's follow-up is created/updated
  // before the node containing that button, since the button's own
  // nextAction.targetNodeId needs the follow-up's real id. depth is tracked
  // through the recursion (0 = entry) and capped at MAX_BRANCH_DEPTH,
  // matching the server-side cap in shared/operations.js.
  private async saveNodeDraftRecursive(draft: MessageNodeDraft, isEntryNode: boolean, depth: number): Promise<any> {
    const buttons = [];
    for (const b of draft.buttons) {
      let targetNodeId: string | undefined;
      if (b.nextAction === 'send_message' && b.followUp && depth < MAX_BRANCH_DEPTH) {
        const savedChild = await this.saveNodeDraftRecursive(b.followUp, false, depth + 1);
        targetNodeId = savedChild._id;
      }
      buttons.push({ position: b.position, label: b.label, nextAction: { type: b.nextAction, targetNodeId } });
    }

    const payload = { bodyText: draft.bodyText, buttons };
    if (draft.targetNodeId) {
      return firstValueFrom(this.api.updateMessageNode(draft.targetNodeId, payload));
    }
    return firstValueFrom(this.api.createMessageNode({ ownerType: 'promotion', ownerId: this.editingPromoId, isEntryNode, bodyText: draft.bodyText, buttons, depth }));
  }

  submitEntryTemplate() {
    if (!this.existingEntryNode) return;
    this.submittingTemplate = true;
    this.api.submitMessageNodeTemplate(this.existingEntryNode._id).subscribe({
      next: (node) => { this.existingEntryNode = node; this.submittingTemplate = false; },
      error: () => { this.submittingTemplate = false; },
    });
  }

  refreshEntryTemplateStatus() {
    if (!this.existingEntryNode) return;
    this.refreshingStatus = true;
    this.api.refreshMessageNodeTemplateStatus(this.existingEntryNode._id).subscribe({
      next: (node) => { this.existingEntryNode = node; this.refreshingStatus = false; },
      error: () => { this.refreshingStatus = false; },
    });
  }

  // Mirrors the backend's graceful fallback (shared/operations.js#resolveApprovedEntryNode)
  // client-side, so the merchant sees this state up front rather than discovering
  // it only after sending — an unapproved custom entry never blocks the send
  // outright (Promotions have no separate "activate" gate, per DEFECT-04A), it
  // just silently falls back, which is worth surfacing rather than leaving silent.
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
    const isService = this.form.scope === 'services';
    const payload = {
      name:            this.form.name,
      description:     this.form.description,
      scope:           this.form.scope,
      customerType:    this.form.customerType,
      type:            isService ? 'specific_services' : this.form.type,
      campaignType:    this.form.campaignType || undefined,
      discountPercent: this.form.customerType === 'cash' ? +this.form.discountPercent : 0,
      pointsPrice:     this.form.customerType === 'points' ? +this.form.pointsPrice : 0,
      products:        isService ? [] : this.form.selectedProducts,
      services:        isService ? this.form.selectedServices : [],
      categories:      this.form.categories,
      startDate:       this.form.startDate || undefined,
      endDate:         this.form.endDate || undefined,
      status:          this.form.status,
    };
    const req = this.editingPromoId
      ? this.api.updatePromotion(this.editingPromoId, payload)
      : this.api.createPromotion(payload);
    req.subscribe({
      next: () => { this.closeModal(); this.saving = false; this.loadPromotions(); },
      error: () => { this.saving = false; },
    });
  }

  deletePromotion(id: string) {
    if (!confirm('Delete this promotion?')) return;
    this.api.deletePromotion(id).subscribe(() => this.loadPromotions());
  }

  openCampaign(promo: any) {
    this.activePromo = promo;
    this.selectedCustomerIds.clear();
    this.recommendedCustomers = [];
    this.customerViewMode = 'recommended';
    this.allCustomers = [];
    this.allCustomersPage = 1;
    this.allCustomersSearch = '';
    this.sendResult = null;
    this.campaignReport = null;
    this.preview = null;
    this.testResult = null;
    this.loadRecommended(true);
    this.loadPreview();
    if (promo.sentCount > 0) this.loadCampaignReport();
  }

  loadCampaignReport() {
    this.loadingReport = true;
    this.api.getCampaignReport(this.activePromo._id).subscribe({
      next: (data) => { this.campaignReport = data; this.loadingReport = false; },
      error: () => { this.loadingReport = false; },
    });
  }

  loadPreview() {
    this.loadingPreview = true;
    this.api.previewPromotionMessage(this.activePromo._id).subscribe({
      next: (data) => { this.preview = data; this.loadingPreview = false; },
      error: () => { this.loadingPreview = false; },
    });
  }

  sendTestMessage() {
    if (!this.testPhone.trim()) return;
    this.sendingTest = true;
    this.testResult = null;
    this.api.sendTestMessage(this.activePromo._id, this.testPhone.trim()).subscribe({
      next: () => { this.sendingTest = false; this.testResult = { ok: true }; },
      error: () => { this.sendingTest = false; this.testResult = { ok: false }; },
    });
  }

  switchCustomerView(mode: 'recommended' | 'all') {
    this.customerViewMode = mode;
    if (mode === 'all' && !this.allCustomers.length) this.loadAllCustomers();
  }

  loadAllCustomers() {
    this.loadingAllCustomers = true;
    this.api.getCustomers({ search: this.allCustomersSearch || undefined, isDemo: false, page: this.allCustomersPage, limit: this.allCustomersPageSize }).subscribe({
      next: (res) => {
        this.allCustomers = res.customers;
        this.allCustomersTotal = res.total;
        this.loadingAllCustomers = false;
      },
      error: () => { this.loadingAllCustomers = false; },
    });
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
    this.loadingRecs = true;
    this.api.getRecommendedCustomers(this.activePromo._id, this.recommendLimit).subscribe({
      next: (data) => {
        this.recommendedCustomers = data;
        this.loadingRecs = false;
        if (applyDefaultTargeting) this.applyDefaultTargeting();
      },
      error: () => { this.loadingRecs = false; },
    });
  }

  // A campaign type like "Win Back Inactive Customers" has an obvious default
  // audience (its whole point is the segment) — pre-select it on first open of
  // a not-yet-sent campaign, so the merchant isn't hand-picking from scratch.
  // Still fully editable — just a starting point, not forced.
  private applyDefaultTargeting() {
    if (this.activePromo.sentCount > 0) return;
    const ct = this.campaignTypes.find(c => c.value === this.activePromo.campaignType) as any;
    const segment = ct?.targetSegment;
    if (!segment) return;
    this.recommendedCustomers
      .filter(c => c.segment === segment && this.customerCanAfford(c))
      .forEach(c => this.selectedCustomerIds.add(c._id));
  }

  toggleCustomer(c: any) {
    if (!this.customerCanAfford(c)) return;
    if (this.selectedCustomerIds.has(c._id)) this.selectedCustomerIds.delete(c._id);
    else this.selectedCustomerIds.add(c._id);
  }

  // "Select All" only applies to whichever list is currently visible — for the
  // All Customers tab that's just the current page, not the whole customer base.
  selectAll() {
    const list = this.customerViewMode === 'all' ? this.allCustomers : this.recommendedCustomers;
    list.filter(c => this.customerCanAfford(c)).forEach(c => this.selectedCustomerIds.add(c._id));
  }
  clearAll()  { this.selectedCustomerIds.clear(); }

  sendCampaign() {
    if (!this.selectedCustomerIds.size) return;
    if (!confirm(`Send WhatsApp promotion to ${this.selectedCustomerIds.size} customers?`)) return;
    this.sending = true;
    this.sendResult = null;
    this.api.sendPromotion(this.activePromo._id, [...this.selectedCustomerIds]).subscribe({
      next: (res) => { this.sendResult = res; this.sending = false; this.loadPromotions(); this.loadCampaignReport(); },
      error: () => { this.sending = false; this.sendResult = { error: true }; },
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
