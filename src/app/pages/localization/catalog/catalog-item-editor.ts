import { ModalFocus } from '../shared/modal-focus';
import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type { AiProductSuggestion, CatalogItemRow, CatalogTranslation } from '../localization.types';

export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;

// Editor for the Arabic name/description of ONE product or service. The English
// side is read-only. "Suggest Arabic" only shows a draft; it is copied into the
// fields (and flagged source 'ai') when the merchant presses "Use this draft".
// Saved translations are drafts until a native reader marks them reviewed.
@Component({
  selector: 'app-catalog-item-editor',
  imports: [ModalFocus, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './catalog-item-editor.html',
  styleUrl: './catalog-item-editor.css',
})
export class CatalogItemEditor implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);

  readonly item = input.required<CatalogItemRow>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly nameMax = NAME_MAX;
  readonly descriptionMax = DESCRIPTION_MAX;

  readonly nameAr = signal('');
  readonly descriptionAr = signal('');
  readonly saved = signal<CatalogTranslation | null>(null);
  readonly aiApplied = signal(false);
  readonly saving = signal(false);
  readonly reviewing = signal(false);
  readonly suggesting = signal(false);
  readonly draft = signal<AiProductSuggestion | null>(null);
  readonly error = signal('');
  readonly aiError = signal('');
  readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly dirty = computed(() => {
    const s = this.saved();
    return this.nameAr() !== (s?.name ?? '') || this.descriptionAr() !== (s?.description ?? '');
  });
  readonly canSave = computed(() => this.nameAr().trim().length > 0 && this.dirty() && !this.saving() && !this.reviewing());
  readonly canReview = computed(() => !!this.saved() && !this.dirty() && !this.saving() && !this.reviewing());
  readonly isReviewed = computed(() => this.saved()?.status === 'reviewed');

  ngOnInit(): void {
    const tr = this.item().translation;
    this.saved.set(tr);
    this.nameAr.set(tr?.name ?? '');
    this.descriptionAr.set(tr?.description ?? '');
    setTimeout(() => this.dialog()?.nativeElement.focus());
  }

  onName(value: string): void {
    this.nameAr.set(value);
  }

  onDescription(value: string): void {
    this.descriptionAr.set(value);
  }

  suggest(): void {
    if (this.suggesting()) return;
    const it = this.item();
    this.suggesting.set(true);
    this.aiError.set('');
    this.draft.set(null);
    this.api.aiSuggestProductTranslation({ name: it.name, description: it.description || undefined }).subscribe({
      next: (res) => {
        this.draft.set(res);
        this.suggesting.set(false);
      },
      error: (err) => {
        this.aiError.set(errorText(this.i18n, err, 'ai.failed'));
        this.suggesting.set(false);
      },
    });
  }

  useDraft(): void {
    const d = this.draft();
    if (!d) return;
    this.nameAr.set(d.name.slice(0, NAME_MAX));
    this.descriptionAr.set((d.description ?? '').slice(0, DESCRIPTION_MAX));
    this.aiApplied.set(true);
    this.draft.set(null);
  }

  discardDraft(): void {
    this.draft.set(null);
  }

  warningText(w: { code: string; detail?: Record<string, string | number> }): string {
    return this.i18n.t(`ai.warning.${w.code}`, w.detail);
  }

  save(): void {
    if (!this.canSave()) return;
    const it = this.item();
    this.saving.set(true);
    this.error.set('');
    this.api
      .saveCatalogTranslation(it.kind, it.refId, {
        name: this.nameAr().trim(),
        description: this.descriptionAr().trim(),
        source: this.aiApplied() ? 'ai' : 'merchant',
      })
      .subscribe({
        next: (tr) => {
          this.saving.set(false);
          this.saved.set(tr);
          this.nameAr.set(tr.name);
          this.descriptionAr.set(tr.description ?? '');
          this.aiApplied.set(false);
          this.ui.toast(this.i18n.t('catalog.editor.savedDraft'), 'success');
          this.changed.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(errorText(this.i18n, err));
        },
      });
  }

  async toggleReview(): Promise<void> {
    const current = this.saved();
    if (!current || !this.canReview()) return;
    const next = current.status === 'reviewed' ? 'draft' : 'reviewed';
    const ok = await this.ui.confirm({
      title: this.i18n.t(next === 'reviewed' ? 'catalog.review.confirmTitle' : 'catalog.review.revertTitle'),
      message: this.i18n.t(next === 'reviewed' ? 'catalog.review.confirm' : 'catalog.review.revert'),
      confirmLabel: this.i18n.t(next === 'reviewed' ? 'catalog.review.mark' : 'catalog.review.unmark'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    const it = this.item();
    this.reviewing.set(true);
    this.error.set('');
    this.api.reviewCatalogTranslation(it.kind, it.refId, next).subscribe({
      next: (tr) => {
        this.reviewing.set(false);
        this.saved.set(tr);
        this.ui.toast(this.i18n.t(next === 'reviewed' ? 'catalog.review.doneReviewed' : 'catalog.review.doneDraft'), 'success');
        this.changed.emit();
      },
      error: (err) => {
        this.reviewing.set(false);
        this.error.set(errorText(this.i18n, err));
      },
    });
  }
}
