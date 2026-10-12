import { ModalFocus } from '../shared/modal-focus';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { ApprovalBadge } from '../shared/approval-badge';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type {
  LocalizedTemplate, MessageLanguage, TemplateCategory, TemplateUseCase, TemplateVariant, TemplatesUsage,
} from '../localization.types';
import { LibraryPicker } from './library-picker';
import { LANGUAGES, USE_CASES, isTransactionalUseCase } from './template-utils';

// Templates list (/arabic/templates): every template with a compact language matrix (one approval
// badge per language version), the WhatsApp template-slot meter, filters, the library picker and a
// "new template" form. Nothing is ever deleted: archive/restore only.
@Component({
  selector: 'app-loc-templates-tab',
  imports: [ModalFocus, RouterLink, ApprovalBadge, LibraryPicker, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './templates-tab.html',
  styleUrl: './templates-tab.css',
})
export class TemplatesTab implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(I18nService);

  readonly languages = LANGUAGES;
  readonly useCases = USE_CASES;

  readonly items = signal<LocalizedTemplate[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');
  readonly useCase = signal<TemplateUseCase | ''>('');
  readonly showArchived = signal(false);
  readonly usage = signal<TemplatesUsage | null>(null);
  readonly usageFailed = signal(false);
  readonly refreshing = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly showLibrary = signal(false);
  readonly showNew = signal(false);
  readonly newName = signal('');
  readonly newUseCase = signal<TemplateUseCase>('custom');
  readonly newCategory = signal<TemplateCategory>('MARKETING');
  readonly newBusy = signal(false);
  readonly newError = signal<string | null>(null);

  private readonly reload$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  readonly usagePercent = computed(() => {
    const u = this.usage();
    return u && u.used !== null && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
  });
  readonly ceilingPercent = computed(() => {
    const u = this.usage();
    return u && u.limit ? Math.min(100, Math.round((u.ceiling / u.limit) * 100)) : 0;
  });
  readonly filtersActive = computed(() => !!(this.search().trim() || this.useCase() || this.showArchived()));
  // Utility is only a choice for the transactional use cases; every other use case is always sent as Marketing.
  readonly newUtilityAllowed = computed(() => isTransactionalUseCase(this.newUseCase()));
  readonly newCategoryHint = computed(() =>
    !this.newUtilityAllowed() ? 'templates.category.alwaysMarketing'
      : this.newCategory() === 'MARKETING' ? 'templates.category.hintMarketing' : 'templates.category.hintUtility');

  constructor() {
    this.reload$
      .pipe(
        switchMap(() =>
          this.api
            .listTemplates({ search: this.search().trim() || undefined, useCase: this.useCase() || undefined, archived: this.showArchived() })
            .pipe(catchError((err: unknown) => of({ failed: err }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if ('failed' in result) {
          this.loadError.set(errorText(this.i18n, result.failed, 'templates.loadFailed'));
        } else {
          this.items.set(result.items ?? []);
          this.loadError.set(null);
        }
        this.loading.set(false);
      });
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload$.next());
  }

  ngOnInit(): void {
    this.reload$.next();
    this.loadUsage();
  }

  reload(): void {
    this.loading.set(this.items().length === 0);
    this.reload$.next();
  }

  loadUsage(): void {
    this.api.getTemplatesUsage().subscribe({
      next: (u) => {
        this.usage.set(u);
        this.usageFailed.set(false);
      },
      error: () => this.usageFailed.set(true),
    });
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.search$.next(value);
  }

  onUseCase(value: string): void {
    this.useCase.set(value as TemplateUseCase | '');
    this.reload();
  }

  onShowArchived(checked: boolean): void {
    this.showArchived.set(checked);
    this.reload();
  }

  variantOf(t: LocalizedTemplate, language: MessageLanguage): TemplateVariant | undefined {
    return t.variants.find((v) => v.language === language);
  }

  open(t: LocalizedTemplate, lang?: MessageLanguage): void {
    void this.router.navigate(['/arabic/templates', t.id], lang ? { queryParams: { lang } } : {});
  }

  refreshStatuses(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.actionError.set(null);
    this.api.refreshTemplateStatuses().subscribe({
      next: (r) => {
        this.refreshing.set(false);
        this.ui.toast(this.i18n.t('templates.refreshed', { checked: r.checked, changed: r.changed }), 'success');
        this.reload();
        this.loadUsage();
      },
      error: (err) => {
        this.refreshing.set(false);
        this.actionError.set(errorText(this.i18n, err));
      },
    });
  }

  async toggleArchive(t: LocalizedTemplate): Promise<void> {
    const restoring = t.archived;
    const base = restoring ? 'templates.unarchive' : 'templates.archive';
    const ok = await this.ui.confirm({
      title: this.i18n.t(`${base}.confirmTitle`),
      message: this.i18n.t(`${base}.confirmMessage`, { name: t.name }),
      confirmLabel: this.i18n.t(base),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.busyId.set(t.id);
    this.actionError.set(null);
    this.api.archiveTemplate(t.id, !restoring).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.items.update((list) => (updated.archived && !this.showArchived() ? list.filter((x) => x.id !== t.id) : list.map((x) => (x.id === t.id ? updated : x))));
        this.ui.toast(this.i18n.t(restoring ? 'templates.unarchivedDone' : 'templates.archivedDone'), 'success');
      },
      error: (err) => {
        this.busyId.set(null);
        this.actionError.set(errorText(this.i18n, err));
      },
    });
  }

  openLibrary(): void {
    this.showLibrary.set(true);
  }

  onLibraryCreated(t: LocalizedTemplate): void {
    this.showLibrary.set(false);
    this.open(t);
  }

  openNew(): void {
    this.newName.set('');
    this.newUseCase.set('custom');
    this.newCategory.set('MARKETING');
    this.newError.set(null);
    this.showNew.set(true);
  }

  onNewUseCase(value: string): void {
    const useCase = value as TemplateUseCase;
    this.newUseCase.set(useCase);
    if (!isTransactionalUseCase(useCase)) this.newCategory.set('MARKETING');
  }

  createNew(): void {
    const name = this.newName().trim();
    if (!name) {
      this.newError.set(this.i18n.t('templates.new.nameRequired'));
      return;
    }
    if (this.newBusy()) return;
    this.newBusy.set(true);
    this.newError.set(null);
    this.api.createTemplate({ name, useCase: this.newUseCase(), category: this.newCategory() }).subscribe({
      next: (t) => {
        this.newBusy.set(false);
        this.showNew.set(false);
        this.open(t);
      },
      error: (err) => {
        this.newBusy.set(false);
        this.newError.set(errorText(this.i18n, err));
      },
    });
  }
}
