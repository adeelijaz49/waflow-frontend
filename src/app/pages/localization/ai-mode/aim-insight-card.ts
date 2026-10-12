import { Component, input, output } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES } from '../../../i18n';
import type { AiModeInsight } from '../localization.types';

// Localised twin of the dashboard's insight card: logical CSS, no English
// relative-time strings. Clicking it only reports the pick; the page decides
// (it fills the chat input and never sends).
@Component({
  selector: 'app-aim-insight-card',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './aim-insight-card.html',
  styleUrl: './aim-insight-card.css',
})
export class AimInsightCard {
  readonly insight = input.required<AiModeInsight>();
  readonly showFallbackMarker = input(false);
  readonly pick = output<AiModeInsight>();
}
