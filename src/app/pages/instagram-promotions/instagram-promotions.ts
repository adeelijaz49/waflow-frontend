import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { InstagramApiService } from '../../services/instagram-api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { DialogService } from '../../shared/dialog.service';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-neutral', scheduled: 'badge-info', publishing: 'badge-warning',
  published: 'badge-success', failed: 'badge-danger', cancelled: 'badge-neutral',
};

const GOALS = [
  { value: 'new_customers', label: 'Attract new customers' },
  { value: 'promote_product', label: 'Promote a product' },
  { value: 'promote_service', label: 'Promote a service' },
  { value: 'fill_quiet_slots', label: 'Fill quiet slots/days' },
  { value: 'launch_branch', label: 'Launch a new branch' },
  { value: 'promote_loyalty', label: 'Promote loyalty programme' },
  { value: 'promote_referral', label: 'Promote referral programme' },
  { value: 'weekend_sales', label: 'Weekend sales push' },
  { value: 'seasonal', label: 'Seasonal/holiday promotion' },
];

const DESTINATION_ACTIONS = [
  { value: 'start_conversation', label: 'Start a WhatsApp conversation' },
  { value: 'claim_offer', label: 'Claim this offer' },
  { value: 'book_service', label: 'Book a service' },
  { value: 'order_product', label: 'Order a product' },
  { value: 'join_loyalty', label: 'Join loyalty programme' },
  { value: 'use_referral', label: 'Use a referral code' },
  { value: 'landing_page', label: 'Visit a landing page' },
];

const POST_TYPES = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'reel', label: 'Reel' },
];

const LABELS: Record<string, string> = Object.fromEntries(
  [...GOALS, ...DESTINATION_ACTIONS].map(t => [t.value, t.label]),
);

function emptyForm() {
  return {
    name: '', goal: 'new_customers', productId: '', serviceId: '', offerDescription: '',
    startsAt: '', endsAt: '', postType: 'image', mediaUrl: '', thumbnailUrl: '',
    caption: '', hashtags: '', whatsappCtaText: '', destinationAction: 'start_conversation',
  };
}

@Component({
  selector: 'app-instagram-promotions',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, DatePipe, RouterLink],
  templateUrl: './instagram-promotions.html',
  styleUrl: './instagram-promotions.css',
})
export class InstagramPromotions implements OnInit {
  readonly goals = GOALS;
  readonly destinationActions = DESTINATION_ACTIONS;
  readonly postTypes = POST_TYPES;

  loadingEntitlement = true;
  entitlementEnabled = false;

  account: any = null;
  loadingAccount = false;
  connecting = false;
  oauthNotice: { type: 'success' | 'error'; text: string } | null = null;

  posts: any[] = [];
  loadingList = false;
  statusFilter = '';

  products: any[] = [];
  services: any[] = [];

  selected: any = null;
  report: any = null;
  loadingReport = false;
  jobs: any[] = [];

  showForm = false;
  editingId: string | null = null;
  form = emptyForm();
  saving = false;
  uploadingMedia = false;

  generatingContent = false;
  refining = false;
  refineInstruction = '';

  showScheduleModal = false;
  scheduleAt = '';
  scheduling = false;
  publishingNow = false;

  constructor(
    private api: ApiService,
    private instagramApi: InstagramApiService,
    private dialog: DialogService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit() {
    this.checkOAuthRedirect();
    this.loadEntitlement();
    this.api.getProducts({ limit: 200 }).subscribe({ next: (res: any) => { this.products = res.products || []; }, error: () => {} });
    this.api.getServices().subscribe({ next: (res: any) => { this.services = res || []; }, error: () => {} });
  }

  private checkOAuthRedirect() {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('ig_connected')) {
      this.oauthNotice = { type: 'success', text: 'Instagram account connected successfully.' };
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    } else if (params.get('ig_error')) {
      this.oauthNotice = { type: 'error', text: `Couldn't connect Instagram: ${params.get('ig_error')}` };
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  loadEntitlement() {
    this.loadingEntitlement = true;
    this.instagramApi.getEntitlement().subscribe({
      next: (res) => {
        this.entitlementEnabled = !!res.enabled;
        this.loadingEntitlement = false;
        if (this.entitlementEnabled) { this.loadAccount(); this.load(); }
      },
      error: () => { this.loadingEntitlement = false; },
    });
  }

  loadAccount() {
    this.loadingAccount = true;
    this.instagramApi.getAccountStatus().subscribe({
      next: (res) => { this.account = res; this.loadingAccount = false; },
      error: () => { this.loadingAccount = false; },
    });
  }

  connect() {
    this.connecting = true;
    this.instagramApi.getConnectUrl().subscribe({
      next: (res) => { window.location.href = res.url; },
      error: (err) => { this.connecting = false; this.dialog.error(err.error?.error || "Couldn't start the Instagram connection."); },
    });
  }

  async disconnect() {
    const ok = await this.dialog.confirm('Disconnect this Instagram account? Scheduled posts will no longer be able to publish until you reconnect.', { confirmLabel: 'Disconnect' });
    if (!ok) return;
    this.instagramApi.disconnect().subscribe({
      next: () => this.loadAccount(),
      error: (err) => this.dialog.error(err.error?.error || "Couldn't disconnect this account."),
    });
  }

  load() {
    this.loadingList = true;
    this.instagramApi.getPosts(this.statusFilter || undefined).subscribe({
      next: (res) => { this.posts = res || []; this.loadingList = false; },
      error: () => { this.loadingList = false; },
    });
  }

  statusBadge(status: string): string { return STATUS_BADGE[status] || 'badge-neutral'; }
  goalLabel(goal: string): string { return LABELS[goal] || goal; }
  destinationLabel(action: string): string { return LABELS[action] || action; }

  productName(id: string): string { return this.products.find(p => p._id === id)?.name || ''; }
  serviceName(id: string): string { return this.services.find(s => s._id === id)?.name || ''; }

  // ── Create / edit ─────────────────────────────────────────────────────────
  openCreate() {
    this.form = emptyForm();
    this.editingId = null;
    this.showForm = true;
  }

  openEdit(p: any) {
    this.form = {
      name: p.name, goal: p.goal, productId: p.productId || '', serviceId: p.serviceId || '',
      offerDescription: p.offerDescription || '',
      startsAt: p.startsAt ? p.startsAt.slice(0, 10) : '', endsAt: p.endsAt ? p.endsAt.slice(0, 10) : '',
      postType: p.postType, mediaUrl: p.mediaUrl || '', thumbnailUrl: p.thumbnailUrl || '',
      caption: p.caption || '', hashtags: (p.hashtags || []).join(' '),
      whatsappCtaText: p.whatsappCtaText || '', destinationAction: p.destinationAction,
    };
    this.editingId = p._id;
    this.showForm = true;
  }

  onMediaSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploadingMedia = true;
    this.instagramApi.uploadMedia(file).subscribe({
      next: (res) => {
        this.uploadingMedia = false;
        this.form.mediaUrl = res.url;
        this.form.postType = res.mediaType === 'video' ? 'video' : 'image';
      },
      error: (err) => { this.uploadingMedia = false; this.dialog.error(err.error?.error || "Couldn't upload this media file."); },
    });
  }

  generateContent() {
    if (!this.editingId) {
      this.dialog.error('Save this promotion as a draft first, then generate AI content.');
      return;
    }
    this.generatingContent = true;
    this.instagramApi.generateContent(this.editingId).subscribe({
      next: (res) => {
        this.generatingContent = false;
        this.form.caption = res.caption;
        this.form.hashtags = (res.hashtags || []).join(' ');
        this.form.whatsappCtaText = res.whatsappCta;
      },
      error: (err) => { this.generatingContent = false; this.dialog.error(err.error?.error || "Couldn't generate content."); },
    });
  }

  refineCaption() {
    if (!this.refineInstruction.trim() || this.refining) return;
    this.refining = true;
    this.instagramApi.refineContent(this.form.caption, this.refineInstruction).subscribe({
      next: (res) => { this.refining = false; this.form.caption = res.caption; this.refineInstruction = ''; },
      error: (err) => { this.refining = false; this.dialog.error(err.error?.error || "Couldn't refine this caption."); },
    });
  }

  save() {
    if (!this.form.name.trim() || this.saving) return;
    this.saving = true;
    const payload = {
      ...this.form,
      productId: this.form.productId || null, serviceId: this.form.serviceId || null,
      startsAt: this.form.startsAt || null, endsAt: this.form.endsAt || null,
      hashtags: this.form.hashtags.split(/\s+/).map(h => h.trim()).filter(Boolean),
    };
    const req$ = this.editingId ? this.instagramApi.updatePost(this.editingId, payload) : this.instagramApi.createPost(payload);
    req$.subscribe({
      next: (saved) => {
        this.saving = false;
        this.showForm = false;
        this.load();
        if (!this.editingId) this.open(saved);
        else if (this.selected?._id === saved._id) this.open(saved);
      },
      error: (err) => { this.saving = false; this.dialog.error(err.error?.error || "Couldn't save this promotion."); },
    });
  }

  async duplicate(p: any) {
    this.instagramApi.duplicatePost(p._id).subscribe({
      next: () => { this.load(); this.dialog.success('Promotion duplicated as a new draft.'); },
      error: (err) => this.dialog.error(err.error?.error || "Couldn't duplicate this promotion."),
    });
  }

  async cancel(p: any) {
    const ok = await this.dialog.confirm(`Cancel "${p.name}"? It will no longer be published.`, { confirmLabel: 'Cancel promotion' });
    if (!ok) return;
    this.instagramApi.cancelPost(p._id).subscribe({
      next: (updated) => { this.load(); if (this.selected?._id === p._id) this.selected = updated; },
      error: (err) => this.dialog.error(err.error?.error || "Couldn't cancel this promotion."),
    });
  }

  // ── Schedule / publish ───────────────────────────────────────────────────
  openSchedule(p: any) {
    if (!p.mediaUrl) { this.dialog.error('Upload media for this promotion before scheduling it.'); return; }
    this.selected = p;
    this.scheduleAt = '';
    this.showScheduleModal = true;
  }

  confirmSchedule() {
    if (!this.scheduleAt || !this.selected || this.scheduling) return;
    this.scheduling = true;
    this.instagramApi.schedulePost(this.selected._id, new Date(this.scheduleAt).toISOString()).subscribe({
      next: (updated) => { this.scheduling = false; this.showScheduleModal = false; this.load(); this.open(updated); },
      error: (err) => { this.scheduling = false; this.dialog.error(err.error?.error || "Couldn't schedule this promotion."); },
    });
  }

  async publishNow(p: any) {
    const ok = await this.dialog.confirm(`Publish "${p.name}" to Instagram right now?`, { confirmLabel: 'Publish now' });
    if (!ok) return;
    this.publishingNow = true;
    this.instagramApi.publishNow(p._id).subscribe({
      next: (updated) => { this.publishingNow = false; this.load(); if (this.selected?._id === p._id) this.open(updated); },
      error: (err) => { this.publishingNow = false; this.dialog.error(err.error?.error || "Couldn't publish this promotion right now."); },
    });
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  open(p: any) {
    this.selected = p;
    this.report = null;
    this.jobs = [];
    this.loadReport();
    this.loadJobs();
  }

  close() {
    this.selected = null;
  }

  loadReport() {
    if (!this.selected) return;
    this.loadingReport = true;
    this.instagramApi.getReport(this.selected._id).subscribe({
      next: (res) => { this.report = res; this.loadingReport = false; },
      error: () => { this.loadingReport = false; },
    });
  }

  loadJobs() {
    if (!this.selected) return;
    this.instagramApi.getJobs(this.selected._id).subscribe({
      next: (res) => { this.jobs = res || []; },
      error: () => {},
    });
  }

  selectInputText(event: Event) {
    (event.target as HTMLInputElement)?.select();
  }

  copyLink(url: string) {
    navigator.clipboard?.writeText(url).then(() => this.dialog.success('Link copied to clipboard.'));
  }
}
