import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InboxApiService, ConversationRow, InboxFilter } from '../../services/inbox-api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { DialogService } from '../../shared/dialog.service';

const LIST_POLL_MS = 15000;
const THREAD_POLL_MS = 8000;

const TAG_BADGE: Record<string, string> = {
  'High-value':      'badge-warning',
  'Inactive':        'badge-neutral',
  'Loyalty member':  'badge-info',
  'Recent buyer':    'badge-success',
  'Booking customer': 'badge-primary',
};

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  manual: '', campaign: '📣 Campaign', order: '🛍️ Order', payment: '💳 Payment', loyalty: '💎 Loyalty', booking: '📅 Booking', system: 'System',
};

const OFFER_DRAFT = "Hi! 👋 We've got a special offer just for you this week — reply here and we'll send you the details.";

@Component({
  selector: 'app-inbox',
  imports: [CommonModule, FormsModule, RouterLink, AppCurrencyPipe, DatePipe],
  templateUrl: './inbox.html',
  styleUrl: './inbox.css',
})
export class Inbox implements OnInit, OnDestroy {
  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;

  readonly filters: { value: InboxFilter; label: string }[] = [
    { value: 'all',        label: 'All conversations' },
    { value: 'unread',     label: 'Unread' },
    { value: 'high-value', label: 'High-value customers' },
    { value: 'inactive',   label: 'Inactive customers' },
    { value: 'recent',     label: 'Recent orders' },
    { value: 'booking',    label: 'Booking customers' },
  ];

  conversations: ConversationRow[] = [];
  loadingList = false;
  filter: InboxFilter = 'all';
  search = '';

  selected: ConversationRow | null = null;
  threadCustomer: any = null;
  messages: any[] = [];
  loadingThread = false;

  snapshot: any = null;
  loadingSnapshot = false;

  composerText = '';
  sending = false;

  showPaymentModal = false;
  paymentAmount: number | null = null;
  sendingPayment = false;
  sendingLoyalty = false;

  private listPoll: any;
  private threadPoll: any;

  constructor(private api: InboxApiService, private dialog: DialogService) {}

  ngOnInit() {
    this.loadConversations();
    this.listPoll = setInterval(() => this.loadConversations(true), LIST_POLL_MS);
  }

  ngOnDestroy() {
    clearInterval(this.listPoll);
    clearInterval(this.threadPoll);
  }

  // ── Conversation list ───────────────────────────────────────────────────
  loadConversations(silent = false) {
    if (!silent) this.loadingList = true;
    this.api.getConversations({ filter: this.filter, search: this.search }).subscribe({
      next: (res) => {
        this.conversations = res.conversations || [];
        this.loadingList = false;
        // Keep the open thread's row (unread badge, preview) fresh without
        // disturbing the selection itself.
        if (this.selected) {
          const fresh = this.conversations.find(c => c.customerId === this.selected!.customerId);
          if (fresh) this.selected = fresh;
        }
      },
      error: () => { this.loadingList = false; },
    });
  }

  setFilter(f: InboxFilter) {
    this.filter = f;
    this.loadConversations();
  }

  onSearch() {
    this.loadConversations();
  }

  tagBadge(tag: string): string {
    return TAG_BADGE[tag] || 'badge-neutral';
  }

  // ── Thread ───────────────────────────────────────────────────────────────
  open(conv: ConversationRow) {
    this.selected = conv;
    this.messages = [];
    this.threadCustomer = null;
    this.snapshot = null;
    this.composerText = '';
    clearInterval(this.threadPoll);
    this.loadThread();
    this.loadSnapshot();
    this.threadPoll = setInterval(() => this.loadThread(true), THREAD_POLL_MS);
  }

  private loadThread(silent = false) {
    if (!this.selected) return;
    if (!silent) this.loadingThread = true;
    this.api.getThread(this.selected.customerId).subscribe({
      next: (res) => {
        const grew = res.messages?.length > this.messages.length;
        this.threadCustomer = res.customer;
        this.messages = res.messages || [];
        this.loadingThread = false;
        if (!silent || grew) this.scrollToBottom();
        // A poll can be the first thing to notice a new inbound message —
        // clear its unread badge locally too, matching the server's own reset.
        if (this.selected) this.selected.unreadCount = 0;
      },
      error: () => { this.loadingThread = false; },
    });
  }

  private loadSnapshot() {
    if (!this.selected) return;
    this.loadingSnapshot = true;
    this.api.getSnapshot(this.selected.customerId).subscribe({
      next: (res) => { this.snapshot = res; this.loadingSnapshot = false; },
      error: () => { this.loadingSnapshot = false; },
    });
  }

  closeThread() {
    this.selected = null;
    clearInterval(this.threadPoll);
  }

  messageTypeLabel(type: string): string {
    return MESSAGE_TYPE_LABEL[type] ?? type;
  }

  statusIcon(status: string): string {
    if (status === 'read') return '✓✓';
    if (status === 'delivered') return '✓✓';
    if (status === 'sent') return '✓';
    if (status === 'failed') return '⚠️';
    return '';
  }

  private scrollToBottom() {
    setTimeout(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  // ── Composer ─────────────────────────────────────────────────────────────
  send() {
    const text = this.composerText.trim();
    if (!text || !this.selected || this.sending) return;
    this.sending = true;
    this.api.sendMessage(this.selected.customerId, text).subscribe({
      next: () => {
        this.composerText = '';
        this.sending = false;
        this.loadThread(true);
        this.loadConversations(true);
      },
      error: (err) => {
        this.sending = false;
        this.dialog.error(err.error?.error || "Couldn't send that message — please try again.");
      },
    });
  }

  onComposerEnter(event: Event) {
    const e = event as KeyboardEvent;
    if (e.shiftKey) return;
    e.preventDefault();
    this.send();
  }

  // ── Quick actions ────────────────────────────────────────────────────────
  useOfferDraft() {
    this.composerText = OFFER_DRAFT;
  }

  openPaymentModal() {
    this.paymentAmount = null;
    this.showPaymentModal = true;
  }

  sendPaymentLink() {
    if (!this.selected || !this.paymentAmount || this.paymentAmount <= 0 || this.sendingPayment) return;
    this.sendingPayment = true;
    this.api.sendPaymentLink(this.selected.customerId, this.paymentAmount).subscribe({
      next: () => {
        this.sendingPayment = false;
        this.showPaymentModal = false;
        this.loadThread(true);
        this.loadConversations(true);
      },
      error: (err) => {
        this.sendingPayment = false;
        this.dialog.error(err.error?.error || "Couldn't create that payment link.");
      },
    });
  }

  sendLoyaltyReminder() {
    if (!this.selected || this.sendingLoyalty) return;
    this.sendingLoyalty = true;
    this.api.sendLoyaltyReminder(this.selected.customerId).subscribe({
      next: (res) => {
        this.sendingLoyalty = false;
        if (res.skippedOptedOut || res.skippedNoConsent) {
          this.dialog.warn("This customer hasn't given marketing consent, so no loyalty reminder was sent.");
        } else {
          this.loadThread(true);
          this.loadConversations(true);
        }
      },
      error: (err) => {
        this.sendingLoyalty = false;
        this.dialog.error(err.error?.error || "Couldn't send the loyalty reminder.");
      },
    });
  }
}
