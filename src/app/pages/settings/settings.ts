import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { SettingsService } from '../../shared/settings.service';
import { AuthService } from '../../shared/auth.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  loyaltySettings: any = { loyaltyPointsPerUnit: 100, minPointsPerPurchase: 100, currency: 'AUD', flowCooldownDays: 3, merchantName: '', defaultCountryCode: '966' };
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

  // Team (workspace members + invites)
  members: any[] = [];
  membersLoading = false;
  invites: any[] = [];
  invitesLoading = false;
  inviteContactType: 'phone' | 'email' = 'phone';
  inviteContact = '';
  inviteRole: 'owner' | 'member' = 'member';
  inviteSending = false;
  inviteError: string | null = null;
  inviteWarning: string | null = null;

  // Privacy & Compliance
  consentStats: any = null;
  consentStatsLoading = false;
  sendingConsentRequests = false;
  consentRequestResult: any = null;

  constructor(private api: ApiService, private settings: SettingsService, public auth: AuthService) {}

  ngOnInit() {
    this.loadLoyaltySettings();
    this.loadTokenStatus();
    this.loadTemplates();
    this.loadMembers();
    this.loadInvites();
    this.loadConsentStats();
  }

  loadConsentStats() {
    this.consentStatsLoading = true;
    this.api.getConsentStats().subscribe({
      next: (s) => { this.consentStats = s; this.consentStatsLoading = false; },
      error: () => { this.consentStatsLoading = false; },
    });
  }

  sendConsentRequests() {
    if (this.sendingConsentRequests) return;
    this.sendingConsentRequests = true;
    this.consentRequestResult = null;
    this.api.sendConsentRequests().subscribe({
      next: (res) => {
        this.sendingConsentRequests = false;
        this.consentRequestResult = res;
        this.loadConsentStats(); // refresh counts now that these customers have been asked
      },
      error: (err) => {
        this.sendingConsentRequests = false;
        this.consentRequestResult = { error: err.error?.error || 'Something went wrong — please try again.' };
      },
    });
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

  get isOwner(): boolean {
    return this.auth.sessionSnapshot?.role === 'owner';
  }

  loadMembers() {
    this.membersLoading = true;
    this.api.getMembers().subscribe({
      next: (m) => { this.members = m; this.membersLoading = false; },
      error: () => { this.membersLoading = false; },
    });
  }

  loadInvites() {
    this.invitesLoading = true;
    this.api.getInvites().subscribe({
      next: (i) => { this.invites = i; this.invitesLoading = false; },
      error: () => { this.invitesLoading = false; },
    });
  }

  sendInvite() {
    const contact = this.inviteContact.trim();
    if (!contact || this.inviteSending) return;
    this.inviteSending = true;
    this.inviteError = null;
    this.inviteWarning = null;
    this.api.createInvite(this.inviteContactType, contact, this.inviteRole).subscribe({
      next: (res) => {
        this.inviteSending = false;
        this.inviteContact = '';
        if (res.sendWarning) this.inviteWarning = res.sendWarning;
        this.loadInvites();
      },
      error: (err) => { this.inviteSending = false; this.inviteError = err.error?.error || 'Something went wrong — please try again.'; },
    });
  }

  revokeInvite(id: string) {
    this.api.revokeInvite(id).subscribe({ next: () => this.loadInvites() });
  }

  removeMember(userId: string) {
    if (!confirm('Remove this person from the workspace?')) return;
    this.api.removeMember(userId).subscribe({
      next: () => this.loadMembers(),
      error: (err) => alert(err.error?.error || 'Something went wrong — please try again.'),
    });
  }

  memberLabel(m: any): string {
    return m.name || m.phone || m.email || 'Unknown';
  }
}
