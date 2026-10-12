import { ModalFocus } from '../shared/modal-focus';
import { Component, ElementRef, OnInit, inject, output, signal, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type { ImportOutcome, LanguageImportResult } from '../localization.types';
import { saveBlob } from './download';

const OUTCOME_BADGE: Record<ImportOutcome, string> = {
  updated: 'badge-success',
  unchanged: 'badge-neutral',
  unmatched: 'badge-warning',
  invalid_language: 'badge-danger',
  invalid_phone: 'badge-danger',
  duplicate: 'badge-warning',
  protected: 'badge-info',
};

// Modal for the bulk CSV language import: choose file, dry run (nothing changes),
// then apply only after an explicit confirmation.
@Component({
  selector: 'app-customers-import-dialog',
  imports: [ModalFocus, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.css',
})
export class CustomersImportDialog implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);

  readonly closed = output<void>();
  readonly applied = output<void>();

  readonly file = signal<File | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<LanguageImportResult | null>(null);
  readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  ngOnInit(): void {
    setTimeout(() => this.dialog()?.nativeElement.focus());
  }

  badge(outcome: ImportOutcome): string {
    return OUTCOME_BADGE[outcome];
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
      title: this.i18n.t('customers.import.applyTitle'),
      message: this.i18n.tp('customers.import.applyConfirm', res.summary.updated),
      confirmLabel: this.i18n.t('customers.import.apply'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.run(file, false);
  }

  template(): void {
    this.api.languageTemplateCsv().subscribe({
      next: (blob) => saveBlob(blob, 'waflow-customer-languages-template.csv'),
      error: (err) => this.error.set(errorText(this.i18n, err, 'customers.export.failed')),
    });
  }

  private run(file: File, dryRun: boolean): void {
    this.busy.set(true);
    this.error.set('');
    this.api.importCustomerLanguages(file, dryRun).subscribe({
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
