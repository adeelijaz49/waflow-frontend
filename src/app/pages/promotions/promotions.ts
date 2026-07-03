import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-promotions',
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './promotions.html',
  styleUrl: './promotions.css',
})
export class Promotions implements OnInit {
  promotions: any[] = [];
  categories: string[] = [];
  allProducts: any[] = [];
  allServices: any[] = [];
  loading = false;

  // Create form
  showCreateModal = false;
  saving = false;
  form: any = this.emptyForm();

  // Campaign panel
  activePromo: any = null;
  recommendedCustomers: any[] = [];
  selectedCustomerIds = new Set<string>();
  recommendLimit = 100;
  loadingRecs = false;
  sending = false;
  sendResult: any = null;

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
    this.form = this.emptyForm();
    this.showCreateModal = true;
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
    this.api.createPromotion(payload).subscribe({
      next: () => { this.showCreateModal = false; this.saving = false; this.loadPromotions(); },
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
    this.loadRecommended();
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
      next: (res) => { this.sendResult = res; this.sending = false; this.loadPromotions(); },
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

  rfmColor(score: number): string {
    if (score >= 70) return '#10b981';
    if (score >= 40) return '#f59e0b';
    return '#94a3b8';
  }
}
