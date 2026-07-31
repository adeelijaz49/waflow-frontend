import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';

// Orchestrates the existing send/report endpoints — no simulation, no new
// backend logic. A real WhatsApp send to a real (isDemo:true) phone, then
// polling the same campaign report the Promotions page already uses.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 10 * 60 * 1000;

@Component({
  selector: 'app-demo',
  imports: [CommonModule, RouterLink, AppCurrencyPipe],
  templateUrl: './demo.html',
  styleUrl: './demo.css',
})
export class Demo implements OnInit, OnDestroy {
  // CHANGE-01: reflects the full, correct workflow a merchant would actually
  // follow — template and flow setup happen before a promotion is ever picked.
  step: 'template' | 'flow' | 'promotion' | 'customers' | 'funnel' = 'template';
  loading = false;

  templates: any[] = [];
  loadingTemplates = false;
  creatingTemplates = false;
  readonly FIXED_TEMPLATE_ROUTES = [
    { role: 'promo', route: 'create-promo-template' },
    { role: 'loyalty', route: 'create-loyalty-template' },
    { role: 'winback', route: 'create-winback-template' },
    { role: 'post_purchase', route: 'create-post-purchase-template' },
    { role: 'points_nudge', route: 'create-points-nudge-template' },
    { role: 'no_show', route: 'create-no-show-template' },
  ];

  flows: any[] = [];
  loadingFlows = false;

  demoPromotions: any[] = [];
  demoCustomers: any[] = [];
  fallbackProducts: any[] = [];

  selectedPromotion: any = null;
  selectedCustomerIds = new Set<string>();

  preview: any = null;
  loadingPreview = false;

  sending = false;
  sendResult: any = null;

  report: any = null;
  polling = false;
  private pollHandle: any = null;
  private pollStartedAt = 0;

  constructor(private api: ApiService) {}

  ngOnInit() { this.loadTemplates(); this.loadFlows(); this.loadDemoData(); }
  ngOnDestroy() { this.stopPolling(); }

  // ── Step 0: Create Template ────────────────────────────────────────────────
  loadTemplates() {
    this.loadingTemplates = true;
    this.api.getTemplates().subscribe({
      next: (res) => { this.templates = res.templates; this.loadingTemplates = false; },
      error: () => { this.loadingTemplates = false; },
    });
  }

  get missingFixedTemplates() {
    const presentRoles = new Set(this.templates.map(t => t.waflowRole).filter(Boolean));
    return this.FIXED_TEMPLATE_ROUTES.filter(t => !presentRoles.has(t.role));
  }

  createMissingTemplates() {
    this.creatingTemplates = true;
    const toCreate = this.missingFixedTemplates;
    let remaining = toCreate.length;
    if (!remaining) { this.creatingTemplates = false; return; }
    toCreate.forEach(t => {
      this.api.createFixedTemplate(t.route).subscribe({
        next: () => { remaining--; if (remaining === 0) { this.creatingTemplates = false; this.loadTemplates(); } },
        error: () => { remaining--; if (remaining === 0) { this.creatingTemplates = false; this.loadTemplates(); } },
      });
    });
  }

  goToFlowStep() { this.step = 'flow'; }

  // ── Step 1: Automate Flow ──────────────────────────────────────────────────
  loadFlows() {
    this.loadingFlows = true;
    this.api.getFlows().subscribe({
      next: (data) => { this.flows = data; this.loadingFlows = false; },
      error: () => { this.loadingFlows = false; },
    });
  }

  goToPromotionStep() { this.step = 'promotion'; }

  loadDemoData() {
    this.loading = true;
    this.api.getPromotions({ isDemo: true }).subscribe({
      next: (data) => { this.demoPromotions = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
    this.api.getCustomers({ isDemo: true, limit: 50 }).subscribe({
      next: (res) => { this.demoCustomers = res.customers; },
      error: () => {},
    });
    // Store-wide promotions carry no specific products/services — this fills in a
    // real representative item for the flow preview instead of showing a blank one.
    this.api.getProducts({ limit: 5 }).subscribe({
      next: (res) => { this.fallbackProducts = res.products; },
      error: () => {},
    });
  }

  pickPromotion(p: any) {
    this.selectedPromotion = p;
    this.selectedCustomerIds.clear();
    this.step = 'customers';
    this.loadPreview();
  }

  changePromotion() {
    this.step = 'promotion';
    this.preview = null;
  }

  backToFlow() { this.step = 'flow'; }
  backToTemplate() { this.step = 'template'; }

  loadPreview() {
    this.loadingPreview = true;
    this.api.previewPromotionMessage(this.selectedPromotion._id).subscribe({
      next: (data) => { this.preview = data; this.loadingPreview = false; },
      error: () => { this.loadingPreview = false; },
    });
  }

  // The rest of the conversation past the first message is never sent for
  // real here — the presenter walks through this exact flow live on the
  // phone instead. This is a mocked illustration of it (product vs. service,
  // cash vs. points) so it can be shown up front, scrollable, in one place.
  readonly fakeSlotLabel = 'Tomorrow, 10:00 AM';

  get isServicePromo(): boolean { return this.selectedPromotion?.scope === 'services'; }
  get isPointsPromo(): boolean { return this.selectedPromotion?.customerType === 'points'; }
  get firstProduct(): any { return this.selectedPromotion?.products?.[0] || this.fallbackProducts?.[0]; }
  get firstService(): any { return this.selectedPromotion?.services?.[0]; }

  get discountedPrice(): number {
    const p = this.firstProduct;
    if (!p) return 0;
    return +(p.basePrice * (1 - (this.selectedPromotion.discountPercent || 0) / 100)).toFixed(2);
  }

  toggleCustomer(c: any) {
    if (this.selectedCustomerIds.has(c._id)) this.selectedCustomerIds.delete(c._id);
    else this.selectedCustomerIds.add(c._id);
  }

  get selectedCustomers(): any[] {
    return this.demoCustomers.filter(c => this.selectedCustomerIds.has(c._id));
  }

  sendNow() {
    if (!this.selectedCustomerIds.size) return;
    const phones = this.selectedCustomers.map(c => c.phone).join(', ');
    if (!confirm(`Send a REAL WhatsApp message right now to: ${phones}?\n\nThis is not a simulation.`)) return;
    this.sending = true;
    this.sendResult = null;
    this.api.sendLiveDemoPromotion(this.selectedPromotion._id, [...this.selectedCustomerIds]).subscribe({
      next: (res) => {
        this.sendResult = res;
        this.sending = false;
        this.step = 'funnel';
        this.startPolling();
      },
      error: () => { this.sending = false; this.sendResult = { error: true }; },
    });
  }

  startPolling() {
    this.polling = true;
    this.pollStartedAt = Date.now();
    this.pollReport();
    this.pollHandle = setInterval(() => this.pollReport(), POLL_INTERVAL_MS);
  }

  private pollReport() {
    if (Date.now() - this.pollStartedAt > POLL_MAX_MS) { this.stopPolling(); return; }
    this.api.getCampaignReport(this.selectedPromotion._id).subscribe({
      next: (data) => { this.report = data; },
      error: () => {},
    });
  }

  stopPolling() {
    this.polling = false;
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
  }

  resetDemo() {
    this.stopPolling();
    this.step = 'template';
    this.selectedPromotion = null;
    this.selectedCustomerIds.clear();
    this.preview = null;
    this.sendResult = null;
    this.report = null;
    this.loadTemplates();
    this.loadFlows();
    this.loadDemoData();
  }
}
