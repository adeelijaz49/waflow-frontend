import { ModalFocus } from '../shared/modal-focus';
import { Component, ElementRef, OnInit, computed, inject, output, signal, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type { CatalogImportResult } from '../localization.types';

const OUTCOME_BADGE: Record<string, string> = {
  updated: 'badge-success',
  unchanged: 'badge-neutral',
  unmatched: 'badge-warning',
  ambiguous: 'badge-warning',
  invalid_language: 'badge-danger',
  invalid_phone: 'badge-danger',
  duplicate: 'badge-warning',
  protected: 'badge-info',
};

// Modal for the Arabic-names CSV import: choose file, dry run (nothing changes),
// then apply only after an explicit confirmation.
@Component({
  selector: 'app-catalog-import-dialog',
  imports: [ModalFocus, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './catalog-import-dialog.html',
  styleUrl: './catalog-import-dialog.css',
})
export class CatalogImportDialog implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);

  readonly columns = 'kind,id,name,name_ar,description_ar';
  readonly closed = output<void>();
  readonly applied = output<void>();

  readonly file = signal<File | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<CatalogImportResult | null>(null);
  readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly ambiguous = computed(() => this.result()?.rows.filter((r) => r.outcome === 'ambiguous').length ?? 0);

  ngOnInit(): void {
    setTimeout(() => this.dialog()?.nativeElement.focus());
  }

  badge(outcome: string): string {
    return OUTCOME_BADGE[outcome] ?? 'badge-neutral';
  }

  outcomeLabel(outcome: string): string {
    const key = `catalog.import.outcome.${outcome}`;
    return this.i18n.has(key) ? this.i18n.t(key) : outcome;
  }

  pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    this.result.set(null);
    this.error.set('');
  }

  reset(): void {
    this.file.set(null);
    this.result.set(null);
    this.error.set('');
  }

  check(): void {
    const file = this.file();
    if (!file || this.busy()) return;
    this.run(file, true);
  }

  async apply(): Promise<void> {
    const file = this.file();
    const res = this.result();
    if (!file || !res || !res.dryRun || this.busy()) return;
    const ok = await this.ui.confirm({
      title: this.i18n.t('catalog.import.applyTitle'),
      message: this.i18n.tp('catalog.import.applyConfirm', res.summary.updated),
      confirmLabel: this.i18n.t('catalog.import.apply'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.run(file, false);
  }

  private run(file: File, dryRun: boolean): void {
    this.busy.set(true);
    this.error.set('');
    this.api.importCatalogCsv(file, dryRun).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.result.set(res);
        if (!dryRun) this.applied.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(errorText(this.i18n, err));
      },
    });
  }
}
