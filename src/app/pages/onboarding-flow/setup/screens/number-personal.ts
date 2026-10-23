import { ChangeDetectionStrategy, Component, ViewEncapsulation, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { onbErrorCode } from '../../onb-error';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2, Path A, "on my personal WhatsApp": the warning gate. The merchant must tick that they understand they will lose
// WhatsApp on the number before the answer is sent. The tick never starts ticked; the server refuses the answer without it
// (422 NUMBER_PERSONAL_WARNING_REQUIRED) and the box is shown again.
@Component({
  selector: 'app-onb-number-personal',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.personal.title' | t }}</h1>
      <div class="onb-alert onb-alert-warn" role="alert">
        <span class="onb-alert-icon" aria-hidden="true">!</span>
        <span>{{ 'onboarding.number.personal.warning' | t }}</span>
      </div>
      <p class="onb-lead">{{ 'onboarding.number.personal.how' | t }}</p>
      <label class="onb-check">
        <input id="onb-personal-ack" type="checkbox" [checked]="ack()" (change)="onAck($event)" />
        <span>{{ 'onboarding.number.personal.ack' | t }}</span>
      </label>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="!ack() || busy()" [attr.aria-busy]="busy()" (click)="confirm()">{{ 'onboarding.number.personal.go' | t }}</button>
        <div class="onb-bar-links">
          <button type="button" class="onb-link" [disabled]="busy()" (click)="different()">{{ 'onboarding.number.personal.other' | t }}</button>
          <app-onb-help />
        </div>
        <a class="onb-link" [routerLink]="urls.where">{{ 'onboarding.common.back' | t }}</a>
      </div>
    </section>
  `,
})
export class NumberPersonalScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;
  /** Never starts ticked: consent is always an explicit act. */
  readonly ack = signal(false);

  onAck(e: Event): void {
    this.ack.set((e.target as HTMLInputElement).checked);
  }

  confirm(): void {
    if (!this.ack()) return;
    this.answer({ hasNumber: true, usage: 'personal', acknowledgeRemoval: true }, NUMBER_URLS.connect, (err) => {
      if (onbErrorCode(err) === 'NUMBER_PERSONAL_WARNING_REQUIRED') {
        this.ack.set(false);
        setTimeout(() => document.getElementById('onb-personal-ack')?.focus());
      }
    });
  }

  /** "Choose a different number": Path B. */
  different(): void {
    this.pathB({ hasNumber: false });
  }
}
