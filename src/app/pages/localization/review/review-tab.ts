import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { ReviewSummary } from '../localization.types';
import { errorText } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';

interface NsCounts { total: number; arabic: number; reviewed: number; draft: number; missing: number; needsLegal: number }
interface ScreenSummary { totals: NsCounts; namespaces: Record<string, NsCounts> }
interface Command { labelKey: string; key: string }

@Component({
  selector: 'app-loc-review-tab',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, RouterLink],
  templateUrl: './review-tab.html',
  styleUrl: './review-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewTab {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly ui = inject(LocUiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summary = signal<ReviewSummary | null>(null);
  readonly screens = signal<ScreenSummary | null>(null);

  readonly exportCommands: Command[] = [
    { labelKey: 'review.cmd.screensLabel', key: 'review.cmd.exportScreens' },
    { labelKey: 'review.cmd.backendLabel', key: 'review.cmd.exportBackend' },
  ];
  readonly importCommands: Command[] = [
    { labelKey: 'review.cmd.screensLabel', key: 'review.cmd.importScreens' },
    { labelKey: 'review.cmd.backendLabel', key: 'review.cmd.importBackend' },
  ];
  readonly columnKeys = ['col.key', 'col.english', 'col.arabic', 'col.status', 'col.reviewer', 'col.reviewedAt'].map((k) => `review.${k}`);

  readonly namespaceRows = computed(() => {
    const s = this.screens();
    return s ? Object.entries(s.namespaces).map(([name, c]) => ({ name, ...c })) : [];
  });

  readonly waiting = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return s.templates.draft + s.catalog.draft + s.backendStrings.draft + (this.screens()?.totals.draft ?? 0);
  });
  readonly reviewedTotal = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return s.templates.reviewed + s.catalog.reviewed + s.backendStrings.reviewed + (this.screens()?.totals.reviewed ?? 0);
  });
  readonly grandTotal = computed(() => this.waiting() + this.reviewedTotal());
  readonly percent = computed(() => (this.grandTotal() ? Math.round((this.reviewedTotal() / this.grandTotal()) * 100) : 0));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    void this.loadScreens();
    this.api.getReviewSummary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => { this.summary.set(s); this.loading.set(false); },
      error: (err) => { this.error.set(errorText(this.i18n, err, 'review.loadFailed')); this.loading.set(false); },
    });
  }

  // The screen-text counts ship with the app (generated file); optional and lazy.
  private async loadScreens(): Promise<void> {
    try {
      const mod = await import('../../../i18n/review-summary.json');
      const data = ((mod as { default?: unknown }).default ?? mod) as ScreenSummary;
      if (data?.totals && data.namespaces) this.screens.set(data);
    } catch {
      this.screens.set(null);
    }
  }

  async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.i18n.t(key));
      this.ui.toast(this.i18n.t('common.copied'), 'success');
    } catch {
      this.ui.toast(this.i18n.t('errors.generic'), 'error');
    }
  }
}
