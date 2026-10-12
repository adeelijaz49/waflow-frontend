import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText, isNotEnabled } from '../shared/loc-errors';
import type { CatalogItemRow, CatalogKind } from '../localization.types';
import { CatalogImportDialog } from './catalog-import-dialog';
import { CatalogItemEditor } from './catalog-item-editor';
import { saveBlob } from './download';

export type KindFilter = 'all' | CatalogKind;
export type StatusFilter = 'all' | 'missing' | 'draft' | 'reviewed';
type Counts = { missing: number; draft: number; reviewed: number };

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

// "Products & services" tab: Arabic names and descriptions for catalogue items.
// Nothing is ever translated automatically; AI suggestions are drafts the
// merchant must apply, save, and a native reader must mark reviewed.
@Component({
  selector: 'app-loc-catalog-tab',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, CatalogImportDialog, CatalogItemEditor],
  templateUrl: './catalog-tab.html',
  styleUrl: './catalog-tab.css',
})
export class CatalogTab implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly hub = inject(HubStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kinds: KindFilter[] = ['all', 'product', 'service'];
  readonly statuses: StatusFilter[] = ['all', 'missing', 'draft', 'reviewed'];

  readonly rows = signal<CatalogItemRow[]>([]);
  readonly counts = signal<Counts>({ missing: 0, draft: 0, reviewed: 0 });
  readonly total = signal(0);
  readonly page = signal(1);
  readonly kind = signal<KindFilter>('all');
  readonly status = signal<StatusFilter>('all');
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly showImport = signal(false);
  readonly editing = signal<CatalogItemRow | null>(null);

  readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly to = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.total());

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
  }

  ngOnInit(): void {
    this.load();
  }

  count(status: StatusFilter): number {
    const c = this.counts();
    return status === 'all' ? c.missing + c.draft + c.reviewed : c[status];
  }

  stateOf(row: CatalogItemRow): 'missing' | 'draft' | 'reviewed' {
    return row.translation ? row.translation.status : 'missing';
  }

  load(): void {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set('');
    const search = this.search().trim();
    this.api.listCatalogItems({ kind: this.kind(), search: search || undefined, status: this.status(), page: this.page(), limit: PAGE_SIZE }).subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.rows.set(res.items);
        this.total.set(res.total);
        this.counts.set(res.counts);
        this.loading.set(false);
      },
      error: (err) => {
        if (seq !== this.requestSeq) return;
        this.loading.set(false);
        this.error.set(errorText(this.i18n, err));
        if (isNotEnabled(err)) this.hub.load(true);
      },
    });
  }

  setKind(kind: KindFilter): void {
    if (kind === this.kind()) return;
    this.kind.set(kind);
    this.page.set(1);
    this.load();
  }

  setStatus(status: StatusFilter): void {
    if (status === this.status()) return;
    this.status.set(status);
    this.page.set(1);
    this.load();
  }

  onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  exportCsv(): void {
    this.api.exportCatalogCsv().subscribe({
      next: (blob) => saveBlob(blob, 'waflow-catalog-arabic.csv'),
      error: (err) => this.ui.toast(errorText(this.i18n, err, 'catalog.export.failed'), 'error'),
    });
  }

  onChanged(): void {
    this.load();
  }

  closeEditor(): void {
    this.editing.set(null);
  }
}
