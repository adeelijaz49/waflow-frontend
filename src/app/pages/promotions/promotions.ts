import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';

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
  imports: [CommonModule, FormsModule, AppCurrencyPipe, StatusBadgePipe],
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

  // Campaign panel
  activePromo: any = null;
  recommendedCustomers: any[] = [];
  selectedCustomerIds = new Set<string>();
  recommendLimit = 100;
  loadingRecs = false;
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

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadPromotions();
    this.api.getProductCategories().subscribe(cats => this.categories = cats);
    this.api.getProducts({ limit: 500 }).subscribe(res => this.allProducts = res.products);
    this.api.getServices().subscribe(svcs => this.allServices = svcs);
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
  }

  closeModal() {
    this.showCreateModal = false;
    this.editingPromoId = null;
    this.viewMode = false;
    this.viewingPromo = null;
    this.pickingType = false;
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

  selectAll() { this.recommendedCustomers.filter(c => this.customerCanAfford(c)).forEach(c => this.selectedCustomerIds.add(c._id)); }
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

  customerCanAfford(c: any): boolean {
    if (!this.isPointsPromo()) return true;
    return c.hasEnoughPoints !== false;
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
