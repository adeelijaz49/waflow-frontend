import { Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { I18N_PIPES, I18nService } from '../../../i18n';
import { InboxApiService } from '../../../services/inbox-api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { errorText } from '../shared/loc-errors';
import type { AiWarning } from '../localization.types';

// Message box + staff helpers. Sending is always the staff member's own explicit
// press of "Send". "Reply in Arabic" only produces an editable DRAFT (AI, labelled);
// "Use in message box" copies it into the box — it is still not sent until the
// staff member presses Send, a second explicit step.
@Component({
  selector: 'app-loc-reply-composer',
  imports: [...I18N_PIPES],
  templateUrl: './reply-composer.html',
  styleUrl: './reply-composer.css',
})
export class ReplyComposer {
  private readonly inboxApi = inject(InboxApiService);
  private readonly locApi = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);

  readonly customerId = input.required<string>();
  readonly customerName = input('');
  readonly lastInbound = input('');
  readonly sent = output<void>();

  readonly text = signal('');
  readonly sending = signal(false);
  readonly error = signal('');
  readonly aiBusy = signal(false);
  readonly aiError = signal('');
  readonly draft = signal<string | null>(null);
  readonly warnings = signal<AiWarning[]>([]);
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  constructor() {
    // A different conversation starts with a clean box and no pending draft.
    effect(() => {
      this.customerId();
      untracked(() => {
        this.text.set('');
        this.error.set('');
        this.aiError.set('');
        this.draft.set(null);
        this.warnings.set([]);
      });
    });
  }

  setText(value: string): void {
    this.text.set(value);
    this.box()?.nativeElement.focus();
  }

  onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.send();
  }

  send(): void {
    const body = this.text().trim();
    const id = this.customerId();
    if (!body || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.inboxApi.sendMessage(id, body).subscribe({
      next: () => {
        this.sending.set(false);
        if (this.customerId() === id) this.text.set('');
        this.sent.emit();
      },
      error: (err) => {
        this.sending.set(false);
        this.error.set(errorText(this.i18n, err, 'inbox.composer.sendFailed'));
      },
    });
  }

  replyInArabic(): void {
    const englishText = this.text().trim();
    const id = this.customerId();
    if (!englishText || this.aiBusy()) return;
    this.aiBusy.set(true);
    this.aiError.set('');
    this.draft.set(null);
    this.locApi
      .aiReplyInArabic({ englishText, customerMessage: this.lastInbound() || undefined, customerName: this.customerName() || undefined })
      .subscribe({
        next: (res) => {
          this.aiBusy.set(false);
          if (this.customerId() !== id) return;
          this.draft.set(res.text);
          this.warnings.set(res.warnings ?? []);
        },
        error: (err) => {
          this.aiBusy.set(false);
          this.aiError.set(errorText(this.i18n, err, 'ai.failed'));
        },
      });
  }

  onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  useDraft(): void {
    const d = this.draft();
    if (d === null) return;
    this.text.set(d);
    this.draft.set(null);
    this.warnings.set([]);
    queueMicrotask(() => this.box()?.nativeElement.focus());
  }

  discardDraft(): void {
    this.draft.set(null);
    this.warnings.set([]);
  }

  warningText(w: AiWarning): string {
    return this.i18n.t(`ai.warning.${w.code}`, w.detail as Record<string, string | number> | undefined);
  }
}
