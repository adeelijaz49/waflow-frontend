import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText, isNotEnabled } from '../shared/loc-errors';
import type { CustomerLang, CustomerLanguageCounts, CustomerLanguageRow } from '../localization.types';
import { CustomersImportDialog } from './import-dialog';
import { saveBlob } from './download';

export type LangFilter = 'all' | CustomerLang;
type RowState = 'saving' | 'saved' | 'error';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const BULK_LIMIT = 1000;
const EMPTY_COUNTS: CustomerLanguageCounts = { en: 0, ar: 0, unknown: 0, total: 0 };

// "Customer languages" tab: see and change the language each customer gets
// WhatsApp messages in (one at a time, in bulk, or from a CSV file).
@Component({
  selector: 'app-loc-customers-tab',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, CustomersImportDialog],
  templateUrl: './customers-tab.html',
  styleUrl: './customers-tab.css',
})
export class CustomersTab implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly hub = inject(HubStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters: LangFilter[] = ['all', 'en', 'ar', 'unknown'];
  readonly languages: CustomerLang[] = ['en', 'ar', 'unknown'];

  readonly rows = signal<CustomerLanguageRow[]>([]);
  readonly counts = signal<CustomerLanguageCounts>(EMPTY_COUNTS);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly filter = signal<LangFilter>('all');
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly rowStates = signal<Record<string, RowState>>({});
  readonly bulkBusy = signal(false);
  readonly showImport = signal(false);

  readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly to = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.total());
  readonly allSelected = computed(() => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.id)));

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
  }

  ngOnInit(): void {
    this.load();
  }

  count(filter: LangFilter): number {
    const c = this.counts();
    return filter === 'all' ? c.total : c[filter];
  }

  load(): void {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set('');
    const language = this.filter();
    const search = this.search().trim();
    this.api.listCustomers({ language, search: search || undefined, page: this.page(), limit: PAGE_SIZE }).subscribe({
      next: (res) => {
        if (seq !== this.requestSeq) return;
        this.rows.set(res.items);
        this.total.set(res.total);
        this.counts.set(res.counts);
        this.selected.set(new Set());
        this.rowStates.set({});
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

  setFilter(filter: LangFilter): void {
    if (filter === this.filter()) return;
    this.filter.set(filter);
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

  toggleRow(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((r) => r.id)));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  // "+966 50 000 0119" for Saudi mobiles, "+<digits>" for anything else.
  phoneText(raw: string): string {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return String(raw ?? '');
    const sa = /^966(5\d)(\d{3})(\d{4})$/.exec(digits);
    return sa ? `+966 ${sa[1]} ${sa[2]} ${sa[3]}` : `+${digits}`;
  }

  langLabel(lang: CustomerLang): string {
    return this.i18n.t(`status.language.${lang}`);
  }

  private setRowState(id: string, state: RowState | null): void {
    this.rowStates.update((m) => {
      const next = { ...m };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }

  changeLanguage(row: CustomerLanguageRow, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const language = select.value as CustomerLang;
    if (language === row.language) return;
    const previous = row.language;
    this.setRowState(row.id, 'saving');
    this.api.setCustomerLanguage(row.id, language).subscribe({
      next: (updated) => {
        this.rows.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
        this.counts.update((c) => ({ ...c, [previous]: Math.max(0, c[previous] - 1), [updated.language]: c[updated.language] + 1 }));
        this.setRowState(row.id, 'saved');
      },
      error: (err) => {
        select.value = previous;
        this.setRowState(row.id, 'error');
        this.ui.toast(errorText(this.i18n, err), 'error');
        if (isNotEnabled(err)) this.hub.load(true);
      },
    });
  }

  async bulkSet(language: CustomerLang): Promise<void> {
    const ids = [...this.selected()];
    if (!ids.length || this.bulkBusy()) return;
    if (ids.length > BULK_LIMIT) {
      this.ui.toast(this.i18n.t('customers.bulk.limit', { limit: BULK_LIMIT }), 'error');
      return;
    }
    const ok = await this.ui.confirm({
      title: this.i18n.t('customers.bulk.confirmTitle'),
      message: this.i18n.tp('customers.bulk.confirm', ids.length, { language: this.langLabel(language) }),
      confirmLabel: this.i18n.t('common.confirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.bulkBusy.set(true);
    this.api.bulkSetCustomerLanguage(ids, language).subscribe({
      next: (res) => {
        this.bulkBusy.set(false);
        this.ui.toast(this.i18n.tp('customers.bulk.done', res.updated), 'success');
        this.load();
      },
      error: (err) => {
        this.bulkBusy.set(false);
        this.ui.toast(errorText(this.i18n, err), 'error');
      },
    });
  }

  exportCsv(): void {
    this.api.exportCustomerLanguagesCsv().subscribe({
      next: (blob) => saveBlob(blob, 'waflow-customer-languages.csv'),
      error: (err) => this.ui.toast(errorText(this.i18n, err, 'customers.export.failed'), 'error'),
    });
  }

  downloadTemplate(): void {
    this.api.languageTemplateCsv().subscribe({
      next: (blob) => saveBlob(blob, 'waflow-customer-languages-template.csv'),
      error: (err) => this.ui.toast(errorText(this.i18n, err, 'customers.export.failed'), 'error'),
    });
  }

  onImported(): void {
    this.load();
  }
}
