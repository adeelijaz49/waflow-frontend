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
  }

  emptyForm() {
    return {
      name: '', description: '', type: 'specific_products',
      discountPercent: 20, categories: [] as string[],
      selectedProducts: [] as string[], startDate: '', endDate: '', status: 'draft',
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
    const idx = this.form.selectedProducts.indexOf(id);
    if (idx >= 0) this.form.selectedProducts.splice(idx, 1);
    else this.form.selectedProducts.push(id);
  }

  toggleCategory(cat: string) {
    const idx = this.form.categories.indexOf(cat);
    if (idx >= 0) this.form.categories.splice(idx, 1);
    else this.form.categories.push(cat);
  }

  savePromotion() {
    this.saving = true;
    const payload = {
      name: this.form.name,
      description: this.form.description,
      type: this.form.type,
      discountPercent: +this.form.discountPercent,
      products: this.form.selectedProducts,
      categories: this.form.categories,
      startDate: this.form.startDate || undefined,
      endDate: this.form.endDate || undefined,
      status: this.form.status,
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

  toggleCustomer(id: string) {
    if (this.selectedCustomerIds.has(id)) this.selectedCustomerIds.delete(id);
    else this.selectedCustomerIds.add(id);
  }

  selectAll() { this.recommendedCustomers.forEach(c => this.selectedCustomerIds.add(c._id)); }
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
