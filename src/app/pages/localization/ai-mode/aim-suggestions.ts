import { Component, input, output } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { inject } from '@angular/core';
import type { AiModeInsight } from '../localization.types';
import { AimInsightCard } from './aim-insight-card';
import { OWN_WORDS_KEYS, PROMPT_GROUPS } from './aim-helpers';

// Suggested prompts (three groups + "in your own words" Gulf examples) and the
// Smart Insights cards. Picking anything only emits text for the chat input.
@Component({
  selector: 'app-aim-suggestions',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES, AimInsightCard],
  templateUrl: './aim-suggestions.html',
  styleUrl: './aim-suggestions.css',
})
export class AimSuggestions {
  readonly i18n = inject(I18nService);
  readonly insights = input<AiModeInsight[]>([]);
  readonly insightLang = input<Lang>('en');
  readonly pickText = output<string>();

  readonly groups = PROMPT_GROUPS;
  readonly ownWords = OWN_WORDS_KEYS;

  pickInsight(i: AiModeInsight): void {
    this.pickText.emit(`${i.title}. ${i.message}`);
  }
}
