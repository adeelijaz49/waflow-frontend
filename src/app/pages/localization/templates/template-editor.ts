import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { ApprovalBadge } from '../shared/approval-badge';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type { LocalizedTemplate, MessageLanguage, TemplateCategory, TemplateUseCase, TemplatesUsage, TemplateVariant } from '../localization.types';
import { LANGUAGES, USE_CASES, categoryFor, isTransactionalUseCase } from './template-utils';
import { VariantEditor } from './variant-editor';

// Template editor (/arabic/templates/:id): name, use case, category, archive, and one tab per language
// version (English | Arabic | Bilingual). The tab content (VariantEditor) owns the per-version editing,
// preview and approval; this page guards unsaved edits when switching tabs, going back or closing.
@Component({
  selector: 'app-loc-template-editor',
  imports: [ApprovalBadge, VariantEditor, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './template-editor.html',
  styleUrl: './template-editor.css',
})
export class TemplateEditor implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(I18nService);

  readonly languages = LANGUAGES;
  readonly useCases = USE_CASES;

  readonly template = signal<LocalizedTemplate | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly activeLang = signal<MessageLanguage>('en');
  readonly dirty = signal(false);
  readonly usage = signal<TemplatesUsage | null>(null);
  readonly nameDraft = signal('');
  readonly busy = signal(false);

  // `@for` over a one-item list so the variant editor is re-created (fresh state) on every tab switch.
  readonly activeList = computed(() => [this.activeLang()]);

  // Utility is only a choice for the transactional use cases; every other use case is always sent as Marketing.
  readonly utilityAllowed = computed(() => isTransactionalUseCase(this.template()?.useCase));
  readonly shownCategory = computed<TemplateCategory>(() => {
    const t = this.template();
    return t ? categoryFor(t.useCase, t.category) : 'MARKETING';
  });

  private templateId = '';

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.templateId = params.get('id') ?? '';
      void this.load(true);
    });
    this.api.getTemplatesUsage().subscribe({ next: (u) => this.usage.set(u), error: () => this.usage.set(null) });
  }

  async load(initial = false): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    // Arabic wording (default button labels, sample text) is needed even when the page itself is in English.
    await Promise.all([this.i18n.ensureLoaded('en'), this.i18n.ensureLoaded('ar')]).catch(() => undefined);
    this.api.getTemplate(this.templateId).subscribe({
      next: (t) => {
        this.template.set(t);
        this.nameDraft.set(t.name);
        if (initial) this.activeLang.set(this.initialLanguage(t));
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(errorText(this.i18n, err, 'templates.editor.loadFailed'));
        this.loading.set(false);
      },
    });
  }

  private initialLanguage(t: LocalizedTemplate): MessageLanguage {
    const wanted = this.route.snapshot.queryParamMap.get('lang');
    if (wanted && (LANGUAGES as readonly string[]).includes(wanted)) return wanted as MessageLanguage;
    return (LANGUAGES.find((l) => t.variants.some((v) => v.language === l)) ?? 'en') as MessageLanguage;
  }

  variantOf(language: MessageLanguage): TemplateVariant | undefined {
    return this.template()?.variants.find((v) => v.language === language);
  }

  onTemplate(t: LocalizedTemplate): void {
    this.template.set(t);
    this.nameDraft.set(t.name);
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.ui.confirm({
      title: this.i18n.t('templates.unsavedConfirmTitle'),
      message: this.i18n.t('templates.unsavedConfirmMessage'),
      confirmLabel: this.i18n.t('templates.unsavedConfirm'),
      cancelLabel: this.i18n.t('templates.unsavedKeep'),
      danger: true,
    });
  }

  async selectLanguage(lang: MessageLanguage): Promise<void> {
    if (lang === this.activeLang()) return;
    if (!(await this.confirmDiscard())) return;
    this.dirty.set(false);
    this.activeLang.set(lang);
  }

  // Arrow keys / Home / End move between the language tabs (WAI-ARIA tabs pattern); Tab leaves the tab list.
  async onTabKey(event: KeyboardEvent): Promise<void> {
    const list = this.languages;
    const rtl = this.i18n.dir() === 'rtl';
    const at = list.indexOf(this.activeLang());
    let to: number;
    if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = list.length - 1;
    else if (event.key === 'ArrowRight') to = at + (rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') to = at + (rtl ? 1 : -1);
    else return;
    event.preventDefault();
    const target = list[(to + list.length) % list.length];
    await this.selectLanguage(target);
    if (this.activeLang() === target) document.getElementById(`te-tab-${target}`)?.focus();
  }

  async onBack(event: Event): Promise<void> {
    const mouse = event as MouseEvent;
    if (mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.button > 0) return; // let the browser open a new tab
    event.preventDefault();
    if (await this.confirmDiscard()) {
      this.dirty.set(false);
      void this.router.navigate(['/arabic/templates']);
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // ── Name / use case / category / archive ─────────────────────────────────
  private update(patch: { name?: string; useCase?: TemplateUseCase; category?: TemplateCategory }, doneKey?: string): void {
    const t = this.template();
    if (!t) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.updateTemplate(t.id, patch).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.onTemplate(updated);
        if (doneKey) this.ui.toast(this.i18n.t(doneKey), 'success');
      },
      error: (err) => {
        this.busy.set(false);
        this.nameDraft.set(t.name);
        this.actionError.set(errorText(this.i18n, err, 'templates.editor.updateFailed'));
      },
    });
  }

  commitName(): void {
    const t = this.template();
    const name = this.nameDraft().trim();
    if (!t || this.busy()) return;
    if (!name) {
      this.nameDraft.set(t.name);
      return;
    }
    if (name !== t.name) this.update({ name }, 'templates.editor.nameSaved');
  }

  onUseCase(value: string): void {
    const t = this.template();
    const useCase = value as TemplateUseCase;
    if (!t || useCase === t.useCase) return;
    // Leaving the transactional use cases means the category can only be Marketing: change it in the same save.
    this.update(t.category !== 'MARKETING' && !isTransactionalUseCase(useCase) ? { useCase, category: 'MARKETING' } : { useCase });
  }

  async onCategory(select: HTMLSelectElement): Promise<void> {
    const t = this.template();
    const next = select.value as TemplateCategory;
    if (!t || next === t.category) return;
    const ok = await this.ui.confirm({
      title: this.i18n.t('templates.editor.categoryConfirmTitle'),
      message: this.i18n.t('templates.editor.categoryConfirmMessage', { category: this.i18n.t(`templates.category.${next}`) }),
      confirmLabel: this.i18n.t('templates.editor.categoryConfirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) {
      select.value = t.category;
      return;
    }
    this.update({ category: next });
  }

  async toggleArchive(): Promise<void> {
    const t = this.template();
    if (!t || this.busy()) return;
    const base = t.archived ? 'templates.unarchive' : 'templates.archive';
    const ok = await this.ui.confirm({
      title: this.i18n.t(`${base}.confirmTitle`),
      message: this.i18n.t(`${base}.confirmMessage`, { name: t.name }),
      confirmLabel: this.i18n.t(base),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.archiveTemplate(t.id, !t.archived).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.onTemplate(updated);
        this.ui.toast(this.i18n.t(updated.archived ? 'templates.archivedDone' : 'templates.unarchivedDone'), 'success');
      },
      error: (err) => {
        this.busy.set(false);
        this.actionError.set(errorText(this.i18n, err));
      },
    });
  }
}
