import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2, Path A, "it's a landline": Meta verifies a fixed line with a phone call, so the merchant is told to be ready for it.
@Component({
  selector: 'app-onb-number-landline',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.landline.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.number.landline.body' | t }}</p>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="next()">{{ 'onboarding.common.continue' | t }}</button>
        <div class="onb-bar-links">
          <a class="onb-link" [routerLink]="urls.where">{{ 'onboarding.common.back' | t }}</a>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class NumberLandlineScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;

  next(): void {
    this.answer({ hasNumber: true, usage: 'landline' }, NUMBER_URLS.connect);
  }
}
