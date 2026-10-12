import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import type { CampaignStatus, LocalizedCampaignView } from '../localization.types';
import { LangPill } from '../shared/lang-pill';
import { errorText, isNotEnabled } from '../shared/loc-errors';
import { campaignBadge, modeLabel } from './campaign-text';

const PAGE_SIZE = 20;
const REFRESH_MS = 5000;
const STATUSES: CampaignStatus[] = ['draft', 'sending', 'sent', 'partial', 'failed', 'cancelled'];

// Campaigns tab: every campaign with its status and progress, a status filter and the New campaign
// button. While any campaign is sending the list refreshes itself every 5 seconds.
@Component({
  selector: 'app-loc-campaigns-tab',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, RouterLink, LangPill],
  templateUrl: './campaigns-tab.html',
  styleUrl: './campaigns-tab.css',
})
export class CampaignsTab implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly hub = inject(HubStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly statuses = STATUSES;
  readonly rows = signal<LocalizedCampaignView[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly filter = signal<'all' | CampaignStatus>('all');
  readonly loading = signal(true);
  readonly error = signal('');

  readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly to = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.total());

  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private destroyed = false; // an in-flight refresh must not re-arm the timer after the tab is left

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
  }

  ngOnInit(): void {
    this.load();
  }

  badge(status: CampaignStatus): string { return campaignBadge(status); }
  mode(c: LocalizedCampaignView): string { return modeLabel(this.i18n, c.languageMode); }

  percent(c: LocalizedCampaignView): number {
    const t = c.stats.total;
    return t > 0 ? Math.min(100, Math.round(((c.stats.sent + c.stats.failed + c.stats.skipped) / t) * 100)) : 0;
  }

  load(silent = false): void {
    const seq = ++this.seq;
    clearTimeout(this.timer);
    if (!silent) {
      this.loading.set(true);
      this.error.set('');
    }
    const status = this.filter();
    this.api.listCampaigns({ status: status === 'all' ? undefined : status, page: this.page(), limit: PAGE_SIZE }).subscribe({
      next: (res) => {
        if (seq !== this.seq) return;
        this.rows.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
        this.error.set('');
        this.scheduleRefresh();
      },
      error: (err) => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        if (!silent) this.error.set(errorText(this.i18n, err));
        if (isNotEnabled(err)) this.hub.load(true);
        else this.scheduleRefresh();
      },
    });
  }

  // Auto-refresh only while something is sending; it stops by itself once nothing is.
  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    if (!this.destroyed && this.rows().some((c) => c.status === 'sending')) this.timer = setTimeout(() => this.load(true), REFRESH_MS);
  }

  setFilter(value: 'all' | CampaignStatus): void {
    if (value === this.filter()) return;
    this.filter.set(value);
    this.page.set(1);
    this.load();
  }

  goTo(page: number): void {
    this.page.set(page);
    this.load();
  }
}
