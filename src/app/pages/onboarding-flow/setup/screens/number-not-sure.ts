import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';

// Step 2 explainer behind "Not sure?": what the number is for, in the owner's two sentences. Nothing is sent.
@Component({
  selector: 'app-onb-number-not-sure',
  imports: [RouterLink, OnbFocus, OnbHelp, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.q.notSure' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.number.notSure.body' | t }}</p>
      <div class="onb-bar">
        <a class="onb-btn onb-btn-primary" routerLink="/setup/number">{{ 'onboarding.number.notSure.back' | t }}</a>
        <div class="onb-bar-links"><span></span><app-onb-help /></div>
      </div>
    </section>
  `,
})
export class NumberNotSureScreen {}
