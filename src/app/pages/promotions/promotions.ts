import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';

@Component({
  selector: 'app-promotions',
  imports: [CommonModule, FormsModule, AppCurrencyPipe],
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
    this.showCreateModal = true;
  }

  openViewEdit(p: any) {
    this.editingPromoId = p._id;
    this.viewMode = (p.sentCount || 0) > 0;
    this.viewingPromo = p;
    this.form = {
      name:             p.name,
      description:      p.description || '',
      scope:            p.scope || 'products',
      customerType:     p.customerType || 'cash',
      type:             p.type || 'specific_products',
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
    this.loadRecommended();
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

  loadRecommended() {
    this.loadingRecs = true;
    this.api.getRecommendedCustomers(this.activePromo._id, this.recommendLimit).subscribe({
      next: (data) => { this.recommendedCustomers = data; this.loadingRecs = false; },
      error: () => { this.loadingRecs = false; },
    });
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

  statusBadge(status: string): string {
    const map: any = { active: 'badge-success', draft: 'badge-neutral', expired: 'badge-danger' };
    return map[status] ?? 'badge-neutral';
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
