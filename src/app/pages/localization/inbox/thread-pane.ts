import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { InboxApiService } from '../../../services/inbox-api.service';
import { errorText } from '../shared/loc-errors';
import type { InboxConversation } from '../localization.types';
import { startPolling } from './inbox-poll';
import type { ThreadMessage, ThreadResponse } from './inbox-types';
import { MessageBubble } from './message-bubble';
import { QuickActions } from './quick-actions';
import { ReplyComposer } from './reply-composer';

export const THREAD_POLL_MS = 8000;

// Centre pane: header, quick actions, the message thread (polled while the tab
// is visible) and the composer.
@Component({
  selector: 'app-loc-thread-pane',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, MessageBubble, QuickActions, ReplyComposer],
  templateUrl: './thread-pane.html',
  styleUrl: './thread-pane.css',
})
export class ThreadPane {
  private readonly api = inject(InboxApiService);
  private readonly i18n = inject(I18nService);

  readonly conversation = input<InboxConversation | null>(null);
  // Language messages to this customer go out in (inbox context); null until loaded.
  readonly language = input<Lang | null>(null);

  readonly back = output<void>();
  readonly changed = output<void>();
  readonly opened = output<string>();

  readonly customerId = computed(() => this.conversation()?.customerId ?? null);
  readonly messages = signal<ThreadMessage[]>([]);
  readonly thread = signal<ThreadResponse['customer'] | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly name = computed(() => this.thread()?.name || this.conversation()?.name || '');
  readonly phone = computed(() => this.thread()?.phone || this.conversation()?.phone || '');
  readonly optedOut = computed(() => this.thread()?.optedOut ?? this.conversation()?.optedOut ?? false);
  readonly lastInbound = computed(() => [...this.messages()].reverse().find((m) => m.direction === 'inbound')?.body ?? '');
  readonly offerLang = computed<Lang>(() => this.language() ?? (this.conversation()?.language === 'ar' ? 'ar' : 'en'));

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private readonly composer = viewChild(ReplyComposer);
  private seq = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const id = this.customerId();
      untracked(() => {
        this.messages.set([]);
        this.thread.set(null);
        this.error.set('');
        if (id) this.load(false);
      });
    });
    startPolling(destroyRef, THREAD_POLL_MS, () => this.load(true));
  }

  load(silent: boolean): void {
    const id = this.customerId();
    if (!id) return;
    const seq = ++this.seq;
    if (!silent) this.loading.set(true);
    this.api.getThread(id).subscribe({
      next: (res: ThreadResponse) => {
        if (seq !== this.seq || id !== this.customerId()) return;
        const grew = (res.messages?.length ?? 0) > this.messages().length;
        this.thread.set(res.customer);
        this.messages.set(res.messages ?? []);
        this.loading.set(false);
        this.error.set('');
        if (!silent || grew) this.scrollToBottom();
        this.opened.emit(id);
      },
      error: (err) => {
        if (seq !== this.seq) return;
        this.loading.set(false);
        // A failed background refresh keeps what is already on screen.
        if (!silent || this.messages().length === 0) this.error.set(errorText(this.i18n, err, 'inbox.thread.loadFailed'));
      },
    });
  }

  onOffer(text: string): void {
    this.composer()?.setText(text);
  }

  onSent(): void {
    this.load(true);
    this.changed.emit();
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
