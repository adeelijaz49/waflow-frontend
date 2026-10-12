import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, forkJoin, map, of, switchMap } from 'rxjs';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import { AiAction, AiApplied, AiAssist } from '../shared/ai-assist';
import { LangPill } from '../shared/lang-pill';
import { errorCode, errorText } from '../shared/loc-errors';
import { META_LIMITS, MERGE_FIELDS, charCount, extractMergeFields } from '../shared/merge-fields';
import { WaPreview } from '../shared/wa-preview';
import type {
  BilingualOrder, ButtonRole, LocalizedTemplate, MessageLanguage, RenderedPreview, TemplateButton, TemplateVariant,
  TemplatesUsage, ValidationIssue, VariantValidation,
} from '../localization.types';
import { ApprovalPanel } from './approval-panel';
import {
  EMPTY_FORM, QUICK_ROLES, ROLE_OPTIONS, VariantForm, cleanButton, formOf, insertAtCaret, sameForm, splitIssues, toInput,
} from './template-utils';

export type PreviewMode = 'auto' | 'ar' | 'en' | 'both';

interface PreviewView {
  language: MessageLanguage;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
}

interface ShownIssue { code: string; text: string; hint: string | null; field: string | null }

type FormTarget = 'header' | 'body';

// One language version of a template: the editor (header / body / footer / buttons, merge-field
// chips, counters, AI assist), the live validation list, the live WhatsApp-style preview and the
// approval panel. The parent owns the template; this component reports saves (templateChange) and
// its unsaved state (dirtyChange).
@Component({
  selector: 'app-loc-variant-editor',
  imports: [AiAssist, ApprovalPanel, WaPreview, LangPill, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './variant-editor.html',
  styleUrl: './variant-editor.css',
})
export class VariantEditor {
  private readonly api = inject(LocalizationApiService);
  private readonly hub = inject(HubStateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(I18nService);

  readonly template = input.required<LocalizedTemplate>();
  readonly language = input.required<MessageLanguage>();
  readonly usage = input<TemplatesUsage | null>(null);
  readonly templateChange = output<LocalizedTemplate>();
  readonly dirtyChange = output<boolean>();

  readonly limits = META_LIMITS;
  readonly mergeFields = MERGE_FIELDS;
  readonly roleOptions = ROLE_OPTIONS;
  readonly toArabicOnly: AiAction[] = ['to_ar'];
  readonly toEnglishOnly: AiAction[] = ['to_en'];
  readonly previewModes: PreviewMode[] = ['auto', 'ar', 'en', 'both'];

  private readonly headerEl = viewChild<ElementRef<HTMLInputElement>>('headerField');
  private readonly bodyEl = viewChild<ElementRef<HTMLTextAreaElement>>('bodyField');

  readonly variant = computed<TemplateVariant | null>(() => this.template().variants.find((v) => v.language === this.language()) ?? null);
  private readonly defaultOrder = computed<BilingualOrder>(() => this.hub.settings()?.bilingualOrder ?? 'ar_first');
  private readonly baseline = computed<VariantForm>(() => formOf(this.variant(), this.defaultOrder()));

  readonly form = signal<VariantForm>({ ...EMPTY_FORM });
  readonly started = signal(false);
  readonly aiTouched = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly lastFocus = signal<FormTarget>('body');

  readonly live = signal<VariantValidation | null>(null);
  readonly checking = signal(false);
  readonly validationFailed = signal(false);

  readonly previewMode = signal<PreviewMode>('auto');
  readonly rendered = signal<RenderedPreview | null>(null);
  readonly renderedOthers = signal<Partial<Record<MessageLanguage, RenderedPreview | null>>>({});
  readonly previewBusy = signal(false);

  readonly visible = computed(() => !!this.variant() || this.started());
  readonly isBilingual = computed(() => this.language() === 'bilingual');
  readonly dirty = computed(() => !sameForm(this.form(), this.baseline(), this.isBilingual()));
  readonly canSave = computed(() => this.dirty() && this.form().body.trim().length > 0 && !this.saving());
  readonly textLang = computed<Lang | null>(() => (this.language() === 'bilingual' ? null : (this.language() as Lang)));
  readonly flowLocked = computed(() => !!this.template().linkedMessageNodeId);
  readonly usedFields = computed(() => new Set([...extractMergeFields(this.form().header), ...extractMergeFields(this.form().body)]));
  readonly buttonLabels = computed(() => this.form().buttons.map((b) => b.text));
  readonly needsOptOut = computed(
    () => this.template().category === 'MARKETING' && !this.form().buttons.some((b) => b.role === 'opt_out'),
  );
  readonly showAiNote = computed(() => this.aiTouched() || this.variant()?.source === 'ai');
  readonly warnsResetApproval = computed(() => {
    const v = this.variant();
    return this.dirty() && !!v && (v.metaStatus !== 'NOT_CREATED' || v.reviewStatus === 'reviewed');
  });

  // The language the user can translate FROM when starting a missing version.
  readonly sourceVariant = computed<TemplateVariant | null>(() => {
    const lang = this.language();
    if (lang === 'bilingual') return null;
    return this.template().variants.find((v) => v.language === (lang === 'ar' ? 'en' : 'ar')) ?? null;
  });
  readonly canCombine = computed(() => {
    const vs = this.template().variants;
    return this.language() === 'bilingual' && vs.some((v) => v.language === 'en') && vs.some((v) => v.language === 'ar');
  });

  readonly validation = computed<VariantValidation | null>(() => this.live() ?? this.variant()?.validation ?? null);
  readonly issues = computed(() => {
    const v = this.validation();
    const split = v ? splitIssues(v.errors ?? [], v.warnings ?? [], this.language()) : { errors: [], warnings: [] };
    return { errors: split.errors.map((i) => this.shown(i)), warnings: split.warnings.map((i) => this.shown(i)) };
  });

  readonly previewViews = computed<PreviewView[]>(() => {
    const lang = this.language();
    const f = this.form();
    const r = this.rendered();
    const current: PreviewView = {
      language: lang,
      header: r?.header ?? f.header,
      body: r?.body ?? f.body,
      footer: r?.footer ?? f.footer,
      buttons: r?.buttons ?? f.buttons,
    };
    if (this.previewMode() !== 'both') return [current];
    const others = this.template().variants.filter((v) => v.language !== lang && v.language !== 'bilingual');
    const views: PreviewView[] = others.map((v) => {
      const o = this.renderedOthers()[v.language];
      return { language: v.language, header: o?.header ?? v.header, body: o?.body ?? v.body, footer: o?.footer ?? v.footer, buttons: o?.buttons ?? v.buttons };
    });
    const all = lang === 'bilingual' ? views : [current, ...views];
    return all.sort((a, b) => (a.language === 'en' ? -1 : b.language === 'en' ? 1 : 0));
  });
  readonly phoneLanguage = computed<Lang | null>(() => {
    const m = this.previewMode();
    return m === 'ar' || m === 'en' ? m : null;
  });

  private initialized = false;
  private readonly validate$ = new Subject<VariantForm>();
  private readonly preview$ = new Subject<void>();

  constructor() {
    effect(() => {
      const b = this.baseline();
      untracked(() => {
        if (!this.initialized || !this.dirty()) {
          this.form.set(this.cloneForm(b));
          this.initialized = true;
        }
      });
    });
    effect(() => this.dirtyChange.emit(this.dirty()));
    effect(() => {
      const f = this.form();
      const dirty = this.dirty();
      const visible = this.visible();
      untracked(() => {
        if (visible && dirty) {
          this.checking.set(true);
          this.validate$.next(f);
        } else {
          this.live.set(null);
          this.checking.set(false);
        }
      });
    });
    effect(() => {
      this.form();
      this.language();
      this.previewMode();
      this.template();
      const visible = this.visible();
      untracked(() => {
        if (visible) {
          this.previewBusy.set(true);
          this.preview$.next();
        }
      });
    });

    this.validate$
      .pipe(
        debounceTime(500),
        switchMap((f) =>
          this.api.validateVariant(this.template().id, this.language(), toInput(f, this.language(), 'merchant')).pipe(
            map((v) => ({ v })),
            catchError(() => of({ v: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ v }) => {
        this.checking.set(false);
        this.validationFailed.set(!v);
        if (v) this.live.set(v);
      });

    this.preview$
      .pipe(
        debounceTime(400),
        switchMap(() => {
          const lang = this.language();
          const f = this.form();
          const call = (language: MessageLanguage, body: ReturnType<typeof toInput>) =>
            body.body.trim() ? this.api.previewVariant({ variant: { ...body, language } }).pipe(catchError(() => of(null))) : of(null);
          const others =
            this.previewMode() === 'both'
              ? this.template().variants.filter((v) => v.language !== lang && v.language !== 'bilingual')
              : [];
          return forkJoin({
            current: call(lang, toInput(f, lang, 'merchant')),
            others: others.length
              ? forkJoin(others.map((v) => call(v.language, toInput(formOf(v), v.language, 'merchant')).pipe(map((p) => [v.language, p] as const))))
              : of([] as Array<readonly [MessageLanguage, RenderedPreview | null]>),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ current, others }) => {
        this.rendered.set(current);
        this.renderedOthers.set(Object.fromEntries(others));
        this.previewBusy.set(false);
      });
  }

  modeKey(m: PreviewMode): string {
    return m === 'auto' ? 'preview.asSent' : m === 'ar' ? 'preview.arabicCustomer' : m === 'en' ? 'preview.englishCustomer' : 'preview.sideBySide';
  }

  // ── Counters ─────────────────────────────────────────────────────────────
  count(value: string): number {
    return charCount(value);
  }
  countClass(value: string, max: number): string {
    const n = charCount(value);
    return n > max ? 'over' : n >= Math.floor(max * 0.9) ? 'near' : '';
  }

  // ── Field edits ──────────────────────────────────────────────────────────
  patch(change: Partial<VariantForm>): void {
    this.form.update((f) => ({ ...f, ...change }));
  }
  onText(field: 'header' | 'body' | 'footer', value: string): void {
    this.patch({ [field]: field === 'header' ? value.replace(/[\r\n]+/g, ' ') : value });
  }
  onOrder(value: string): void {
    this.patch({ bilingualOrder: value === 'en_first' ? 'en_first' : 'ar_first' });
  }

  insertField(key: string): void {
    const target = this.lastFocus();
    const el = (target === 'header' ? this.headerEl() : this.bodyEl())?.nativeElement;
    const { value, caret } = insertAtCaret(this.form()[target], el?.selectionStart ?? null, el?.selectionEnd ?? null, `{${key}}`);
    this.patch({ [target]: value });
    if (el) {
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    }
  }

  // ── Buttons ──────────────────────────────────────────────────────────────
  private labelFor(role: ButtonRole, lang: MessageLanguage = this.language()): string {
    if (role !== 'opt_out' && role !== 'opt_in' && role !== 'decline' && role !== 'shop_now') return '';
    const target: Lang = lang === 'bilingual' ? (this.form().bilingualOrder === 'en_first' ? 'en' : 'ar') : lang;
    return this.i18n.t(`templates.button.default.${role}`, undefined, target);
  }
  addButton(role: ButtonRole = 'url'): void {
    if (this.form().buttons.length >= META_LIMITS.buttons) return;
    const b: TemplateButton = role === 'url' ? { role, text: '', url: '' } : { role, text: this.labelFor(role) };
    this.patch({ buttons: [...this.form().buttons, b] });
  }
  addOptOut(): void {
    this.addButton('opt_out');
  }
  removeButton(i: number): void {
    this.patch({ buttons: this.form().buttons.filter((_, idx) => idx !== i) });
  }
  setButton(i: number, change: Partial<TemplateButton>): void {
    this.patch({ buttons: this.form().buttons.map((b, idx) => (idx === i ? cleanButton({ ...b, ...change }) : b)) });
  }
  setButtonRole(i: number, value: string): void {
    const role = value as ButtonRole;
    const current = this.form().buttons[i];
    const wasDefault = !current.text || current.text === this.labelFor(current.role);
    this.setButton(i, { role, text: wasDefault ? this.labelFor(role) : current.text, url: role === 'url' ? current.url ?? '' : undefined });
  }
  isFlowButton(b: TemplateButton): boolean {
    return b.role === 'flow_button';
  }
  // shop_now (payload promo_<promotionId>) is offered only for a template linked to a Promotion.
  rolesFor(b: TemplateButton): ButtonRole[] {
    if (b.role === 'flow_button') return ['flow_button'];
    const roles: ButtonRole[] = [...ROLE_OPTIONS];
    if (this.template().linkedPromotionId || b.role === 'shop_now') roles.push('shop_now');
    return roles;
  }
  isQuickReply(role: ButtonRole): boolean {
    return QUICK_ROLES.has(role);
  }

  // ── Starting a missing version ───────────────────────────────────────────
  startBlank(): void {
    this.started.set(true);
  }
  private relabel(buttons: TemplateButton[], to: MessageLanguage): TemplateButton[] {
    return buttons.map((b) => {
      if (b.role === 'url') return { role: 'url', text: b.text, url: b.url ?? '' };
      if (b.role === 'flow_button') return { role: b.role, text: b.text };
      return { role: b.role, text: this.labelFor(b.role, to) };
    });
  }
  startFromOther(): void {
    const src = this.sourceVariant();
    if (!src) return;
    this.form.set({ header: src.header, body: src.body, footer: src.footer, buttons: this.relabel(src.buttons, this.language()), bilingualOrder: this.defaultOrder() });
    this.started.set(true);
  }
  startCombined(): void {
    const vs = this.template().variants;
    const en = vs.find((v) => v.language === 'en');
    const ar = vs.find((v) => v.language === 'ar');
    if (!en || !ar) return;
    const order = this.defaultOrder();
    const [first, second] = order === 'en_first' ? [en, ar] : [ar, en];
    this.form.set({
      header: first.header,
      body: `${first.body.trim()}\n\n${second.body.trim()}`,
      footer: first.footer,
      buttons: first.buttons.map(cleanButton),
      bilingualOrder: order,
    });
    this.started.set(true);
  }
  startFromAi(applied: AiApplied): void {
    const src = this.sourceVariant();
    this.form.set({
      header: '',
      body: applied.text,
      footer: '',
      buttons: src ? this.relabel(src.buttons, this.language()).map((b) => (b.role === 'url' ? { ...b, text: '' } : b)) : [],
      bilingualOrder: this.defaultOrder(),
    });
    this.aiTouched.set(true);
    this.started.set(true);
  }
  onAiApplied(applied: AiApplied): void {
    const patch: Partial<VariantForm> = { body: applied.text };
    const buttons = this.form().buttons;
    if (applied.buttons && applied.buttons.length === buttons.length) {
      patch.buttons = buttons.map((b, i) => (b.role === 'flow_button' ? b : cleanButton({ ...b, text: applied.buttons?.[i] ?? b.text })));
    }
    this.patch(patch);
    this.aiTouched.set(true);
  }

  // ── Save / discard ───────────────────────────────────────────────────────
  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const source = this.aiTouched() || this.variant()?.source === 'ai' ? 'ai' : 'merchant';
    this.api.saveVariant(this.template().id, this.language(), toInput(this.form(), this.language(), source)).subscribe({
      next: (t) => {
        const saved = t.variants.find((v) => v.language === this.language());
        if (saved) this.form.set(formOf(saved, this.defaultOrder()));
        this.live.set(null);
        this.aiTouched.set(false);
        this.saving.set(false);
        this.templateChange.emit(t);
      },
      error: (err) => {
        this.saving.set(false);
        const issues = (err as { error?: { issues?: ValidationIssue[] } } | null)?.error?.issues;
        if (errorCode(err) === 'VARIANT_INVALID' && Array.isArray(issues)) {
          this.live.set({ ok: false, errors: issues, warnings: [], positionalText: '', params: [] });
        }
        this.saveError.set(errorText(this.i18n, err, 'templates.saveFailed'));
      },
    });
  }

  discard(): void {
    this.form.set(this.cloneForm(this.baseline()));
    this.aiTouched.set(false);
    this.live.set(null);
    this.saveError.set(null);
    if (!this.variant()) this.started.set(false);
  }

  // ── Validation messages ──────────────────────────────────────────────────
  private shown(issue: ValidationIssue): ShownIssue {
    const key = `templates.issue.${issue.code}`;
    const hintKey = `templates.issueHint.${issue.code}`;
    const params = issue.detail as Record<string, string | number> | undefined;
    return {
      code: issue.code,
      text: this.i18n.has(key) ? this.i18n.t(key, params) : this.i18n.t('templates.issue.unknown'),
      hint: this.i18n.has(hintKey) ? this.i18n.t(hintKey) : null,
      field: issue.field ?? null,
    };
  }

  private cloneForm(f: VariantForm): VariantForm {
    return { ...f, buttons: f.buttons.map(cleanButton) };
  }
}
