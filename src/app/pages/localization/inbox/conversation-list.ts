import { Component, input, output } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES } from '../../../i18n';
import { LangPill } from '../shared/lang-pill';
import type { InboxConversation } from '../localization.types';
import { InboxLabels } from './inbox-labels';
import type { InboxFilterKey } from './inbox-types';

export const INBOX_FILTERS: ReadonlyArray<{ value: InboxFilterKey; key: string }> = [
  { value: 'all', key: 'inbox.filter.all' },
  { value: 'unread', key: 'inbox.filter.unread' },
  { value: 'high-value', key: 'inbox.filter.highValue' },
  { value: 'inactive', key: 'inbox.filter.inactive' },
  { value: 'recent', key: 'inbox.filter.recent' },
  { value: 'booking', key: 'inbox.filter.booking' },
];

// Left pane: Arabic-aware search box, filter chips and the conversation rows.
// Purely presentational — the page owns loading/polling.
@Component({
  selector: 'app-loc-conversation-list',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, LangPill],
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.css',
})
export class ConversationList {
  readonly filters = INBOX_FILTERS;
  readonly conversations = input.required<InboxConversation[]>();
  readonly loading = input(false);
  readonly error = input('');
  readonly selectedId = input<string | null>(null);
  readonly filter = input<InboxFilterKey>('all');
  readonly search = input('');

  readonly picked = output<InboxConversation>();
  readonly filterChange = output<InboxFilterKey>();
  readonly searchChange = output<string>();
  readonly retry = output<void>();

  constructor(readonly labels: InboxLabels) {}

  onSearch(event: Event): void {
    this.searchChange.emit((event.target as HTMLInputElement).value);
  }
}
