import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { SAUDI_TELECOM_GUIDANCE_URL } from '../../onb-links';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2, Path B ("I need a number"): one scrolling screen of plain tips, then the pause. No regulatory rule is stated; the
// merchant is pointed to the operator and the regulator. "I've got my number" resumes with Step 3.
@Component({
  selector: 'app-onb-number-get-one',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.getone.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.number.getone.body' | t }}</p>
      <p><strong>{{ 'onboarding.number.getone.tips' | t }}</strong></p>
      <ul class="onb-tips">
        <li>{{ 'onboarding.number.getone.t1' | t }}</li>
        <li>{{ 'onboarding.number.getone.t2' | t }}</li>
        <li>{{ 'onboarding.number.getone.t3' | t }}</li>
        <li>
          {{ 'onboarding.number.getone.t4' | t }}
          <a class="onb-link" [href]="regulatorUrl" target="_blank" rel="noopener noreferrer">{{ 'onboarding.number.getone.link' | t }}</a>
        </li>
      </ul>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="ready()">{{ 'onboarding.number.getone.ready' | t }}</button>
        <div class="onb-bar-links">
          <a class="onb-link" [routerLink]="urls.help">{{ 'onboarding.number.getone.help' | t }}</a>
          <app-onb-help />
        </div>
        <a class="onb-link" [routerLink]="urls.paused" (click)="later()">{{ 'onboarding.number.getone.later' | t }}</a>
      </div>
    </section>
  `,
})
export class NumberGetOneScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;
  readonly regulatorUrl = SAUDI_TELECOM_GUIDANCE_URL;

  ready(): void {
    this.numberReady();
  }

  /** "I'll come back later": the server already holds the pause (Path B); this only records the choice. */
  later(): void {
    this.analytics.track('step_skip', 'number', 'number_paused');
  }
}
