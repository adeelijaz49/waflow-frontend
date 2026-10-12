import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang, isLang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import { AiLanguagePref, BilingualOrder, MyLanguagePrefs, OverviewSummary } from '../localization.types';
import { errorText } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import { WaPreview } from '../shared/wa-preview';

export interface ChecklistStep {
  n: number;
  titleKey: string;
  noteKey?: string;
  done: boolean;
  link: string | null; // null = the language card on this page
}

// Landing tab of the Arabic hub: workspace language settings, the signed-in
// user's own preferences, a numbers-at-a-glance panel and a get-started list.
@Component({
  selector: 'app-loc-overview',
  imports: [RouterLink, WaPreview, ...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './overview.html',
  styleUrl: './overview.css',
})
export class Overview {
  readonly i18n = inject(I18nService);
  readonly hub = inject(HubStateService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly destroyRef = inject(DestroyRef);

  // Workspace settings form (seeded from the hub's already-loaded settings).
  readonly defaultLang = signal<Lang>(this.hub.settings()?.defaultCustomerLanguage ?? 'en');
  readonly order = signal<BilingualOrder>(this.hub.settings()?.bilingualOrder ?? 'ar_first');
  readonly saving = signal(false);
  readonly savedOnce = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly dirty = computed(() => {
    const s = this.hub.settings();
    return !!s && (s.defaultCustomerLanguage !== this.defaultLang() || s.bilingualOrder !== this.order());
  });

  // Personal preferences.
  readonly prefs = signal<MyLanguagePrefs | null>(null);
  readonly prefsError = signal<string | null>(null);
  readonly prefsSaving = signal(false);
  readonly prefsSaved = signal(false);

  // Overview numbers.
  readonly overview = signal<OverviewSummary | null>(null);
  readonly overviewLoading = signal(true);
  readonly overviewError = signal<string | null>(null);

  readonly sampleBody = computed(() => {
    const ar = this.i18n.t('settings.sample.bodyAr', undefined, 'ar');
    const en = this.i18n.t('settings.sample.bodyEn', undefined, 'en');
    return this.order() === 'ar_first' ? `${ar}\n\n${en}` : `${en}\n\n${ar}`;
  });

  readonly customerBar = computed(() => {
    const c = this.overview()?.customers;
    return c ? [{ key: 'en', n: c.en }, { key: 'ar', n: c.ar }, { key: 'unknown', n: c.unknown }] : [];
  });

  readonly reviewTotal = computed(() => {
    const r = this.overview()?.review;
    return r ? r.templatesDraft + r.catalogDraft + r.backendStringsDraft : 0;
  });

  readonly steps = computed<ChecklistStep[]>(() => {
    const o = this.overview();
    const s = this.hub.settings();
    if (!o) return [];
    const t = o.templates;
    return [
      { n: 1, titleKey: 'settings.steps.1', done: this.savedOnce() || s?.defaultCustomerLanguage === 'ar', link: null },
      { n: 2, titleKey: 'settings.steps.2', done: o.customers.ar > 0, link: 'customers' },
      { n: 3, titleKey: 'settings.steps.3', done: t.withArabic > 0, link: 'templates' },
      {
        n: 4, titleKey: 'settings.steps.4', noteKey: 'settings.steps.4note', link: 'templates',
        done: t.arabicApproved + t.arabicPending + t.arabicRejected > 0,
      },
      { n: 5, titleKey: 'settings.steps.5', done: t.withArabic > 0 && o.review.templatesDraft === 0, link: 'review' },
      { n: 6, titleKey: 'settings.steps.6', done: o.campaigns.total > 0, link: 'campaigns' },
    ];
  });

  constructor() {
    this.loadOverview();
    this.loadPrefs();
  }

  loadOverview(): void {
    this.overviewLoading.set(true);
    this.overviewError.set(null);
    this.api.getOverview().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (o) => {
        this.overview.set(o);
        this.overviewLoading.set(false);
      },
      error: (err: unknown) => {
        this.overviewError.set(errorText(this.i18n, err));
        this.overviewLoading.set(false);
      },
    });
  }

  loadPrefs(): void {
    this.prefsError.set(null);
    this.api.getMyPrefs().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => this.prefs.set(p),
      error: (err: unknown) => this.prefsError.set(errorText(this.i18n, err)),
    });
  }

  onDefaultLang(value: string): void {
    if (isLang(value)) this.defaultLang.set(value);
  }

  onOrder(value: string): void {
    if (value === 'ar_first' || value === 'en_first') this.order.set(value);
  }

  saveSettings(): void {
    if (this.saving() || !this.dirty()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.api.updateSettings({ defaultCustomerLanguage: this.defaultLang(), bilingualOrder: this.order() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.hub.update(s);
          this.saving.set(false);
          this.savedOnce.set(true);
          this.ui.toast(this.i18n.t('common.saved'), 'success');
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.saveError.set(errorText(this.i18n, err));
        },
      });
  }

  // Flips the page live, then remembers it as the user's own screen language.
  async onScreenLang(value: string): Promise<void> {
    if (!isLang(value)) return;
    await this.i18n.use(value);
    this.savePrefs({ uiLanguage: value });
  }

  onAiLang(value: string): void {
    if (value === 'auto' || value === 'en' || value === 'ar') this.savePrefs({ aiLanguage: value as AiLanguagePref });
  }

  private savePrefs(patch: { uiLanguage?: Lang; aiLanguage?: AiLanguagePref }): void {
    this.prefsSaving.set(true);
    this.prefsSaved.set(false);
    this.prefsError.set(null);
    this.api.updateMyPrefs(patch).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => {
        this.prefs.set(p);
        this.prefsSaving.set(false);
        this.prefsSaved.set(true);
      },
      error: (err: unknown) => {
        this.prefsSaving.set(false);
        this.prefsError.set(errorText(this.i18n, err));
      },
    });
  }

  focusAndScroll(el: HTMLElement): void {
    el.scrollIntoView?.({ block: 'center' });
    el.focus();
  }
}
