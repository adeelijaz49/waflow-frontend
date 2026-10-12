import { Component, computed, inject, input, output, signal } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { AiAssistContext, AiWarning } from '../localization.types';
import { errorText } from './loc-errors';

export type AiAction = 'to_ar' | 'to_en' | 'saudi';

export interface AiApplied {
  action: AiAction;
  text: string;
  buttons?: string[];
}

interface AiDraft extends AiApplied {
  warnings: AiWarning[];
  language: Lang;
}

// "Translate to Arabic / English" and "Make this Saudi-friendly" (spec Phase 2).
// The result is ALWAYS shown as a draft with the AI notice; nothing is applied
// until the user presses "Use this draft" (-> the `applied` output), and nothing
// is ever sent from here. Machine text is never marked as reviewed.
@Component({
  selector: 'app-ai-assist',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './ai-assist.html',
  styleUrl: './ai-assist.css',
})
export class AiAssist {
  private readonly api = inject(LocalizationApiService);
  readonly i18n = inject(I18nService);

  readonly text = input.required<string>();
  readonly textLanguage = input<Lang | 'auto'>('auto');
  readonly context = input<AiAssistContext>('template_body');
  readonly buttons = input<string[] | null>(null);
  readonly maxLength = input<number | null>(null);
  readonly actions = input<AiAction[]>(['to_ar', 'to_en', 'saudi']);
  readonly disabled = input<boolean>(false);

  readonly applied = output<AiApplied>();

  readonly busy = signal<AiAction | null>(null);
  readonly draft = signal<AiDraft | null>(null);
  readonly error = signal<string | null>(null);

  readonly canRun = computed(() => !this.disabled() && this.text().trim().length > 0 && this.busy() === null);

  has(action: AiAction): boolean {
    return this.actions().includes(action);
  }

  run(action: AiAction): void {
    if (!this.canRun()) return;
    this.busy.set(action);
    this.error.set(null);
    this.draft.set(null);
    const ctx = this.context();
    const maxLength = this.maxLength() ?? undefined;
    const done = (result: { text: string; warnings: AiWarning[]; buttons?: string[] }, language: Lang) => {
      this.draft.set({ action, text: result.text, buttons: result.buttons, warnings: result.warnings ?? [], language });
      this.busy.set(null);
    };
    const fail = (err: unknown) => {
      this.error.set(errorText(this.i18n, err, 'ai.failed'));
      this.busy.set(null);
    };

    if (action === 'saudi') {
      const buttons = this.buttons();
      this.api
        .aiSaudiFriendly({ text: this.text(), buttons: buttons ?? undefined, context: ctx, maxLength })
        .subscribe({ next: (r) => done(r, 'ar'), error: fail });
      return;
    }
    const to: Lang = action === 'to_ar' ? 'ar' : 'en';
    this.api
      .aiTranslate({ text: this.text(), from: this.textLanguage(), to, context: ctx, maxLength })
      .subscribe({ next: (r) => done(r, to), error: fail });
  }

  use(): void {
    const d = this.draft();
    if (!d) return;
    this.applied.emit({ action: d.action, text: d.text, buttons: d.buttons });
    this.draft.set(null);
  }

  discard(): void {
    this.draft.set(null);
  }

  warningText(w: AiWarning): string {
    return this.i18n.t(`ai.warning.${w.code}`, w.detail as Record<string, string | number> | undefined);
  }
}
