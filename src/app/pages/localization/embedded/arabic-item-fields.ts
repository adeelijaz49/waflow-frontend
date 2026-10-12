import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { DialogService } from '../../../shared/dialog.service';
import type { CatalogKind, CatalogTranslation } from '../localization.types';
import { errorCode, errorStatus } from '../shared/loc-errors';
import { EmbeddedText } from './embedded-text';

export const ITEM_NAME_MAX = 200;
export const ITEM_DESCRIPTION_MAX = 2000;

type LoadState = 'loading' | 'ready' | 'hidden' | 'error';

// Optional Arabic name + description inside the EXISTING product and service forms, shown to FLAGGED
// merchants only (the host page wraps it in an @if). Its state lives in its own signals, never in the
// page's `form` object, so the existing save payload is untouched. The page calls `commit(id)` AFTER the
// main save succeeded: nothing typed -> no request; otherwise ONE PUT of the Arabic draft. A failure of
// that call (or the missing-name case) only shows a warning dialog, it never rolls back or blocks the
// save the merchant just made. Saved Arabic text is always a draft until a native reader reviews it.
@Component({
  selector: 'app-arabic-item-fields',
  imports: [RouterLink],
  templateUrl: './arabic-item-fields.html',
  styleUrl: './arabic-item-fields.css',
})
export class ArabicItemFields extends EmbeddedText {
  private readonly api = inject(LocalizationApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<CatalogKind>();
  // null while the item is being created (nothing to load yet).
  readonly refId = input<string | null>(null);

  readonly nameMax = ITEM_NAME_MAX;
  readonly descriptionMax = ITEM_DESCRIPTION_MAX;

  readonly name = signal('');
  readonly description = signal('');
  readonly saved = signal<CatalogTranslation | null>(null);
  readonly state = signal<LoadState>('ready');

  readonly nameId = computed(() => `aif-name-${this.kind()}`);
  readonly descriptionId = computed(() => `aif-desc-${this.kind()}`);
  // True when the merchant typed something different from what is stored (or anything, for a new item).
  readonly dirty = computed(() => {
    const s = this.saved();
    return this.name().trim() !== (s?.name ?? '').trim() || this.description().trim() !== (s?.description ?? '').trim();
  });

  private seq = 0;

  constructor() {
    super();
    effect(() => {
      const id = this.refId();
      const kind = this.kind();
      untracked(() => this.load(kind, id));
    });
  }

  onName(value: string): void {
    this.name.set(value);
  }

  onDescription(value: string): void {
    this.description.set(value);
  }

  retry(): void {
    this.load(this.kind(), this.refId());
  }

  private load(kind: CatalogKind, id: string | null): void {
    const seq = ++this.seq;
    this.saved.set(null);
    this.name.set('');
    this.description.set('');
    if (!id) {
      this.state.set('ready');
      return;
    }
    this.state.set('loading');
    this.api.getCatalogTranslation(kind, id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (seq !== this.seq) return;
        const tr = res?.translation ?? null;
        this.saved.set(tr);
        this.name.set(tr?.name ?? '');
        this.description.set(tr?.description ?? '');
        this.state.set('ready');
      },
      error: (err: unknown) => {
        if (seq !== this.seq) return;
        const status = errorStatus(err);
        this.state.set(status === 402 || status === 404 || errorCode(err) === 'ARABIC_NOT_ENABLED' ? 'hidden' : 'error');
      },
    });
  }

  // Called by the host page after its own save succeeded. Resolves true when there was nothing to do or
  // the Arabic draft was stored, false when a warning was shown instead. Never throws, never blocks the host.
  async commit(refId: string | null | undefined): Promise<boolean> {
    // Everything is read synchronously: the host closes its modal (destroying this component) right after.
    const kind = this.kind();
    const name = this.name().trim();
    const description = this.description().trim();
    const needsSave = this.state() === 'ready' && this.dirty();
    const id = refId || null;
    if (!id || !needsSave) return true;
    try {
      if (!name) {
        // Only a description (a stored name can never be cleared from here): the draft needs a name first.
        if (description) void this.dialog.warn(this.t('embedded.itemFields.needName'));
        return !description;
      }
      await new Promise<void>((resolve, reject) => {
        this.api.saveCatalogTranslation(kind, id, { name, description, source: 'merchant' }).subscribe({
          next: () => resolve(),
          error: (err: unknown) => reject(err),
        });
      });
      return true;
    } catch (err) {
      console.warn('[localization] Arabic text was not saved', err);
      void this.dialog.warn(this.t(`embedded.itemFields.saveFailed.${kind}`));
      return false;
    }
  }
}
