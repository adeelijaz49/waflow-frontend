import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { SettingsService } from '../../shared/settings.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface PendingAction {
  id: string;
  toolName: string;
  args: any;
  summary: string;
}

const SESSION_KEY = 'waflow_ai_mode_session_id';

@Component({
  selector: 'app-ai-mode',
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-mode.html',
  styleUrl: './ai-mode.css',
})
export class AiMode implements OnInit {
  @ViewChild('threadEl') threadEl?: ElementRef<HTMLDivElement>;

  merchantName = '';
  sessionId = '';
  messages: ChatMessage[] = [];
  pendingAction: PendingAction | null = null;
  input = '';
  sending = false;
  confirming = false;
  loadingSession = true;
  error: string | null = null;

  readonly chips = [
    'How many customers returned this month?',
    'Which customer has the most loyalty points?',
    'Which promotion performed best?',
    "Who hasn't ordered in over a month?",
    'Send a loyalty reminder to my top customers',
  ];

  constructor(private api: ApiService, private settings: SettingsService) {}

  ngOnInit() {
    this.settings.settings.subscribe(s => this.merchantName = s.merchantName || '');

    this.sessionId = localStorage.getItem(SESSION_KEY) || crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, this.sessionId);

    this.api.getAiChatSession(this.sessionId).subscribe({
      next: (res) => {
        this.messages = res.messages || [];
        this.pendingAction = res.pendingAction || null;
        this.loadingSession = false;
        this.scrollToBottom();
      },
      error: () => { this.loadingSession = false; },
    });
  }

  useChip(text: string) {
    this.input = text;
  }

  send() {
    const text = this.input.trim();
    if (!text || this.sending) return;

    this.messages.push({ role: 'user', text });
    this.input = '';
    this.sending = true;
    this.error = null;
    this.scrollToBottom();

    this.api.sendAiChatMessage(this.sessionId, text).subscribe({
      next: (res) => {
        this.messages.push({ role: 'assistant', text: res.reply });
        this.pendingAction = res.pendingAction || null;
        this.sending = false;
        this.scrollToBottom();
      },
      error: (err) => {
        this.sending = false;
        this.error = err.error?.error || 'Something went wrong — please try again.';
      },
    });
  }

  confirmAction(confirm: boolean) {
    if (!this.pendingAction || this.confirming) return;
    this.confirming = true;
    this.error = null;
    const actionId = this.pendingAction.id;

    this.api.confirmAiAction(this.sessionId, actionId, confirm).subscribe({
      next: (res) => {
        this.messages.push({ role: 'assistant', text: res.reply });
        this.pendingAction = res.pendingAction || null;
        this.confirming = false;
        this.scrollToBottom();
      },
      error: (err) => {
        this.confirming = false;
        this.error = err.error?.error || "That didn't go through — please try again.";
      },
    });
  }

  private scrollToBottom() {
    setTimeout(() => {
      const el = this.threadEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
