import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  tokenStatus: any = null;
  tokenLoading  = false;
  tokenError    = false;
  refreshing    = false;
  refreshResult: any = null;

  templates: any[] = [];
  promoTemplate    = 'waflow_promo';    // default — overridden by API response
  loyaltyTemplate  = 'waflow_loyalty';  // default — overridden by API response
  templatesLoading = false;
  templatesError   = false;
  creatingPromo    = false;
  creatingLoyalty  = false;
  templateResult: any = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadTokenStatus();
    this.loadTemplates();
  }

  loadTokenStatus() {
    this.tokenLoading = true;
    this.tokenError   = false;
    this.api.getTokenStatus().subscribe({
      next:  (s) => { this.tokenStatus = s; this.tokenLoading = false; },
      error: ()  => { this.tokenLoading = false; this.tokenError = true; },
    });
  }

  refreshToken() {
    this.refreshing    = true;
    this.refreshResult = null;
    this.api.refreshToken().subscribe({
      next:  (res) => { this.refreshResult = res; this.tokenStatus = res.status; this.refreshing = false; },
      error: (err) => { this.refreshResult = { error: err.error?.error || 'Refresh failed' }; this.refreshing = false; },
    });
  }

  loadTemplates() {
    this.templatesLoading = true;
    this.templatesError   = false;
    this.api.getTemplates().subscribe({
      next: (res) => {
        this.templates        = res.templates;
        this.promoTemplate    = res.promoTemplate   || this.promoTemplate;
        this.loyaltyTemplate  = res.loyaltyTemplate || this.loyaltyTemplate;
        this.templatesLoading = false;
      },
      error: () => { this.templatesLoading = false; this.templatesError = true; },
    });
  }

  createPromoTemplate() {
    this.creatingPromo  = true;
    this.templateResult = null;
    this.api.createPromoTemplate().subscribe({
      next:  () => { this.templateResult = { ok: true, msg: 'Promo template submitted for review. Refresh in a few minutes to check approval status.' }; this.creatingPromo = false; this.loadTemplates(); },
      error: (err) => { this.templateResult = { ok: false, msg: err.error?.error?.error_user_msg || err.error?.error || 'Failed' }; this.creatingPromo = false; },
    });
  }

  recreatePromoTemplate() {
    if (!confirm('This will DELETE the existing promo template and recreate it with the "Shop Now" button. It will need re-approval. Continue?')) return;
    this.creatingPromo  = true;
    this.templateResult = null;
    this.api.deleteTemplate(this.promoTemplate).subscribe({
      next: () => {
        this.api.createPromoTemplate().subscribe({
          next:  () => { this.templateResult = { ok: true, msg: 'Promo template recreated with "Shop Now" button. Awaiting Meta approval.' }; this.creatingPromo = false; this.loadTemplates(); },
          error: (err) => { this.templateResult = { ok: false, msg: 'Deleted but recreate failed: ' + (err.error?.error || err.message) }; this.creatingPromo = false; },
        });
      },
      error: (err) => { this.templateResult = { ok: false, msg: 'Delete failed: ' + (err.error?.error || err.message) }; this.creatingPromo = false; },
    });
  }

  createLoyaltyTemplate() {
    this.creatingLoyalty = true;
    this.templateResult  = null;
    this.api.createLoyaltyTemplate().subscribe({
      next:  () => { this.templateResult = { ok: true, msg: 'Loyalty template submitted for review. Refresh in a few minutes to check approval status.' }; this.creatingLoyalty = false; this.loadTemplates(); },
      error: (err) => { this.templateResult = { ok: false, msg: err.error?.error?.error_user_msg || err.error?.error || 'Failed' }; this.creatingLoyalty = false; },
    });
  }

  templateForName(name: string) {
    return this.templates.find(t => t.name === name);
  }

  statusBadgeClass(status: string): string {
    const map: any = { APPROVED: 'badge-success', PENDING: 'badge-warning', REJECTED: 'badge-danger', PAUSED: 'badge-neutral' };
    return map[status?.toUpperCase()] ?? 'badge-neutral';
  }

  tokenBadgeClass(): string {
    if (!this.tokenStatus) return 'badge-neutral';
    if (this.tokenStatus.neverExpires) return 'badge-success';
    if (this.tokenStatus.daysLeft > 7)  return 'badge-success';
    if (this.tokenStatus.daysLeft > 0)  return 'badge-warning';
    return 'badge-danger';
  }

  tokenBadgeLabel(): string {
    if (!this.tokenStatus) return 'Unknown';
    if (this.tokenStatus.neverExpires) return 'Never expires';
    if (this.tokenStatus.daysLeft > 0) return `${this.tokenStatus.daysLeft}d left`;
    return 'Expired';
  }
}
