import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { InsightCardComponent, Insight } from '../../shared/insight-card/insight-card';
import { InsightActionsService } from '../../shared/insight-actions.service';
import { LocalizationFlagService } from '../../services/localization-flag.service';
import { CustomerLanguageField } from '../localization/embedded/customer-language-field';

export type ConsentFilter = 'all' | 'opted_in' | 'opted_out' | 'not_responded';
export type ConsentStatus = 'opted_in' | 'opted_out' | 'not_responded';

@Component({
  selector: 'app-customers',
  imports: [CommonModule, FormsModule, RouterLink, AppCurrencyPipe, DatePipe, StatusBadgePipe, InsightCardComponent, CustomerLanguageField],
  templateUrl: './customers.html',
  styleUrl: './customers.css',
})
export class Customers implements OnInit {
  readonly loc = inject(LocalizationFlagService);
  customers: any[] = [];
  total = 0;
  page = 1;
  pages = 1;
  loading = false;
  search = '';
  insights: Insight[] = [];
  // Set by a Smart Insights "View Customers" CTA (?ids=...) — narrows the
  // list to exactly the customers that insight was about, instead of the
  // normal free-text search.
  private filterIds: string[] | null = null;

  selectedCustomer: any = null;
  detailLoading = false;
  detailTab: 'orders' | 'whatsapp' | 'products' | 'campaigns' | 'services' | 'consent' = 'orders';

  // Consent column filter (beside the search box) and consent history (loaded only when its tab is opened).
  consentFilter: ConsentFilter = 'all';
  consentEvents: any[] = [];
  loadingConsentEvents = false;
  consentEventsError = false;
  private consentEventsLoadedFor: string | null = null;
  private loadSeq = 0;
  private consentSeq = 0;
  exportingConsent = false;
  exportConsentError = '';

  whatsappHistory: any[] = [];
  loadingHistory = false;
  bookings: any[] = [];
  loadingBookings = false;

  showAddModal = false;
  saving = false;
  form = { firstname: '', lastname: '', phone: '', email: '', marketingConsent: false };

  constructor(private api: ApiService, private route: ActivatedRoute, private insightActions: InsightActionsService) {}

  ngOnInit() {
    const ids = this.route.snapshot.queryParamMap.get('ids')?.split(',').filter(Boolean);
    if (ids?.length) this.filterIds = ids;
    this.load();
    this.api.getInsights('customers').subscribe({ next: (data) => { this.insights = data; }, error: () => {} });
  }

  dismissInsight(insight: Insight)   { this.insightActions.dismiss(insight, this.insights); }
  insightPrimary(insight: Insight)   { this.insightActions.primaryAction(insight, this.insights); }
  insightSecondary(insight: Insight) { this.insightActions.secondaryAction(insight); }

  load() {
    this.loading = true;
    const params: any = { page: this.page, limit: 50 };
    if (this.search) params.search = this.search;
    if (this.filterIds?.length) params.ids = this.filterIds.join(',');
    if (this.consentFilter !== 'all') params.consent = this.consentFilter;
    const seq = ++this.loadSeq;
    this.api.getCustomers(params).subscribe({
      // A slower, older response (e.g. from before a filter change) must not overwrite a newer one.
      next: (res) => { if (seq !== this.loadSeq) return; this.customers = res.customers; this.total = res.total; this.pages = res.pages; this.loading = false; },
      error: () => { if (seq !== this.loadSeq) return; this.loading = false; },
    });
  }

  onSearch() { this.page = 1; this.load(); }

  onConsentFilter() { this.page = 1; this.load(); }

  /** The status badge for a list row. Falls back to the customer's own flags if the row has no consentStatus. */
  consentStatusOf(c: any): ConsentStatus {
    const s = c?.consentStatus;
    if (s === 'opted_in' || s === 'opted_out' || s === 'not_responded') return s;
    if (c?.optedOut === true) return 'opted_out';
    if (c?.marketingConsent === true) return 'opted_in';
    return 'not_responded';
  }

  consentLabel(c: any): string {
    const s = this.consentStatusOf(c);
    return s === 'opted_in' ? 'Opted in' : s === 'opted_out' ? 'Opted out' : 'Not responded';
  }

  consentBadgeClass(c: any): string {
    const s = this.consentStatusOf(c);
    return s === 'opted_in' ? 'badge-success' : s === 'opted_out' ? 'badge-danger' : 'badge-neutral';
  }

  /** Tooltip for the Consent column: how the customer's current answer was captured. */
  consentTooltip(c: any): string {
    const source = c?.consentSource;
    const s = this.consentStatusOf(c);
    if (source) return `${this.consentLabel(c)} - ${source}`;
    return s === 'not_responded' ? 'This customer has not agreed to or declined marketing messages yet' : this.consentLabel(c);
  }

  eventTypeLabel(type: string): string {
    const map: any = { consent_given: 'Opted in', consent_reinstated: 'Opted in again', consent_withdrawn: 'Opted out', consent_declined: 'Declined', consent_requested: 'Asked' };
    return map[type] ?? type;
  }

  eventBadgeClass(type: string): string {
    return type === 'consent_given' || type === 'consent_reinstated' ? 'badge-success' : type === 'consent_withdrawn' ? 'badge-danger' : 'badge-neutral';
  }

  viewDetail(c: any) {
    this.selectedCustomer = null;
    this.detailTab = 'orders';
    this.whatsappHistory = [];
    this.bookings = [];
    this.consentEvents = [];
    this.consentEventsLoadedFor = null;
    this.consentSeq++; // drop any consent-history response still in flight for the previous customer
    this.loadingConsentEvents = false;
    this.consentEventsError = false;
    this.detailLoading = true;
    this.api.getCustomer(c._id).subscribe({
      next: (data) => { this.selectedCustomer = data; this.detailLoading = false; },
      error: () => { this.detailLoading = false; },
    });
  }

  markingConsented = false;
  markConsented() {
    if (!this.selectedCustomer || this.markingConsented) return;
    this.markingConsented = true;
    this.api.markCustomerConsented(this.selectedCustomer._id).subscribe({
      next: (updated) => {
        this.selectedCustomer = { ...this.selectedCustomer, ...updated };
        this.markingConsented = false;
        this.refreshAfterManualConsent(this.selectedCustomer);
      },
      error: () => { this.markingConsented = false; },
    });
  }

  // The list row and (if it was already loaded) the consent history would otherwise keep showing the old answer.
  private refreshAfterManualConsent(updated: any) {
    const row = this.customers.find(c => c._id === updated._id);
    if (row) {
      row.marketingConsent = true;
      row.consentStatus = this.consentStatusOf({ ...updated, consentStatus: undefined }); // honours optedOut
      if (updated.marketingConsentAt) row.consentAt = updated.marketingConsentAt;
      row.consentSource = updated.marketingConsentMethod === 'manual_staff_entry' ? 'Marked as consented by staff' : row.consentSource;
    }
    if (this.consentEventsLoadedFor === updated._id || this.loadingConsentEvents) {
      this.consentSeq++; // a response already in flight may predate the new event
      this.loadingConsentEvents = false;
      this.consentEventsLoadedFor = null;
      if (this.detailTab === 'consent') this.loadConsentEvents();
    }
  }

  openDetailTab(tab: typeof this.detailTab) {
    this.detailTab = tab;
    if (tab === 'whatsapp' || tab === 'campaigns') this.loadWhatsAppHistory();
    if (tab === 'services') this.loadBookings();
    if (tab === 'consent') this.loadConsentEvents();
  }

  loadConsentEvents() {
    const id = this.selectedCustomer?._id;
    if (!id || this.loadingConsentEvents || this.consentEventsLoadedFor === id) return;
    this.loadingConsentEvents = true;
    this.consentEventsError = false;
    const seq = ++this.consentSeq;
    this.api.getCustomerConsentEvents(id).subscribe({
      next: (events) => {
        if (seq !== this.consentSeq || this.selectedCustomer?._id !== id) return; // another customer was opened meanwhile
        this.consentEvents = Array.isArray(events) ? events : [];
        this.consentEventsLoadedFor = id;
        this.loadingConsentEvents = false;
      },
      error: () => {
        if (seq !== this.consentSeq || this.selectedCustomer?._id !== id) return;
        this.loadingConsentEvents = false;
        this.consentEventsError = true;
      },
    });
  }

  exportConsentLog() {
    if (this.exportingConsent) return;
    this.exportingConsent = true;
    this.exportConsentError = '';
    this.api.downloadConsentLogCsv().subscribe({
      next: (blob) => {
        this.exportingConsent = false;
        try {
          this.downloadBlob(blob, `consent-log-${new Date().toISOString().slice(0, 10)}.csv`);
        } catch {
          this.exportConsentError = 'The consent log could not be saved. Please try again.';
        }
      },
      error: () => {
        this.exportingConsent = false;
        this.exportConsentError = 'The consent log could not be downloaded. Please try again.';
      },
    });
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadWhatsAppHistory() {
    if (this.whatsappHistory.length || this.loadingHistory) return;
    this.loadingHistory = true;
    this.api.getCustomerWhatsAppHistory(this.selectedCustomer._id).subscribe({
      next: (data) => { this.whatsappHistory = data; this.loadingHistory = false; },
      error: () => { this.loadingHistory = false; },
    });
  }

  private loadBookings() {
    if (this.bookings.length || this.loadingBookings) return;
    this.loadingBookings = true;
    this.api.getCustomerBookings(this.selectedCustomer._id).subscribe({
      next: (data) => { this.bookings = data; this.loadingBookings = false; },
      error: () => { this.loadingBookings = false; },
    });
  }

  get campaignsReceived(): any[] {
    return this.whatsappHistory.filter(h => h.kind === 'promotion');
  }

  get productsPurchased(): { name: string; quantity: number; orders: number }[] {
    const byName = new Map<string, { name: string; quantity: number; orders: number }>();
    for (const o of this.selectedCustomer?.orders || []) {
      const seenInThisOrder = new Set<string>();
      for (const item of o.items || []) {
        const name = item.productName || 'Unknown item';
        const entry = byName.get(name) || { name, quantity: 0, orders: 0 };
        entry.quantity += item.quantity || 1;
        if (!seenInThisOrder.has(name)) { entry.orders += 1; seenInThisOrder.add(name); }
        byName.set(name, entry);
      }
    }
    return [...byName.values()].sort((a, b) => b.quantity - a.quantity);
  }

  waKindLabel(kind: string): string {
    const map: any = { promotion: '📣 Promotion', loyalty_reminder: '💎 Loyalty Reminder', booking_notification: '📋 Booking Update' };
    return map[kind] ?? kind;
  }

  openAdd() {
    this.form = { firstname: '', lastname: '', phone: '', email: '', marketingConsent: false };
    this.showAddModal = true;
  }

  saveCustomer() {
    this.saving = true;
    this.api.createCustomer(this.form).subscribe({
      next: () => { this.showAddModal = false; this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
