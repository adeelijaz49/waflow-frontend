import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  EntitlementsApiService,
  EntitlementsSummary,
  UsageEvent,
  UsageRow,
  UsageType,
  LedgerUsageType,
  USAGE_TYPE_LABELS,
  LEDGER_USAGE_TYPE_LABELS,
} from '../../services/entitlements-api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';

const EVENTS_PAGE_SIZE = 20;

const SUBSCRIPTION_STATUS_BADGE: Record<string, string> = {
  active: 'badge-success',
  trialing: 'badge-info',
  past_due: 'badge-warning',
  canceled: 'badge-danger',
};

const ADDON_STATUS_BADGE: Record<string, string> = {
  active: 'badge-success',
  pending_payment: 'badge-warning',
  expired: 'badge-neutral',
  cancelled: 'badge-neutral',
  failed: 'badge-danger',
};

const WARNING_TEXT: Record<string, string> = {
  warn75: '75% used',
  warn90: '90% used — approaching limit',
  exceeded: 'Limit reached',
};

@Component({
  selector: 'app-usage-limits',
  imports: [CommonModule, FormsModule, RouterLink, AppCurrencyPipe, DatePipe],
  templateUrl: './usage-limits.html',
  styleUrl: './usage-limits.css',
})
export class UsageLimits implements OnInit {
  readonly typeOptions: { value: LedgerUsageType | ''; label: string }[] = [
    { value: '', label: 'All' },
    ...(Object.entries(LEDGER_USAGE_TYPE_LABELS) as [LedgerUsageType, string][]).map(([value, label]) => ({ value, label })),
  ];

  summary: EntitlementsSummary | null = null;
  loadingSummary = false;

  events: UsageEvent[] = [];
  total = 0;
  page = 1;
  pages = 1;
  loadingEvents = false;
  selectedType: LedgerUsageType | '' = '';

  constructor(private api: EntitlementsApiService) {}

  ngOnInit() {
    this.loadSummary();
    this.loadEvents();
  }

  loadSummary() {
    this.loadingSummary = true;
    this.api.getSummary().subscribe({
      next: (res) => { this.summary = res; this.loadingSummary = false; },
      error: () => { this.loadingSummary = false; },
    });
  }

  loadEvents() {
    this.loadingEvents = true;
    this.api.getUsageEvents({ type: this.selectedType || undefined, page: this.page, limit: EVENTS_PAGE_SIZE }).subscribe({
      next: (res) => {
        this.events = res.events || [];
        this.total = res.total;
        this.page = res.page;
        this.pages = res.pages || 1;
        this.loadingEvents = false;
      },
      error: () => { this.loadingEvents = false; },
    });
  }

  onTypeFilterChange() {
    this.page = 1;
    this.loadEvents();
  }

  prevPage() { if (this.page > 1) { this.page--; this.loadEvents(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.loadEvents(); } }

  usageTypeLabel(type: string): string {
    return USAGE_TYPE_LABELS[type as UsageType] ?? type;
  }

  ledgerTypeLabel(type: string): string {
    return LEDGER_USAGE_TYPE_LABELS[type as LedgerUsageType] ?? type;
  }

  subscriptionBadge(status: string): string {
    return SUBSCRIPTION_STATUS_BADGE[status] ?? 'badge-neutral';
  }

  addOnBadge(status: string): string {
    return ADDON_STATUS_BADGE[status] ?? 'badge-neutral';
  }

  warningText(level: string | null): string {
    return level ? (WARNING_TEXT[level] ?? '') : '';
  }

  warningBadgeClass(level: string | null): string {
    return level === 'warn75' ? 'badge-warning' : 'badge-danger';
  }

  barClass(level: string | null): string {
    if (level === 'warn90' || level === 'exceeded') return 'danger';
    if (level === 'warn75') return 'warn75';
    return '';
  }

  barWidth(row: UsageRow): number {
    return Math.max(0, Math.min(row.percentUsed ?? 0, 100));
  }

  ctaLabel(row: UsageRow): string {
    return row.type === 'whatsappCreditPerCycle' ? 'Add Credit' : 'Upgrade';
  }

  ctaClass(row: UsageRow): string {
    return row.warningLevel === 'warn90' || row.warningLevel === 'exceeded' ? 'btn-primary' : 'btn-outline';
  }
}
