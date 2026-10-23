import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2, Path A: "Where is that number used today?" Four tappable rows. "Not on WhatsApp at all" sends the answer and goes
// straight to Step 3; the other three open their own guidance screen first (nothing is sent until that screen's button).
@Component({
  selector: 'app-onb-number-where',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.where.title' | t }}</h1>
      <div class="onb-stack">
        <button type="button" class="onb-answer" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="unused()">{{ 'onboarding.number.where.none' | t }}</button>
        <button type="button" class="onb-answer" [disabled]="busy()" (click)="open(urls.personal)">{{ 'onboarding.number.where.personal' | t }}</button>
        <button type="button" class="onb-answer" [disabled]="busy()" (click)="open(urls.businessApp)">{{ 'onboarding.number.where.business' | t }}</button>
        <button type="button" class="onb-answer" [disabled]="busy()" (click)="open(urls.landline)">{{ 'onboarding.number.where.landline' | t }}</button>
      </div>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <div class="onb-bar-links">
          <a class="onb-link" [routerLink]="urls.question">{{ 'onboarding.common.back' | t }}</a>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class NumberWhereScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;

  unused(): void {
    this.answer({ hasNumber: true, usage: 'unused' }, NUMBER_URLS.connect);
  }

  open(url: string): void {
    if (this.busy()) return;
    void this.router.navigateByUrl(url);
  }
}
