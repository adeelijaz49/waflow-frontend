import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { errorText } from '../shared/loc-errors';
import type { InboxContext, InboxConversation } from '../localization.types';
import { ConversationList } from './conversation-list';
import { startPolling } from './inbox-poll';
import type { InboxFilterKey } from './inbox-types';
import { SnapshotPane } from './snapshot-pane';
import { ThreadPane } from './thread-pane';

export const LIST_POLL_MS = 20000;
export const SEARCH_DEBOUNCE_MS = 300;

// Arabic-ready WhatsApp Inbox: conversation list | thread | customer snapshot
// (stacked with a back button below 1100 px). A parallel page: the existing
// English inbox is untouched. List/search use the Arabic-aware localisation
// endpoint; thread, snapshot and sending reuse the existing inbox endpoints.
@Component({
  selector: 'app-loc-inbox-ar',
  imports: [ConversationList, ThreadPane, SnapshotPane],
  templateUrl: './inbox-ar.html',
  styleUrl: './inbox-ar.css',
})
export class InboxAr implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  readonly conversations = signal<InboxConversation[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly filter = signal<InboxFilterKey>('all');
  readonly search = signal('');
  readonly selected = signal<InboxConversation | null>(null);
  readonly context = signal<InboxContext | null>(null);
  readonly selectedId = computed(() => this.selected()?.customerId ?? null);
  readonly threadLanguage = computed(() => this.context()?.effectiveLanguage ?? null);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private listSeq = 0;
  private ctxSeq = 0;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
    startPolling(this.destroyRef, LIST_POLL_MS, () => this.load(true));
  }

  ngOnInit(): void {
    this.load(false);
  }

  load(silent: boolean): void {
    const seq = ++this.listSeq;
    if (!silent) this.loading.set(true);
    const filter = this.filter();
    this.api.searchConversations({ filter: filter === 'all' ? undefined : filter, search: this.search().trim() || undefined }).subscribe({
      next: (res) => {
        if (seq !== this.listSeq) return;
        const rows = res.conversations ?? [];
        this.conversations.set(rows);
        this.loading.set(false);
        this.error.set('');
        // Keep the open conversation's row (unread badge, preview, tags) fresh.
        const current = this.selected();
        const fresh = current && rows.find((c) => c.customerId === current.customerId);
        if (fresh) this.selected.set(fresh);
      },
      error: (err) => {
        if (seq !== this.listSeq) return;
        this.loading.set(false);
        // A failed background refresh keeps the list that is already on screen.
        if (!silent || this.conversations().length === 0) this.error.set(errorText(this.i18n, err, 'inbox.list.loadFailed'));
      },
    });
  }

  onFilter(filter: InboxFilterKey): void {
    this.filter.set(filter);
    this.load(false);
  }

  onSearch(text: string): void {
    this.search.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(false), SEARCH_DEBOUNCE_MS);
  }

  open(conv: InboxConversation): void {
    this.selected.set(conv);
    this.loadContext(conv.customerId);
  }

  close(): void {
    this.ctxSeq++; // a context request still in flight must not repopulate a closed thread
    this.selected.set(null);
    this.context.set(null);
  }

  // Language the messages to this customer go out in. A failure only means the
  // language-aware hints are missing; it never blocks the conversation.
  loadContext(customerId: string): void {
    const seq = ++this.ctxSeq;
    this.context.set(null);
    this.api.getInboxContext(customerId).subscribe({
      next: (ctx) => {
        if (seq === this.ctxSeq) this.context.set(ctx);
      },
      error: () => undefined,
    });
  }

  onLanguageChanged(): void {
    const id = this.selectedId();
    if (id) this.loadContext(id);
    this.load(true);
  }

  // The thread was opened/refreshed: the server resets the unread counter, so mirror it locally.
  onThreadOpened(customerId: string): void {
    this.conversations.update((rows) => rows.map((c) => (c.customerId === customerId && c.unreadCount ? { ...c, unreadCount: 0 } : c)));
  }
}
