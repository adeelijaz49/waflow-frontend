import { Component, computed, inject, input, signal } from '@angular/core';
import { I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { errorText } from '../shared/loc-errors';
import { InboxLabels } from './inbox-labels';
import type { ThreadMessage } from './inbox-types';

// One thread bubble. Text uses dir="auto" so Arabic aligns right and English
// left in the same conversation. INBOUND messages get a "Translate" link that
// shows an AI draft translation beneath (labelled, collapsible, never stored
// and never sent).
@Component({
  selector: 'app-loc-message-bubble',
  imports: [...I18N_PIPES],
  templateUrl: './message-bubble.html',
  styleUrl: './message-bubble.css',
})
export class MessageBubble {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  readonly labels = inject(InboxLabels);

  readonly message = input.required<ThreadMessage>();

  readonly busy = signal(false);
  readonly translation = signal<string | null>(null);
  readonly alreadyEnglish = signal(false);
  readonly open = signal(true);
  readonly error = signal('');

  readonly inbound = computed(() => this.message().direction === 'inbound');
  readonly body = computed(() => this.labels.line(this.message().body));
  readonly typeLabel = computed(() => this.labels.messageType(this.message().messageType));
  readonly status = computed(() => {
    const m = this.message();
    return m.direction === 'outbound' ? this.labels.status(m.messageType, m.status) : null;
  });

  translate(): void {
    if (this.busy()) return;
    const existing = this.translation();
    if (existing !== null) {
      this.open.update((v) => !v);
      return;
    }
    const text = this.message().body;
    if (!text?.trim()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.aiTranslateInbound(text).subscribe({
      next: (res) => {
        this.translation.set(res.translation);
        this.alreadyEnglish.set(res.detectedLanguage === 'en');
        this.open.set(true);
        this.busy.set(false);
      },
      error: (err) => {
        this.error.set(errorText(this.i18n, err, 'ai.failed'));
        this.busy.set(false);
      },
    });
  }
}
