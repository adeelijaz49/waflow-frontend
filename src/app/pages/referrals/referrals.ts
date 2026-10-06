import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ReferralsApiService } from '../../services/referrals-api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { DialogService } from '../../shared/dialog.service';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-neutral', active: 'badge-success', paused: 'badge-warning', ended: 'badge-danger',
};

const REFERRAL_STATUS_BADGE: Record<string, string> = {
  link_created: 'badge-neutral', clicked: 'badge-info', whatsapp_started: 'badge-info',
  customer_created: 'badge-primary', qualified: 'badge-primary', reward_pending: 'badge-warning',
  reward_issued: 'badge-success', rejected: 'badge-danger', expired: 'badge-neutral', voided: 'badge-danger',
};

const FRIEND_REWARD_TYPES = [
  { value: 'percent_discount', label: 'Percentage discount' },
  { value: 'fixed_discount', label: 'Fixed discount amount' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'free_item', label: 'Free product/service' },
  { value: 'loyalty_points', label: 'Loyalty points on signup' },
  { value: 'none', label: 'No reward' },
];
const REFERRER_REWARD_TYPES = [
  { value: 'loyalty_points', label: 'Loyalty points' },
  { value: 'fixed_discount', label: 'Fixed discount amount' },
  { value: 'percent_discount', label: 'Percentage discount' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'free_item', label: 'Free product/service' },
  { value: 'manual', label: 'Manual reward approval' },
  { value: 'none', label: 'No reward' },
];
const QUALIFYING_ACTIONS = [
  { value: 'first_order', label: 'Friend places first order (recommended)' },
  { value: 'payment_completed', label: 'Friend completes payment' },
  { value: 'first_booking', label: 'Friend completes booking' },
  { value: 'minimum_spend', label: 'Friend reaches minimum spend' },
  { value: 'customer_created', label: 'Friend creates a customer profile' },
  { value: 'whatsapp_started', label: 'Friend starts a WhatsApp conversation' },
  { value: 'link_clicked', label: 'Friend clicks the referral link' },
  { value: 'loyalty_joined', label: 'Friend joins loyalty programme' },
];

const REWARD_LABELS: Record<string, string> = Object.fromEntries(
  [...FRIEND_REWARD_TYPES, ...REFERRER_REWARD_TYPES, ...QUALIFYING_ACTIONS].map(t => [t.value, t.label]),
);

function emptyForm() {
  return {
    name: '', description: '', startsAt: '', endsAt: '',
    friendRewardType: 'percent_discount', friendRewardValue: 15, friendRewardLabel: '',
    referrerRewardType: 'loyalty_points', referrerRewardValue: 50, referrerRewardLabel: '',
    qualifyingAction: 'first_order', minimumSpend: 0,
    maxRewardsPerReferrer: 0, maxTotalRewards: 0, requiresManualApproval: false, termsText: '',
  };
}

@Component({
  selector: 'app-referrals',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, DatePipe],
  templateUrl: './referrals.html',
  styleUrl: './referrals.css',
})
export class Referrals implements OnInit {
  readonly friendRewardTypes = FRIEND_REWARD_TYPES;
  readonly referrerRewardTypes = REFERRER_REWARD_TYPES;
  readonly qualifyingActions = QUALIFYING_ACTIONS;

  promotions: any[] = [];
  loadingList = false;

  selected: any = null;
  report: any = null;
  loadingReport = false;

  showForm = false;
  editingId: string | null = null;
  form = emptyForm();
  saving = false;

  genericLink: any = null;
  genericQr: string | null = null;
  loadingGenericLink = false;

  showPicker = false;
  customers: any[] = [];
  customerSearch = '';
  loadingCustomers = false;
  selectedCustomerIds = new Set<string>();
  workingOnLinks = false;

  pendingApprovals: any[] = [];

  constructor(private api: ApiService, private referralsApi: ReferralsApiService, private dialog: DialogService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loadingList = true;
    this.referralsApi.getPromotions().subscribe({
      next: (res) => { this.promotions = res || []; this.loadingList = false; },
      error: () => { this.loadingList = false; },
    });
  }

  statusBadge(status: string): string { return STATUS_BADGE[status] || 'badge-neutral'; }
  referralStatusBadge(status: string): string { return REFERRAL_STATUS_BADGE[status] || 'badge-neutral'; }
  rewardLabel(type: string): string { return REWARD_LABELS[type] || type; }

  rewardSummary(p: any): string {
    const friend = p.friendRewardType === 'none' ? 'no friend reward'
      : p.friendRewardType === 'percent_discount' ? `${p.friendRewardValue}% off for friend`
      : p.friendRewardType === 'fixed_discount' ? `${p.friendRewardValue} off for friend`
      : p.friendRewardType === 'loyalty_points' ? `${p.friendRewardValue} pts for friend`
      : this.rewardLabel(p.friendRewardType) + ' for friend';
    const referrer = p.referrerRewardType === 'none' ? 'no referrer reward'
      : p.referrerRewardType === 'loyalty_points' ? `${p.referrerRewardValue} pts for referrer`
      : p.referrerRewardType === 'percent_discount' ? `${p.referrerRewardValue}% off for referrer`
      : p.referrerRewardType === 'fixed_discount' ? `${p.referrerRewardValue} off for referrer`
      : this.rewardLabel(p.referrerRewardType) + ' for referrer';
    return `${friend} · ${referrer}`;
  }

  // ── Create / edit ─────────────────────────────────────────────────────────
  openCreate() {
    this.form = emptyForm();
    this.editingId = null;
    this.showForm = true;
  }

  openEdit(p: any) {
    this.form = {
      name: p.name, description: p.description || '',
      startsAt: p.startsAt ? p.startsAt.slice(0, 10) : '', endsAt: p.endsAt ? p.endsAt.slice(0, 10) : '',
      friendRewardType: p.friendRewardType, friendRewardValue: p.friendRewardValue, friendRewardLabel: p.friendRewardLabel || '',
      referrerRewardType: p.referrerRewardType, referrerRewardValue: p.referrerRewardValue, referrerRewardLabel: p.referrerRewardLabel || '',
      qualifyingAction: p.qualifyingAction, minimumSpend: p.minimumSpend || 0,
      maxRewardsPerReferrer: p.maxRewardsPerReferrer || 0, maxTotalRewards: p.maxTotalRewards || 0,
      requiresManualApproval: !!p.requiresManualApproval, termsText: p.termsText || '',
    };
    this.editingId = p._id;
    this.showForm = true;
  }

  save() {
    if (!this.form.name.trim() || this.saving) return;
    this.saving = true;
    const payload = { ...this.form, startsAt: this.form.startsAt || null, endsAt: this.form.endsAt || null };
    const req$ = this.editingId ? this.referralsApi.updatePromotion(this.editingId, payload) : this.referralsApi.createPromotion(payload);
    req$.subscribe({
      next: (saved) => {
        this.saving = false;
        this.showForm = false;
        this.load();
        if (!this.editingId) this.open(saved);
      },
      error: (err) => { this.saving = false; this.dialog.error(err.error?.error || "Couldn't save this referral promotion."); },
    });
  }

  async setStatus(p: any, status: string) {
    if (status === 'active') {
      const ok = await this.dialog.confirm(`Activate "${p.name}"? Referral links will start working immediately.`, { type: 'info', confirmLabel: 'Activate' });
      if (!ok) return;
    }
    this.referralsApi.setStatus(p._id, status).subscribe({
      next: () => { this.load(); if (this.selected?._id === p._id) this.selected.status = status; },
      error: (err) => this.dialog.error(err.error?.error || "Couldn't update status."),
    });
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  open(p: any) {
    this.selected = p;
    this.report = null;
    this.genericLink = null;
    this.genericQr = null;
    this.selectedCustomerIds.clear();
    this.showPicker = false;
    this.loadReport();
    this.loadGenericLink();
    this.loadPendingApprovals();
  }

  close() {
    this.selected = null;
  }

  loadReport() {
    if (!this.selected) return;
    this.loadingReport = true;
    this.referralsApi.getReport(this.selected._id).subscribe({
      next: (res) => { this.report = res; this.loadingReport = false; },
      error: () => { this.loadingReport = false; },
    });
  }

  loadGenericLink() {
    if (!this.selected) return;
    this.loadingGenericLink = true;
    this.referralsApi.getGenericLink(this.selected._id).subscribe({
      next: (res) => { this.genericLink = res; this.loadingGenericLink = false; },
      error: () => { this.loadingGenericLink = false; },
    });
  }

  loadGenericQr() {
    if (!this.genericLink || this.genericQr) return;
    this.referralsApi.getQrCode(this.genericLink._id).subscribe({
      next: (res) => { this.genericQr = res.qrCodeDataUrl; },
    });
  }

  selectInputText(event: Event) {
    (event.target as HTMLInputElement)?.select();
  }

  copyLink(url: string) {
    navigator.clipboard?.writeText(url).then(() => this.dialog.success('Link copied to clipboard.'));
  }

  loadPendingApprovals() {
    this.referralsApi.getPendingApprovals().subscribe({
      next: (res) => { this.pendingApprovals = (res || []).filter(r => r.referralPromotionId === this.selected?._id); },
      error: () => {},
    });
  }

  respondToApproval(referral: any, approve: boolean) {
    this.referralsApi.approveReward(referral._id, approve).subscribe({
      next: () => { this.loadPendingApprovals(); this.loadReport(); },
      error: (err) => this.dialog.error(err.error?.error || "Couldn't update this reward."),
    });
  }

  async voidReferral(referral: any) {
    const ok = await this.dialog.confirm('Void this referral? No reward will be issued.', { confirmLabel: 'Void referral' });
    if (!ok) return;
    this.referralsApi.voidReferral(referral._id, 'Voided by merchant').subscribe({
      next: () => this.loadReport(),
      error: (err) => this.dialog.error(err.error?.error || "Couldn't void this referral."),
    });
  }

  // ── Customer picker: generate + send links ──────────────────────────────
  openPicker() {
    this.showPicker = true;
    if (!this.customers.length) this.searchCustomers();
  }

  searchCustomers() {
    this.loadingCustomers = true;
    // HttpClient stringifies a plain-object param's value via template
    // literal interpolation, so an explicit `search: undefined` would be
    // sent as the literal text "undefined" (matching zero real customers)
    // rather than being omitted — only add the key when there's a real term.
    const params: any = { limit: 50 };
    if (this.customerSearch) params.search = this.customerSearch;
    this.api.getCustomers(params).subscribe({
      next: (res: any) => { this.customers = res.customers || []; this.loadingCustomers = false; },
      error: () => { this.loadingCustomers = false; },
    });
  }

  toggleCustomer(id: string) {
    if (this.selectedCustomerIds.has(id)) this.selectedCustomerIds.delete(id);
    else this.selectedCustomerIds.add(id);
  }

  generateLinks() {
    if (!this.selected || !this.selectedCustomerIds.size || this.workingOnLinks) return;
    this.workingOnLinks = true;
    this.referralsApi.generateCustomerLinks(this.selected._id, [...this.selectedCustomerIds]).subscribe({
      next: () => { this.workingOnLinks = false; this.dialog.success('Referral links generated.'); },
      error: (err) => { this.workingOnLinks = false; this.dialog.error(err.error?.error || "Couldn't generate links."); },
    });
  }

  sendLinks() {
    if (!this.selected || !this.selectedCustomerIds.size || this.workingOnLinks) return;
    this.workingOnLinks = true;
    this.referralsApi.sendLinks(this.selected._id, [...this.selectedCustomerIds]).subscribe({
      next: (res) => {
        this.workingOnLinks = false;
        this.showPicker = false;
        this.selectedCustomerIds.clear();
        const skippedNote = res.skipped?.length ? ` ${res.skipped.length} skipped (opted out or not consented).` : '';
        this.dialog.success(`Sent to ${res.sentCount} of ${res.total} customers.${skippedNote}`);
        this.loadReport();
      },
      error: (err) => { this.workingOnLinks = false; this.dialog.error(err.error?.error || "Couldn't send referral links."); },
    });
  }
}
