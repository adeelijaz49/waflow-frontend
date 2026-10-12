import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, LocaleFormatService } from '../../../i18n';
import { isolateLtr } from '../../../i18n/bidi';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import type {
  CampaignPlan, CampaignRecipientRow, CampaignReport, LocalizedCampaignView, MessageLanguage, SendStatus,
} from '../localization.types';
import { LangPill } from '../shared/lang-pill';
import { errorText, isNotEnabled } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import {
  audienceLabel, campaignBadge, deliveryBadge, fallbackLine, lastErrorText, modeLabel, reasonText, sendBadge, sendErrorText,
  sendSummary,
} from './campaign-text';
import { PlanView } from './plan-view';

const POLL_MS = 3000;
const PAGE_SIZE = 25;
const SEND_STATUSES: SendStatus[] = [
  'queued', 'sending', 'sent', 'failed', 'skipped_no_consent', 'skipped_opted_out', 'skipped_blocked',
  'skipped_no_credit', 'skipped_demo', 'skipped_error',
];
const LANGUAGES: MessageLanguage[] = ['ar', 'en', 'bilingual'];

// Campaign detail: progress and stats (polled every 3 s while sending), the plan the campaign was
// created with, the per-language delivery report and the recipients list. Drafts are re-planned
// fresh and can be sent from here (same acknowledgements + confirmation as the composer).
@Component({
  selector: 'app-loc-campaign-detail',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, RouterLink, LangPill, PlanView],
  templateUrl: './campaign-detail.html',
  styleUrl: './campaign-detail.css',
})
export class CampaignDetail implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly ui = inject(LocUiService);
  private readonly hub = inject(HubStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly sendStatuses = SEND_STATUSES;
  readonly languages = LANGUAGES;
  readonly reportLanguages = LANGUAGES;

  readonly id = signal('');
  readonly campaign = signal<LocalizedCampaignView | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly report = signal<CampaignReport | null>(null);
  readonly recipients = signal<CampaignRecipientRow[]>([]);
  readonly recipientsTotal = signal(0);
  readonly recipientsLoading = signal(false);
  readonly recipientsError = signal('');
  readonly statusFilter = signal<'all' | SendStatus>('all');
  readonly langFilter = signal<'all' | MessageLanguage>('all');
  readonly page = signal(1);
  readonly livePlan = signal<CampaignPlan | null>(null);
  readonly planLoading = signal(false);
  readonly planError = signal('');
  readonly ackFallbacks = signal(false);
  readonly ackBlocked = signal(false);
  readonly busy = signal(false);
  readonly actionError = signal('');

  readonly isDraft = computed(() => this.campaign()?.status === 'draft');
  readonly isSending = computed(() => this.campaign()?.status === 'sending');
  readonly canCancel = computed(() => this.isDraft() || this.isSending());
  readonly processed = computed(() => {
    const s = this.campaign()?.stats;
    return s ? s.sent + s.failed + s.skipped : 0;
  });
  readonly percent = computed(() => {
    const total = this.campaign()?.stats.total ?? 0;
    return total > 0 ? Math.min(100, Math.round((this.processed() / total) * 100)) : 0;
  });
  // "57%" kept as one left-to-right unit so Arabic RTL text never flips it into "%57".
  readonly percentText = computed(() => isolateLtr(this.fmt.percent(this.percent())));
  readonly from = computed(() => (this.recipientsTotal() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly to = computed(() => Math.min(this.page() * PAGE_SIZE, this.recipientsTotal()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.recipientsTotal());
  readonly shownPlan = computed(() => (this.isDraft() ? this.livePlan() : this.campaign()?.plan ?? null));
  readonly ackFallbacksRequired = computed(() => (this.livePlan()?.fallbacks.length ?? 0) > 0);
  readonly ackBlockedRequired = computed(() => (this.livePlan()?.blocked.length ?? 0) > 0);
  readonly canSend = computed(() => {
    const plan = this.livePlan();
    if (!this.isDraft() || !plan || this.planLoading() || this.busy() || !plan.canSend) return false;
    if (this.ackFallbacksRequired() && !this.ackFallbacks()) return false;
    if (this.ackBlockedRequired() && !this.ackBlocked()) return false;
    return true;
  });
  readonly audienceText = computed(() => {
    const c = this.campaign();
    return c ? audienceLabel(this.i18n, c.audience) : '';
  });
  readonly modeText = computed(() => {
    const c = this.campaign();
    return c ? modeLabel(this.i18n, c.languageMode) : '';
  });
  // A readable sentence for the known lastError codes (template_unusable:<code>); null shows the raw text instead.
  readonly lastErrorLine = computed(() => lastErrorText(this.i18n, this.campaign()?.lastError));

  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  // A poll still in flight when the page is left must not re-arm the timer afterwards.
  private destroyed = false;
  private recipientsSeq = 0;
  private planSeq = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.pollTimer);
      this.ui.respond(false);
    });
  }

  ngOnInit(): void {
    this.id.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.load();
  }

  badge(status: Parameters<typeof campaignBadge>[0]): string { return campaignBadge(status); }
  sendBadge(status: SendStatus): string { return sendBadge(status); }
  deliveryBadge(status: string): string { return deliveryBadge(status); }
  sendError(code: string | null): string { return sendErrorText(this.i18n, code); }
  fallbackReason(code: string | null): string { return reasonText(this.i18n, code); }
  errorTitle(r: CampaignRecipientRow): string {
    return [r.errorCode, r.error].filter((x) => !!x).join(' - ');
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.getCampaign(this.id()).subscribe({
      next: (c) => {
        this.campaign.set(c);
        this.loading.set(false);
        this.afterCampaign(c);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(errorText(this.i18n, err));
        if (isNotEnabled(err)) this.hub.load(true);
      },
    });
  }

  private afterCampaign(c: LocalizedCampaignView): void {
    if (c.status === 'draft') {
      this.loadPlan(c);
    } else {
      this.loadReport();
      this.loadRecipients();
    }
    this.schedulePoll();
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    if (this.destroyed || this.campaign()?.status !== 'sending') return;
    this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
  }

  private poll(): void {
    this.api.getCampaign(this.id()).subscribe({
      next: (c) => {
        this.campaign.set(c);
        this.loadReport();
        this.loadRecipients(true);
        this.schedulePoll();
      },
      error: () => this.schedulePoll(), // a hiccup must not stop the progress updates
    });
  }

  private loadReport(): void {
    this.api.getCampaignReport(this.id()).subscribe({
      next: (r) => this.report.set(r),
      error: () => { /* the report card simply keeps its previous numbers */ },
    });
  }

  loadRecipients(silent = false): void {
    const seq = ++this.recipientsSeq;
    if (!silent) this.recipientsLoading.set(true);
    this.recipientsError.set('');
    const status = this.statusFilter();
    const language = this.langFilter();
    this.api.getCampaignRecipients(this.id(), {
      status: status === 'all' ? undefined : status,
      language: language === 'all' ? undefined : language,
      page: this.page(),
      limit: PAGE_SIZE,
    }).subscribe({
      next: (res) => {
        if (seq !== this.recipientsSeq) return;
        this.recipients.set(res.items);
        this.recipientsTotal.set(res.total);
        this.recipientsLoading.set(false);
      },
      error: (err) => {
        if (seq !== this.recipientsSeq) return;
        this.recipientsLoading.set(false);
        if (!silent) this.recipientsError.set(errorText(this.i18n, err));
      },
    });
  }

  setStatusFilter(value: string): void {
    this.statusFilter.set(value as 'all' | SendStatus);
    this.page.set(1);
    this.loadRecipients();
  }

  setLangFilter(value: string): void {
    this.langFilter.set(value as 'all' | MessageLanguage);
    this.page.set(1);
    this.loadRecipients();
  }

  goTo(page: number): void {
    this.page.set(page);
    this.loadRecipients();
  }

  // Drafts are re-planned: consent, approvals and the audience may have changed since it was saved.
  loadPlan(c: LocalizedCampaignView = this.campaign()!): void {
    const seq = ++this.planSeq;
    this.planLoading.set(true);
    this.planError.set('');
    this.ackFallbacks.set(false);
    this.ackBlocked.set(false);
    this.api.planCampaign({
      templateId: c.templateId, languageMode: c.languageMode, audience: c.audience, fieldValues: c.fieldValues,
    }).subscribe({
      next: (plan) => {
        if (seq !== this.planSeq) return;
        this.livePlan.set(plan);
        this.planLoading.set(false);
      },
      error: (err) => {
        if (seq !== this.planSeq) return;
        this.planLoading.set(false);
        this.planError.set(errorText(this.i18n, err));
        if (isNotEnabled(err)) this.hub.load(true);
      },
    });
  }

  async cancel(): Promise<void> {
    if (!this.canCancel() || this.busy()) return;
    this.busy.set(true);
    this.actionError.set('');
    const ok = await this.ui.confirm({
      title: this.i18n.t('campaigns.cancel.title'),
      message: this.i18n.t(this.isSending() ? 'campaigns.cancel.messageSending' : 'campaigns.cancel.messageDraft'),
      confirmLabel: this.i18n.t('campaigns.cancel.confirm'),
      cancelLabel: this.i18n.t('campaigns.cancel.keep'),
      danger: true,
    });
    if (!ok) {
      this.busy.set(false);
      return;
    }
    try {
      const updated = await firstValueFrom(this.api.cancelCampaign(this.id()));
      this.campaign.set(updated);
      this.ui.toast(this.i18n.t('campaigns.toast.cancelled'), 'success');
      this.afterCampaign(updated);
    } catch (err) {
      this.actionError.set(errorText(this.i18n, err));
      this.load();
    } finally {
      this.busy.set(false);
    }
  }

  // Never sends before the acknowledgements are ticked AND the user confirms; the server re-plans anyway.
  async sendDraft(): Promise<void> {
    const plan = this.livePlan();
    if (!plan || !this.canSend()) return;
    this.busy.set(true);
    this.actionError.set('');
    const message = [sendSummary(this.i18n, plan), ...plan.fallbacks.map((f) => fallbackLine(this.i18n, f))].join(' ');
    const ok = await this.ui.confirm({
      title: this.i18n.t('campaigns.confirm.title'),
      message,
      confirmLabel: this.i18n.t('campaigns.confirm.send'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) {
      this.busy.set(false);
      return;
    }
    try {
      const res = await firstValueFrom(this.api.sendCampaign(this.id(), { fallbacks: this.ackFallbacks(), blocked: this.ackBlocked() }));
      this.campaign.set(res.campaign);
      this.ui.toast(this.i18n.t('campaigns.toast.sending'), 'success');
      this.afterCampaign(res.campaign);
    } catch (err) {
      this.actionError.set(errorText(this.i18n, err));
      if (isNotEnabled(err)) this.hub.load(true);
      this.load(); // CAMPAIGN_NOT_DRAFT / a changed plan: show the real state
    } finally {
      this.busy.set(false);
    }
  }
}
