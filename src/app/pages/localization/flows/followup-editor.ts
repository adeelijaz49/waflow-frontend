import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { FlowNodeVersion, FlowTreeNode, TemplateButton } from '../localization.types';
import { AiAction, AiApplied, AiAssist } from '../shared/ai-assist';
import { ApprovalBadge } from '../shared/approval-badge';
import { errorCode, errorStatus, errorText } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import { charCount } from '../shared/merge-fields';
import { WaPreview } from '../shared/wa-preview';
import { insertAtCaret } from '../templates/template-utils';
import {
  DraftIssue, FOLLOWUP_LIMITS, FollowUpForm, allowedFields, arabicOf, bodyLimit, checkForm, englishPreviewText, fillSamples, formOf,
  fromValidationIssue, issuesOfView, sameForm, sampleLookup, toSaveInput, versionOfView,
} from './followup.util';

export type EditorPreviewMode = 'ar' | 'en' | 'both';

interface ShownIssue { code: string; text: string }
interface PreviewPane { lang: Lang; body: string; buttons: TemplateButton[] }

// Editor for the ARABIC version of one follow-up reply (the message a customer gets after tapping a button):
// the Arabic body with the merge fields that message can fill, one Arabic label per button (the buttons keep
// their position and what they do - only the label changes, at most 20 characters), AI draft helpers that never
// apply anything on their own, the live issue list, a WhatsApp-style preview and the native-review switch.
@Component({
  selector: 'app-loc-followup-editor',
  imports: [AiAssist, ApprovalBadge, WaPreview, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './followup-editor.html',
  styleUrl: './followup-editor.css',
})
export class FollowupEditor {
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  readonly i18n = inject(I18nService);

  readonly node = input.required<FlowTreeNode>();
  readonly mode = input<EditorPreviewMode>('ar');
  // A save / review went through; the version is what the answer described (null = re-read the tree to find out).
  readonly changed = output<FlowNodeVersion | null>();
  readonly reloadRequested = output<void>();
  readonly closed = output<void>();
  readonly dirtyChange = output<boolean>();

  readonly limits = FOLLOWUP_LIMITS;
  readonly toArabicOnly: AiAction[] = ['to_ar'];
  readonly saudiOnly: AiAction[] = ['saudi'];

  private readonly bodyEl = viewChild<ElementRef<HTMLTextAreaElement>>('bodyField');

  readonly version = computed(() => arabicOf(this.node()));
  private readonly baseline = computed<FollowUpForm>(() => formOf(this.node(), this.version()));

  readonly form = signal<FollowUpForm>({ body: '', labels: {} });
  readonly aiTouched = signal(false);
  readonly saving = signal(false);
  readonly reviewing = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);
  private readonly serverIssues = signal<{ errors: DraftIssue[]; warnings: DraftIssue[] } | null>(null);

  readonly fields = computed(() => allowedFields(this.node()));
  readonly maxBody = computed(() => bodyLimit(this.node()));
  readonly englishSource = computed(() => this.node().bodyFields ?? this.node().bodyText);
  readonly slotProblem = computed(() => this.node().bodyFields === null && this.node().bodyText.trim().length > 0);
  readonly stale = computed(() => this.version()?.stale === true);
  readonly dirty = computed(() => !sameForm(this.form(), this.baseline(), this.node()));
  readonly busy = computed(() => this.saving() || this.reviewing());
  readonly arabicLabels = computed(() => this.node().buttons.map((b) => this.form().labels[b.position] ?? ''));

  private readonly local = computed(() => checkForm(this.node(), this.form()));
  readonly errors = computed<ShownIssue[]>(() => this.show(this.merge(this.local().errors, this.serverIssues()?.errors ?? [])));
  readonly warnings = computed<ShownIssue[]>(() => this.show(this.merge(this.local().warnings, this.serverIssues()?.warnings ?? [])));

  // A stale version can be re-saved unchanged ("still correct"): the server then re-bases it on the current English text.
  readonly canSave = computed(() => (this.dirty() || this.stale()) && this.form().body.trim().length > 0 && !this.busy());
  readonly canReview = computed(() => {
    const v = this.version();
    return !!v && v.reviewStatus === 'draft' && v.contentVersion !== null && !this.dirty() && !this.stale() && this.errors().length === 0 && !this.busy();
  });
  readonly canRevert = computed(() => {
    const v = this.version();
    return !!v && v.reviewStatus === 'reviewed' && v.contentVersion !== null && !this.dirty() && !this.busy();
  });
  readonly showAiNote = computed(() => this.aiTouched());

  readonly panes = computed<PreviewPane[]>(() => {
    const m = this.mode();
    const node = this.node();
    const ar: PreviewPane = {
      lang: 'ar',
      body: this.sampled(this.form().body, 'ar'),
      buttons: node.buttons.map((b) => ({ role: 'flow_button', text: this.form().labels[b.position] ?? '' })),
    };
    const en: PreviewPane = {
      lang: 'en',
      body: this.sampled(englishPreviewText(node), 'en'),
      buttons: node.buttons.map((b) => ({ role: 'flow_button', text: b.label })),
    };
    return m === 'both' ? [ar, en] : [m === 'en' ? en : ar];
  });

  private initialized = false;

  constructor() {
    // The Arabic preview fills sample values from the Arabic catalogue, which an English UI has not loaded yet.
    void this.i18n.ensureLoaded('ar').catch(() => undefined);
    effect(() => {
      const b = this.baseline();
      untracked(() => {
        if (!this.initialized || !this.dirty()) {
          this.form.set({ body: b.body, labels: { ...b.labels } });
          this.initialized = true;
        }
      });
    });
    effect(() => this.dirtyChange.emit(this.dirty()));
  }

  labelOf(position: number): string { return this.form().labels[position] ?? ''; }
  count(value: string): number { return charCount(value); }
  countClass(value: string, max: number): string {
    const n = charCount(value);
    return n > max ? 'over' : n >= Math.floor(max * 0.9) ? 'near' : '';
  }

  fieldLabel(key: string): string {
    for (const k of [`flows.field.${key}`, `templates.field.${key}`]) {
      if (this.i18n.has(k)) return this.i18n.t(k);
    }
    return `{${key}}`;
  }
  usedField(key: string): boolean { return this.form().body.includes(`{${key}}`); }

  // ── Edits ────────────────────────────────────────────────────────────────
  private touch(): void {
    this.serverIssues.set(null);
    this.error.set(null);
    this.conflict.set(false);
  }
  onBody(value: string): void {
    this.touch();
    this.form.update((f) => ({ ...f, body: value }));
  }
  onLabel(position: number, value: string): void {
    this.touch();
    this.form.update((f) => ({ ...f, labels: { ...f.labels, [position]: value.replace(/[\r\n]+/g, ' ') } }));
  }
  insertField(key: string): void {
    const el = this.bodyEl()?.nativeElement;
    const { value, caret } = insertAtCaret(this.form().body, el?.selectionStart ?? null, el?.selectionEnd ?? null, `{${key}}`);
    this.onBody(value);
    if (el) {
      queueMicrotask(() => { el.focus(); el.setSelectionRange(caret, caret); });
    }
  }
  // AI drafts only ever land in the form (unsaved, marked as AI-assisted); saving stores them as Draft.
  onAiBody(applied: AiApplied): void {
    this.onBody(applied.text);
    const buttons = applied.buttons;
    if (buttons && buttons.length === this.node().buttons.length) {
      this.node().buttons.forEach((b, i) => this.onLabel(b.position, buttons[i] ?? ''));
    }
    this.aiTouched.set(true);
  }
  onAiLabel(position: number, applied: AiApplied): void {
    this.onLabel(position, applied.text);
    this.aiTouched.set(true);
  }

  discard(): void {
    const b = this.baseline();
    this.form.set({ body: b.body, labels: { ...b.labels } });
    this.aiTouched.set(false);
    this.touch();
  }

  async close(): Promise<void> {
    if (this.dirty()) {
      const ok = await this.ui.confirm({
        title: this.i18n.t('templates.unsavedConfirmTitle'),
        message: this.i18n.t('templates.unsavedConfirmMessage'),
        confirmLabel: this.i18n.t('templates.unsavedConfirm'),
        cancelLabel: this.i18n.t('templates.unsavedKeep'),
        danger: true,
      });
      if (!ok) return;
    }
    this.closed.emit();
  }

  // ── Save / review ────────────────────────────────────────────────────────
  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.touch();
    const node = this.node();
    const source = this.aiTouched() ? 'ai' : 'merchant';
    this.api.saveFollowUp(node.messageNodeId, toSaveInput(node, this.form(), source)).subscribe({
      next: (view) => {
        this.saving.set(false);
        this.aiTouched.set(false);
        this.serverIssues.set(issuesOfView(view));
        const saved = versionOfView(view, node.messageNodeId);
        if (saved) {
          const f = formOf(node, saved);
          this.form.set({ body: f.body, labels: { ...f.labels } });
        }
        this.changed.emit(saved);
      },
      error: (err: unknown) => this.fail(err, 'flows.editor.saveFailed'),
    });
  }

  setReview(status: 'reviewed' | 'draft'): void {
    const v = this.version();
    if (!v || v.contentVersion === null || this.busy()) return;
    if (status === 'reviewed' && !this.canReview()) return;
    this.reviewing.set(true);
    this.touch();
    const node = this.node();
    this.api.reviewFollowUp(node.messageNodeId, status, v.contentVersion).subscribe({
      next: (view) => {
        this.reviewing.set(false);
        this.serverIssues.set(issuesOfView(view));
        this.changed.emit(versionOfView(view, node.messageNodeId));
      },
      error: (err: unknown) => this.fail(err, 'flows.editor.reviewFailed'),
    });
  }

  private fail(err: unknown, fallbackKey: string): void {
    this.saving.set(false);
    this.reviewing.set(false);
    if (errorStatus(err) === 409) {
      this.conflict.set(true);
      return;
    }
    const issues = (err as { error?: { issues?: Array<{ code: string; field?: string; detail?: Record<string, string | number> }> } } | null)?.error?.issues;
    if (errorCode(err) === 'VARIANT_INVALID' && Array.isArray(issues)) {
      this.serverIssues.set({ errors: issues.map(fromValidationIssue), warnings: [] });
    }
    this.error.set(errorText(this.i18n, err, fallbackKey));
  }

  reload(): void {
    this.discard();
    this.reloadRequested.emit();
  }

  // ── Display helpers ──────────────────────────────────────────────────────
  private merge(local: DraftIssue[], server: DraftIssue[]): DraftIssue[] {
    const seen = new Set(local.map((i) => `${i.code}|${i.field ?? ''}|${JSON.stringify(i.detail ?? {})}`));
    const extra = server.filter((i) => !seen.has(`${i.code}|${i.field ?? ''}|${JSON.stringify(i.detail ?? {})}`));
    return [...local, ...extra];
  }
  private show(issues: DraftIssue[]): ShownIssue[] {
    return issues.map((i) => {
      const key = `flows.issue.${i.code}`;
      return { code: i.code, text: this.i18n.has(key) ? this.i18n.t(key, i.detail) : this.i18n.t('flows.issue.unknown') };
    });
  }
  private sampled(text: string, lang: Lang): string {
    return fillSamples(text, sampleLookup(this.i18n, lang));
  }
}
