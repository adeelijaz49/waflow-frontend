import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { I18nService } from '../../../../i18n/i18n.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbStateService } from '../../onb-state.service';

/**
 * The clipboard hand-off to AI Mode (shared by Step 5 and by the customers / products prompts). AI Mode has no prefill (ai-mode.ts is
 * not touched), so the sentence goes to the clipboard. Resolves true only when the browser accepted it; false (no clipboard API, or
 * refused) means the screen shows the sentence for a manual copy. Never rejects.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') return Promise.resolve(false);
    return clip.writeText(text).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

// "Ask AI Mode what to do next": the secondary action under the result of the customers and the products prompt (spec: "if AI Mode is
// available, let it suggest what to do next based on what's been added"). It copies ONE short sentence that names what was added
// (a count, never a name, a phone number or any other personal data) and offers the router link to /ai-mode, exactly like Step 5.
// Available = the page can be opened: AI Mode is an unconditional entry of the app menu (no flag or setting exists for it), so the only
// time it is out of reach is the onboarding lock (ONBOARDING_UNLOCK_AT=finished keeps every page but the allow-listed ones locked).
// The styles come from the host screen (`onb-prompts.css`).
@Component({
  selector: 'app-onb-ai-next',
  imports: [RouterLink, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (available()) {
      <div class="onb-stack onb-tight" data-ai-next>
        <div>
          <button type="button" class="onb-link" data-act="ai-next" (click)="ask()">{{ 'onboarding.aiNext.cta' | t }}</button>
        </div>
        @if (shown()) {
          <div class="onb-stack onb-tight" role="status">
            @if (copied()) {
              <span data-ai-copied>{{ 'onboarding.promotion.first.aiCopied' | t }}</span>
            } @else {
              <p class="onb-prompt-ai" data-ai-prompt>{{ promptText() }}</p>
            }
            <a class="onb-link" routerLink="/ai-mode" data-act="ai-open">{{ 'onboarding.promotion.first.aiOpen' | t }}</a>
          </div>
        }
      </div>
    }
  `,
})
export class OnbAiNext {
  /** What was added: picks the sentence. */
  readonly kind = input.required<'customers' | 'products'>();
  /** How many were added (a count only). */
  readonly count = input.required<number>();

  private readonly i18n = inject(I18nService);
  private readonly state = inject(OnbStateService);
  private readonly announcer = inject(OnbAnnouncer);

  readonly shown = signal(false);
  readonly copied = signal(false);

  /** Out of reach only while the app is locked (the page would be veiled and inert). */
  readonly available = computed(() => !this.state.locked());
  /** The sentence for AI Mode, in the language of the screen. */
  readonly promptText = computed(() => {
    const n = Math.floor(this.count());
    return this.i18n.t(`onboarding.aiNext.${this.kind()}`, { n: Number.isFinite(n) && n > 0 ? n : 0 });
  });

  ask(): void {
    this.shown.set(true);
    this.copied.set(false);
    void copyToClipboard(this.promptText()).then((ok) => {
      if (!ok) return;
      this.copied.set(true);
      this.announcer.say('onboarding.promotion.first.aiCopied');
    });
  }
}
