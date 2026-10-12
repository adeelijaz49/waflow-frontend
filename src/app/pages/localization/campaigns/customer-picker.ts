import { Component, DestroyRef, OnInit, computed, inject, input, model, signal } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CustomerLanguageRow } from '../localization.types';
import { LangPill } from '../shared/lang-pill';
import { errorText } from '../shared/loc-errors';
import { MAX_CUSTOMER_IDS } from './campaign-text';

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 300;

// Searchable, paginated customer picker for the "Choose customers" audience. The selection is a list
// of ids that survives paging and searching; it is capped (the server accepts at most 2000 ids).
@Component({
  selector: 'app-campaign-customer-picker',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, LangPill],
  templateUrl: './customer-picker.html',
  styleUrl: './customer-picker.css',
})
export class CustomerPicker implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  readonly selected = model<string[]>([]);
  readonly max = input(MAX_CUSTOMER_IDS);

  readonly rows = signal<CustomerLanguageRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal('');

  readonly selectedSet = computed(() => new Set(this.selected()));
  readonly atCap = computed(() => this.selected().length >= this.max());
  readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1));
  readonly to = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.total());
  readonly allOnPage = computed(() => this.rows().length > 0 && this.rows().every((r) => this.selectedSet().has(r.id)));

  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set('');
    const search = this.search().trim();
    this.api.listCustomers({ search: search || undefined, page: this.page(), limit: PAGE_SIZE }).subscribe({
      next: (res) => {
        if (seq !== this.seq) return;
        this.rows.set(res.items);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: (err) => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        this.error.set(errorText(this.i18n, err));
      },
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  goTo(page: number): void {
    this.page.set(page);
    this.load();
  }

  isDisabled(id: string): boolean {
    return this.atCap() && !this.selectedSet().has(id);
  }

  toggle(id: string): void {
    const current = this.selected();
    if (current.includes(id)) this.selected.set(current.filter((x) => x !== id));
    else if (current.length < this.max()) this.selected.set([...current, id]);
  }

  togglePage(): void {
    const ids = this.rows().map((r) => r.id);
    if (this.allOnPage()) {
      const drop = new Set(ids);
      this.selected.set(this.selected().filter((x) => !drop.has(x)));
      return;
    }
    const next = [...this.selected()];
    for (const id of ids) {
      if (next.length >= this.max()) break;
      if (!next.includes(id)) next.push(id);
    }
    this.selected.set(next);
  }

  clear(): void {
    this.selected.set([]);
  }
}
