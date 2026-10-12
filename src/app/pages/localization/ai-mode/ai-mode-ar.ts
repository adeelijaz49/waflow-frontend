import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { SettingsService } from '../../../shared/settings.service';
import type { AiLanguagePref, AiModeInsight, AiModePendingAction } from '../localization.types';
import { errorCode, errorStatus, errorText } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import { AimConfirmCard } from './aim-confirm-card';
import {
  COUNTER_FROM, MAX_MESSAGE_LENGTH, STRIP_PROMPTS, newSessionId, readStoredSession, storeSession,
} from './aim-helpers';
import { AimSuggestions } from './aim-suggestions';
import { AimBubble, AimThread } from './aim-thread';

// AI Mode in Arabic: a parallel page backed by the new localisation agent
// (/api/localization/ai-mode/*). The existing AI Mode page is untouched.
// The human-approval gate is unchanged: nothing is executed unless the user
// presses Confirm on the card for the server-stored pending action.
@Component({
  selector: 'app-loc-ai-mode-ar',
  imports: [FormsModule, ...I18N_DIRECTIVES, ...I18N_PIPES, AimThread, AimConfirmCard, AimSuggestions],
  templateUrl: './ai-mode-ar.html',
  styleUrls: ['./ai-mode-ar.css', './ai-mode-ar-side.css'],
})
export class AiModeAr {
  private readonly api = inject(LocalizationApiService);
  private readonly settings = inject(SettingsService);
  private readonly ui = inject(LocUiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(I18nService);

  readonly scrollEl = viewChild<ElementRef<HTMLDivElement>>('scrollEl');
  readonly inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('inputEl');

  readonly maxLength = MAX_MESSAGE_LENGTH;
  readonly stripPrompts = STRIP_PROMPTS;
  readonly languageOptions: AiLanguagePref[] = ['auto', 'en', 'ar'];

  readonly sessionId = signal(readStoredSession());
  readonly messages = signal<AimBubble[]>([]);
  readonly pendingAction = signal<AiModePendingAction | null>(null);
  readonly input = signal('');
  readonly sending = signal(false);
  readonly confirming = signal(false);
  readonly loadingSession = signal(true);
  readonly error = signal<string | null>(null);
  readonly failedText = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly merchantName = signal('');
  readonly replyLang = signal<AiLanguagePref>('auto');
  readonly insights = signal<AiModeInsight[]>([]);
  readonly suggestionsOpen = signal(false);

  readonly insightLang = computed<Lang>(() => {
    const pref = this.replyLang();
    return pref === 'auto' ? this.i18n.lang() : pref;
  });
  readonly locked = computed(() => this.sending() || this.confirming() || !!this.pendingAction() || this.loadingSession());
  readonly canSend = computed(() => !this.locked() && this.input().trim().length > 0 && this.input().length <= MAX_MESSAGE_LENGTH);
  readonly showCounter = computed(() => this.input().length >= COUNTER_FROM);

  constructor() {
    this.settings.settings.pipe(takeUntilDestroyed()).subscribe((s) => this.merchantName.set(s.merchantName || ''));
    this.restoreSession(this.sessionId());
    this.api.getMyPrefs().pipe(takeUntilDestroyed()).subscribe({
      next: (p) => this.replyLang.set(p.aiLanguage),
      error: () => { /* keep "Automatic" */ },
    });
    effect(() => {
      const lang = this.insightLang();
      untracked(() => this.loadInsights(lang));
    });
  }

  // ── session ──────────────────────────────────────────────────────────────
  private restoreSession(id: string): void {
    this.api.aiModeSession(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => {
        if (id !== this.sessionId()) return;
        this.messages.set((s.messages ?? []).map((m) => ({ role: m.role, text: m.text })));
        this.pendingAction.set(s.pendingAction ?? null);
        this.loadingSession.set(false);
        this.scrollToBottom();
      },
      error: (err) => {
        if (id !== this.sessionId()) return;
        this.loadingSession.set(false);
        // A brand-new session has nothing stored yet (404): that is normal.
        if (errorStatus(err) !== 404 && errorCode(err) !== 'SESSION_NOT_FOUND') this.error.set(errorText(this.i18n, err));
      },
    });
  }

  newChat(): void {
    if (this.sending() || this.confirming()) return;
    this.sessionId.set(storeSession(newSessionId()));
    this.messages.set([]);
    this.pendingAction.set(null);
    this.error.set(null);
    this.failedText.set(null);
    this.notice.set(null);
    this.input.set('');
    this.loadingSession.set(false);
    this.syncInputHeight();
  }

  // ── reply language ───────────────────────────────────────────────────────
  setReplyLang(value: string): void {
    const pref: AiLanguagePref = value === 'en' || value === 'ar' ? value : 'auto';
    this.replyLang.set(pref);
    this.api.updateMyPrefs({ aiLanguage: pref }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: (err) => this.ui.toast(errorText(this.i18n, err), 'error'),
    });
  }

  langLabel(opt: AiLanguagePref): string {
    return opt === 'auto' ? this.i18n.t('aimode.lang.auto') : this.i18n.t(opt === 'en' ? 'common.english' : 'common.arabic');
  }

  // ── insights ─────────────────────────────────────────────────────────────
  private loadInsights(lang: Lang): void {
    this.api.aiModeInsights(lang).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { if (lang === this.insightLang()) this.insights.set(res.items ?? []); },
      error: () => { if (lang === this.insightLang()) this.insights.set([]); },
    });
  }

  // ── input ────────────────────────────────────────────────────────────────
  // Prompts and insight cards only FILL the input; the user still presses Send.
  fillInput(text: string): void {
    if (this.locked()) return;
    this.input.set(text);
    this.suggestionsOpen.set(false);
    this.syncInputHeight();
    this.inputEl()?.nativeElement.focus();
  }

  onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.send();
  }

  autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  private syncInputHeight(): void {
    setTimeout(() => {
      const el = this.inputEl()?.nativeElement;
      if (el) this.autoGrow(el);
    });
  }

  // ── send / retry ─────────────────────────────────────────────────────────
  send(): void {
    if (!this.canSend()) return;
    const text = this.input().trim();
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.input.set('');
    this.syncInputHeight();
    this.deliver(text);
  }

  retry(): void {
    const text = this.failedText();
    if (!text || this.sending() || this.pendingAction()) return;
    this.deliver(text);
  }

  private deliver(text: string): void {
    this.sending.set(true);
    this.error.set(null);
    this.failedText.set(null);
    this.notice.set(null);
    this.scrollToBottom();
    this.api.aiModeMessage({ sessionId: this.sessionId(), message: text, language: this.replyLang() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (turn) => {
          this.messages.update((m) => [...m, { role: 'assistant', text: turn.reply }]);
          this.pendingAction.set(turn.pendingAction ?? null);
          this.sending.set(false);
          this.scrollToBottom();
        },
        error: (err) => {
          this.sending.set(false);
          this.failedText.set(text);
          this.error.set(errorText(this.i18n, err));
          this.scrollToBottom();
        },
      });
  }

  // ── the confirm gate ─────────────────────────────────────────────────────
  decide(confirm: boolean): void {
    const action = this.pendingAction();
    if (!action || this.confirming()) return;
    this.confirming.set(true);
    this.error.set(null);
    this.failedText.set(null);
    this.api.aiModeConfirm({ sessionId: this.sessionId(), actionId: action.id, confirm })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.messages.update((m) => [...m, { role: 'assistant', text: res.reply }]);
          this.pendingAction.set(null);
          this.confirming.set(false);
          this.scrollToBottom();
        },
        error: (err) => {
          this.confirming.set(false);
          if (errorStatus(err) === 409 || errorCode(err) === 'ACTION_NOT_PENDING') {
            // Already handled (or superseded): drop the card and say so.
            this.pendingAction.set(null);
            this.notice.set(errorText(this.i18n, err));
          } else {
            // Keep the card: the server clears the action before running it, so a retry either
            // completes it or answers "no longer pending".
            this.error.set(`${errorText(this.i18n, err)} ${this.i18n.t('aimode.confirm.failed')}`);
          }
          this.scrollToBottom();
        },
      });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scrollEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
