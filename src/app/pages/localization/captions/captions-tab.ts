import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, containsArabic } from '../../../i18n';
import { AiApplied, AiAssist } from '../shared/ai-assist';
import { LocUiService } from '../shared/loc-ui.service';
import { CaptionPreview } from './caption-preview';
import { CAPTION_LIMITS, captionStats, copyText, limitState, normalizeNewlines } from './caption-tokens';

const DRAFT_KEY = 'waflow_caption_draft';

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable: the draft just isn't remembered
  }
}

// Caption workbench: write/paste a caption, get AI drafts, preview it RTL/LTR
// as an Instagram viewer would see it, check limits, copy it. Nothing is saved
// on the server and nothing is posted from here.
@Component({
  selector: 'app-loc-captions-tab',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, RouterLink, AiAssist, CaptionPreview],
  templateUrl: './captions-tab.html',
  styleUrl: './captions-tab.css',
})
export class CaptionsTab {
  private readonly ui = inject(LocUiService);
  readonly i18n = inject(I18nService);
  readonly limits = CAPTION_LIMITS;

  readonly text = signal(readDraft());
  readonly restored = signal(this.text().length > 0);
  readonly previous = signal<string | null>(null);
  readonly expanded = signal(false);
  readonly viewer = signal<'ltr' | 'rtl'>(this.i18n.dir());

  readonly stats = computed(() => captionStats(this.text()));
  readonly textLang = computed(() => (containsArabic(this.text()) ? 'ar' : 'en'));
  readonly charsState = computed(() => limitState(this.stats().chars, CAPTION_LIMITS.chars));
  readonly tagsState = computed(() => limitState(this.stats().hashtags, CAPTION_LIMITS.hashtags));
  readonly mentionsState = computed(() => limitState(this.stats().mentions, CAPTION_LIMITS.mentions));
  readonly isBilingual = computed(() => {
    const t = this.text();
    return containsArabic(t) && /[A-Za-z]{2,}/.test(t.replace(/(?:https?:\/\/|www\.)\S+|[#@]\S+/gu, ''));
  });
  readonly hasText = computed(() => this.text().trim().length > 0);

  onInput(event: Event): void {
    this.setText((event.target as HTMLTextAreaElement).value);
    this.restored.set(false);
  }

  private setText(value: string): void {
    const v = normalizeNewlines(value);
    this.text.set(v);
    writeDraft(v);
  }

  // Only runs when the user presses "Use this draft"; keeps one undo level.
  applyDraft(applied: AiApplied): void {
    this.previous.set(this.text());
    this.setText(applied.text);
    this.restored.set(false);
    this.expanded.set(false);
  }

  undo(): void {
    const prev = this.previous();
    if (prev === null) return;
    this.setText(prev);
    this.previous.set(null);
  }

  clear(): void {
    this.setText('');
    this.previous.set(null);
    this.restored.set(false);
    this.expanded.set(false);
  }

  async copy(): Promise<void> {
    if (!this.hasText()) return;
    const ok = await copyText(this.text());
    this.ui.toast(this.i18n.t(ok ? 'common.copied' : 'captions.copyFailed'), ok ? 'success' : 'error');
  }
}
