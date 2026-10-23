import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2: "Do you already have a WhatsApp Business number?" A question, not a form: two equal-weight answers (no primary
// button) and a "Not sure?" explainer. The answer is one idempotent POST /number/path.
@Component({
  selector: 'app-onb-number-question',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.q.title' | t }}</h1>
      <div class="onb-stack">
        <button type="button" class="onb-answer" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="yes()">{{ 'onboarding.number.q.yes' | t }}</button>
        <button type="button" class="onb-answer" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="no()">{{ 'onboarding.number.q.no' | t }}</button>
      </div>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <div class="onb-bar-links">
          <a class="onb-link" routerLink="/setup/number/not-sure">{{ 'onboarding.number.q.notSure' | t }}</a>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class NumberQuestionScreen extends NumberScreenBase {
  // The backend needs the usage with a Path A answer (POST /number/path {hasNumber:true} alone is a 422 and, if it were accepted, would
  // finish Step 2 early): "Yes" only moves on, the answer is sent with the usage on the next screen. Found by the real-browser run (I4).
  yes(): void {
    if (this.busy()) return;
    void this.router.navigateByUrl(NUMBER_URLS.where);
  }

  no(): void {
    this.pathB({ hasNumber: false });
  }
}
