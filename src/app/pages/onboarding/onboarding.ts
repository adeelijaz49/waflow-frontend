import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';

// Guided promotion templates — a trimmed copy of promotions.ts's CAMPAIGN_TYPES
// (kept separate on purpose: this wizard is a distinct build from the regular
// Promotions page and from Demo Mode, even though the underlying data shape
// is the same). Store-wide/points types work with zero products on hand yet,
// which matters here since Step 1 is skippable.
const PROMO_TEMPLATES = [
  { value: 'product_promotion', icon: '🛍️', label: 'Product Promotion', blurb: 'Discount on specific products or a category.',
    defaults: { scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: 20 },
    suggestedMessage: 'Check out our latest offer — handpicked products at a special price, just for you!' },
  { value: 'loyalty_reminder', icon: '💎', label: 'Loyalty Points Campaign', blurb: 'Encourage points customers to redeem their balance.',
    defaults: { scope: 'products', customerType: 'points', type: 'store_wide', pointsPrice: 100 },
    suggestedMessage: "You've earned it! Redeem your loyalty points on these items before they're gone." },
  { value: 'store_wide_offer', icon: '🏪', label: 'Store-Wide Offer', blurb: 'One broad discount across everything, for everyone.',
    defaults: { scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: 15 },
    suggestedMessage: "Everything's on sale! Don't miss this store-wide offer." },
];

const FLOW_TRIGGER_TYPES = [
  { value: 'inactive_customer', label: 'Win back inactive customers' },
  { value: 'post_purchase_points', label: 'Thank customers after purchase' },
  { value: 'points_balance_reminder', label: 'Remind customers of their points' },
  { value: 'booking_no_show', label: 'Follow up after a missed booking' },
];

@Component({
  selector: 'app-onboarding',
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
})
export class Onboarding implements OnInit {
  step = 1;
  saving = false;
  error: string | null = null;

  // Step 1 — Products / Services
  itemType: 'product' | 'service' = 'product';
  productForm = { name: '', category: '', basePrice: null as number | null };
  serviceForm = { name: '' };
  addedItems: { type: 'product' | 'service'; name: string }[] = [];

  // Step 2 — Customers
  customerTab: 'manual' | 'import' = 'manual';
  customerForm = { name: '', phone: '' };
  addedCustomers: { name: string; phone: string }[] = [];

  // Step 3 — Promotion
  promoTemplates = PROMO_TEMPLATES;
  showCustomPromo = false;
  customPromoForm = { name: '', discountPercent: 15 };
  createdPromotion: any = null;

  // Step 4 — Automation
  presets: any[] = [];
  loadingPresets = false;
  showCustomFlow = false;
  flowTriggerTypes = FLOW_TRIGGER_TYPES;
  customFlowForm = { name: '', triggerType: 'inactive_customer' };
  createdFlow: any = null;

  constructor(private api: ApiService, public auth: AuthService, private router: Router) {}

  ngOnInit() {
    this.step = this.auth.sessionSnapshot?.workspace?.onboarding?.currentStep || 1;
    if (this.step === 4) this.loadPresets();
  }

  // ── Step 1 ─────────────────────────────────────────────────────────────
  get canAddItem(): boolean {
    if (this.itemType === 'product') return !!(this.productForm.name.trim() && this.productForm.category.trim() && this.productForm.basePrice);
    return !!this.serviceForm.name.trim();
  }

  addItem() {
    if (!this.canAddItem || this.saving) return;
    this.saving = true;
    this.error = null;
    if (this.itemType === 'product') {
      this.api.createProduct({ ...this.productForm, basePrice: +this.productForm.basePrice! }).subscribe({
        next: () => {
          this.addedItems.push({ type: 'product', name: this.productForm.name });
          this.productForm = { name: '', category: '', basePrice: null };
          this.saving = false;
        },
        error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
      });
    } else {
      this.api.createService({ ...this.serviceForm }).subscribe({
        next: () => {
          this.addedItems.push({ type: 'service', name: this.serviceForm.name });
          this.serviceForm = { name: '' };
          this.saving = false;
        },
        error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
      });
    }
  }

  // ── Step 2 ─────────────────────────────────────────────────────────────
  get canAddCustomer(): boolean {
    return !!(this.customerForm.name.trim() && this.customerForm.phone.trim());
  }

  addCustomer() {
    if (!this.canAddCustomer || this.saving) return;
    this.saving = true;
    this.error = null;
    const parts = this.customerForm.name.trim().split(/\s+/);
    const firstname = parts[0];
    const lastname = parts.slice(1).join(' ') || parts[0];
    this.api.createCustomer({ firstname, lastname, phone: this.customerForm.phone.trim() }).subscribe({
      next: () => {
        this.addedCustomers.push({ name: this.customerForm.name, phone: this.customerForm.phone });
        this.customerForm = { name: '', phone: '' };
        this.saving = false;
      },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
    });
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────
  applyPromoTemplate(t: typeof PROMO_TEMPLATES[number]) {
    if (this.saving) return;
    this.saving = true;
    this.error = null;
    this.api.createPromotion({ name: t.label, description: t.suggestedMessage, ...t.defaults }).subscribe({
      next: (res) => { this.createdPromotion = res; this.saving = false; },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
    });
  }

  createCustomPromo() {
    const name = this.customPromoForm.name.trim();
    if (!name || this.saving) return;
    this.saving = true;
    this.error = null;
    this.api.createPromotion({ name, scope: 'products', customerType: 'cash', type: 'store_wide', discountPercent: +this.customPromoForm.discountPercent }).subscribe({
      next: (res) => { this.createdPromotion = res; this.saving = false; this.showCustomPromo = false; },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
    });
  }

  // ── Step 4 ─────────────────────────────────────────────────────────────
  loadPresets() {
    this.loadingPresets = true;
    this.api.getFlowPresets().subscribe({
      next: (data) => {
        // Presets referencing a Promotion-only trigger type only make sense
        // once a promotion actually exists to attach to (see PROMOTION_ONLY_
        // TRIGGER_TYPES in shared/operations.js) — hide those here rather than
        // let a one-click "Apply" fail with a confusing error mid-wizard.
        this.presets = data.filter(p => p.buildable && (p.flowConfig?.triggerType !== 'points_threshold' || this.createdPromotion));
        this.loadingPresets = false;
      },
      error: () => { this.loadingPresets = false; },
    });
  }

  applyFlowPreset(preset: any) {
    if (this.saving) return;
    this.saving = true;
    this.error = null;
    this.api.createFlow({
      name: preset.action, triggerType: preset.flowConfig.triggerType,
      inactivityDays: preset.flowConfig.inactivityDays, pointsThreshold: preset.flowConfig.pointsThreshold,
      promotionId: preset.flowConfig.triggerType === 'points_threshold' ? this.createdPromotion?._id : undefined,
    }).subscribe({
      next: (res) => { this.createdFlow = res; this.saving = false; },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
    });
  }

  createCustomFlow() {
    const name = this.customFlowForm.name.trim();
    if (!name || this.saving) return;
    this.saving = true;
    this.error = null;
    this.api.createFlow({ name, triggerType: this.customFlowForm.triggerType }).subscribe({
      next: (res) => { this.createdFlow = res; this.saving = false; this.showCustomFlow = false; },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Something went wrong.'; },
    });
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  continue() {
    const next = this.step + 1;
    this.api.updateOnboarding({ currentStep: next }).subscribe({ next: () => this.auth.refresh() });
    this.step = next;
    if (this.step === 4) this.loadPresets();
  }

  skip() {
    this.api.updateOnboarding({ currentStep: this.step }).subscribe({
      next: () => { this.auth.refresh(); this.router.navigateByUrl('/dashboard'); },
      error: () => this.router.navigateByUrl('/dashboard'),
    });
  }

  finish() {
    this.saving = true;
    this.api.updateOnboarding({ completed: true, currentStep: 5 }).subscribe({
      next: () => { this.auth.refresh(); this.saving = false; this.router.navigateByUrl('/dashboard'); },
      error: () => { this.saving = false; this.router.navigateByUrl('/dashboard'); },
    });
  }
}
