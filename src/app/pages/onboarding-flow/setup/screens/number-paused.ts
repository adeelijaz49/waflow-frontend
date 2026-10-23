import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2 paused: the merchant is still getting a number. This is also where the app lands while `number.paused` (the server
// says the setup is waiting for the number). Nothing is lost; WaFlow reminds by e-mail and in the app, never on WhatsApp.
@Component({
  selector: 'app-onb-number-paused',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.paused.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.number.paused.body' | t }}</p>
      <p class="onb-badge onb-badge-waiting"><span aria-hidden="true">&#8214;</span> {{ 'onboarding.number.paused.badge' | t }}</p>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="ready()">{{ 'onboarding.number.getone.ready' | t }}</button>
        <div class="onb-bar-links">
          <a class="onb-link" [routerLink]="urls.help">{{ 'onboarding.number.getone.help' | t }}</a>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class NumberPausedScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;

  ready(): void {
    this.numberReady();
  }
}
