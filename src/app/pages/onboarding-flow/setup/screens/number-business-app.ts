import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

/**
 * The ONLY copy of this screen (a spec asserts it): everything stated here was verified against Meta's current documentation.
 * No country is named, nothing is said to be free, and availability is never promised: Meta decides when the merchant connects.
 */
export const BUSINESS_APP_KEYS: readonly string[] = [
  'onboarding.number.bizapp.title',
  'onboarding.number.bizapp.body',
  'onboarding.number.bizapp.changes',
  'onboarding.number.bizapp.c1',
  'onboarding.number.bizapp.c2',
  'onboarding.number.bizapp.c3',
  'onboarding.number.bizapp.c4',
  'onboarding.number.bizapp.go',
  'onboarding.number.bizapp.move',
  'onboarding.number.bizapp.other',
] as const;

// Step 2, Path A, "on the WhatsApp Business app": keep the app and WaFlow on the same number if Meta offers it, or move the
// number, or use a different one.
@Component({
  selector: 'app-onb-number-business-app',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.bizapp.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.number.bizapp.body' | t }}</p>
      <p><strong>{{ 'onboarding.number.bizapp.changes' | t }}</strong></p>
      <ul class="onb-tips">
        <li>{{ 'onboarding.number.bizapp.c1' | t }}</li>
        <li>{{ 'onboarding.number.bizapp.c2' | t }}</li>
        <li>{{ 'onboarding.number.bizapp.c3' | t }}</li>
        <li>{{ 'onboarding.number.bizapp.c4' | t }}</li>
      </ul>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="keep()">{{ 'onboarding.number.bizapp.go' | t }}</button>
        <div class="onb-bar-links">
          <a class="onb-link" [routerLink]="urls.migrate">{{ 'onboarding.number.bizapp.move' | t }}</a>
          <app-onb-help />
        </div>
        <div class="onb-bar-links">
          <button type="button" class="onb-link" [disabled]="busy()" (click)="different()">{{ 'onboarding.number.bizapp.other' | t }}</button>
          <a class="onb-link" [routerLink]="urls.where">{{ 'onboarding.common.back' | t }}</a>
        </div>
      </div>
    </section>
  `,
})
export class NumberBusinessAppScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;

  /** Keep the app on the number (coexistence): whether Meta offers it is decided in the connect window. */
  keep(): void {
    this.answer({ hasNumber: true, usage: 'business_app', businessAppChoice: 'coexistence' }, NUMBER_URLS.connect);
  }

  different(): void {
    this.pathB({ hasNumber: true, usage: 'business_app', businessAppChoice: 'different_number' });
  }
}
