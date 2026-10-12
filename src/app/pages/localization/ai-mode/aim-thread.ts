import { Component, input, output } from '@angular/core';
import { I18N_PIPES } from '../../../i18n';

export interface AimBubble {
  role: 'user' | 'assistant';
  text: string;
}

// The conversation bubbles. Every bubble is dir="auto" so Arabic aligns to the
// right, English to the left and mixed text stays readable; no markdown.
@Component({
  selector: 'app-aim-thread',
  imports: [...I18N_PIPES],
  templateUrl: './aim-thread.html',
  styleUrl: './aim-thread.css',
})
export class AimThread {
  readonly messages = input.required<AimBubble[]>();
  readonly sending = input(false);
  readonly error = input<string | null>(null);
  readonly canRetry = input(false);
  readonly retry = output<void>();
}
