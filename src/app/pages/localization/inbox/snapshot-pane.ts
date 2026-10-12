import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { InboxApiService } from '../../../services/inbox-api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { SettingsService } from '../../../shared/settings.service';
import { errorText } from '../shared/loc-errors';
import type { CustomerLang, InboxContext } from '../localization.types';
import { InboxLabels } from './inbox-labels';
import type { SnapshotResponse } from './inbox-types';

// Right pane: the customer snapshot with every label, status and suggestion
// localised, plus the editable customer-language selector.
@Component({
  selector: 'app-loc-snapshot-pane',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './snapshot-pane.html',
  styleUrl: './snapshot-pane.css',
})
export class SnapshotPane {
  private readonly api = inject(InboxApiService);
  private readonly locApi = inject(LocalizationApiService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);
  readonly labels = inject(InboxLabels);

  readonly customerId = input<string | null>(null);
  readonly context = input<InboxContext | null>(null);
  readonly languageChanged = output<void>();

  readonly languages: CustomerLang[] = ['en', 'ar', 'unknown'];
  readonly snapshot = signal<SnapshotResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly langSaving = signal(false);
  readonly langError = signal('');
  readonly langSaved = signal(false);

  readonly currency = computed(() => this.settings.currencySnapshot);
  readonly effectiveName = computed(() => {
    const lang = this.context()?.effectiveLanguage;
    return lang ? this.i18n.t(`status.language.${lang}`) : '';
  });
  private seq = 0;

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => {
        this.snapshot.set(null);
        this.error.set('');
        this.langError.set('');
        this.langSaved.set(false);
        if (id) this.load(id);
      });
    });
  }

  load(id: string): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    this.api.getSnapshot(id).subscribe({
      next: (res: SnapshotResponse) => {
        if (seq !== this.seq) return;
        this.snapshot.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        this.error.set(errorText(this.i18n, err, 'inbox.snap.loadFailed'));
      },
    });
  }

  retry(): void {
    const id = this.customerId();
    if (id) this.load(id);
  }

  onLanguage(event: Event): void {
    const id = this.customerId();
    const value = (event.target as HTMLSelectElement).value as CustomerLang;
    if (!id || this.langSaving()) return;
    this.langSaving.set(true);
    this.langError.set('');
    this.langSaved.set(false);
    this.locApi.setCustomerLanguage(id, value).subscribe({
      next: () => {
        this.langSaving.set(false);
        this.langSaved.set(true);
        this.languageChanged.emit();
      },
      error: (err) => {
        this.langSaving.set(false);
        this.langError.set(errorText(this.i18n, err));
      },
    });
  }
}
