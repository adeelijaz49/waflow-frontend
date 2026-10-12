import { ModalFocus } from '../shared/modal-focus';
import { Component, ElementRef, OnInit, computed, inject, output, signal, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { errorText } from '../shared/loc-errors';
import { WaPreview } from '../shared/wa-preview';
import type { LibraryEntry, LocalizedTemplate } from '../localization.types';
import { LIBRARY_GROUP_ORDER, libraryGroupOf } from './template-utils';

interface LibraryGroup { id: string; entries: LibraryEntry[] }

// Modal that lets the merchant start from a ready-made message. Each entry is previewed in BOTH
// languages as the customer would see it; "Use this template" creates an editable copy (drafts,
// needing native review) and hands it to the parent, which opens the editor.
@Component({
  selector: 'app-loc-library-picker',
  imports: [ModalFocus, ...I18N_PIPES, ...I18N_DIRECTIVES, WaPreview],
  templateUrl: './library-picker.html',
  styleUrl: './library-picker.css',
})
export class LibraryPicker implements OnInit {
  private readonly api = inject(LocalizationApiService);
  readonly i18n = inject(I18nService);

  readonly closed = output<void>();
  readonly created = output<LocalizedTemplate>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly items = signal<LibraryEntry[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly selectedKey = signal<string | null>(null);
  readonly busy = signal(false);
  readonly createError = signal<string | null>(null);

  readonly groups = computed<LibraryGroup[]>(() => {
    const byGroup = new Map<string, LibraryEntry[]>();
    for (const e of this.items()) {
      const g = libraryGroupOf(e.useCase);
      byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
    }
    return LIBRARY_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ id: g, entries: byGroup.get(g) ?? [] }));
  });
  readonly selected = computed(() => this.items().find((e) => e.key === this.selectedKey()) ?? null);

  ngOnInit(): void {
    queueMicrotask(() => this.dialog()?.nativeElement.focus());
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getTemplateLibrary().subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.selectedKey.set(r.items?.[0]?.key ?? null);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorText(this.i18n, err, 'templates.library.loadFailed'));
        this.loading.set(false);
      },
    });
  }

  entryName(e: LibraryEntry): string {
    return e.name[this.i18n.lang()] || e.name.en;
  }

  select(key: string): void {
    this.selectedKey.set(key);
    this.createError.set(null);
  }

  use(): void {
    const entry = this.selected();
    if (!entry || this.busy()) return;
    this.busy.set(true);
    this.createError.set(null);
    this.api.createTemplateFromLibrary(entry.key).subscribe({
      next: (t) => {
        this.busy.set(false);
        this.created.emit(t);
      },
      error: (err) => {
        this.createError.set(errorText(this.i18n, err));
        this.busy.set(false);
      },
    });
  }
}
