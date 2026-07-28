import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { SettingsService } from '../../shared/settings.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  loyaltySettings: any = { loyaltyPointsPerUnit: 100, minPointsPerPurchase: 100, currency: 'AUD', flowCooldownDays: 3 };
  loyaltySaving  = false;
  loyaltySaved   = false;

  tokenStatus: any = null;
  tokenLoading  = false;
  tokenError    = false;
  refreshing    = false;
  refreshResult: any = null;

  // Read-only (DEFECT-05) — creating/editing a template happens inside the
  // Promotion or Flow it belongs to. The fixed fallback templates (waflow_promo,
  // waflow_loyalty, etc.) are created automatically on first use if missing
  // (see utils/whatsapp.js#ensureTemplateExists) — nothing to do here.
  templates: any[] = [];
  templatesLoading = false;
  templatesError   = false;

  constructor(private api: ApiService, private settings: SettingsService) {}

  ngOnInit() {
    this.loadLoyaltySettings();
    this.loadTokenStatus();
    this.loadTemplates();
  }

  loadLoyaltySettings() {
    this.api.getLoyaltySettings().subscribe({
      next: (s) => { this.loyaltySettings = s; },
      error: () => {},
    });
  }

  // Mirrors the backend formula exactly (server.js): points = max(minimum, round(spend * perUnit)).
  exampleSpend = 100;
  examplePoints(): number {
    const perUnit = +this.loyaltySettings.loyaltyPointsPerUnit || 0;
    const minPts  = +this.loyaltySettings.minPointsPerPurchase || 0;
    return Math.max(minPts, Math.round(this.exampleSpend * perUnit));
  }

  saveLoyalty() {
    this.loyaltySaving = true;
    this.api.saveLoyaltySettings(this.loyaltySettings).subscribe({
      next: (s) => {
        this.loyaltySettings = s;
        this.loyaltySaving = false;
        this.loyaltySaved = true;
        this.settings.refresh(); // so the currency pipe elsewhere picks up the change immediately
        setTimeout(() => this.loyaltySaved = false, 3000);
      },
      error: () => { this.loyaltySaving = false; },
    });
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
        this.templatesLoading = false;
      },
      error: () => { this.templatesLoading = false; this.templatesError = true; },
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
