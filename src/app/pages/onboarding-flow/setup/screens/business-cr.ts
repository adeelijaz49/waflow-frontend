import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, inject, signal, untracked } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { LocUiService } from '../../../localization/shared/loc-ui.service';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError, OnbASummary, BusinessScreenBase } from './onb-a-kit';
import { validCrNumber } from './onb-business-rules';

// Step 1, screen 4 of 4: the commercial registration (CR) number. Only the NUMBER is collected: there is no upload control
// (decision D14: the existing upload store is public). "I don't have it yet" is always possible and is remembered so Step 4
// can offer to add it later.
@Component({
  selector: 'app-onb-business-cr',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbASummary, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.business" onbStep="business">{{ 'onboarding.business.cr.title' | t }}</h1>
      <app-onb-a-summary />
      <p class="onb-lead">{{ 'onboarding.business.cr.body' | t }}</p>
      <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
        <div>
          <label class="onb-label" for="onb-biz-cr">{{ 'onboarding.business.cr.field' | t }}</label>
          <input id="onb-biz-cr" class="onb-input" type="text" dir="ltr" inputmode="text" autocomplete="off" enterkeyhint="done"
            autocapitalize="characters" spellcheck="false" maxlength="40"
            [value]="value()" (input)="onInput($event)" [attr.aria-invalid]="fieldError() ? 'true' : null" aria-describedby="onb-biz-cr-err" />
          @if (fieldError()) {
            <p id="onb-biz-cr-err" class="onb-field-error" role="alert">{{ 'onboarding.business.error.cr' | t }}</p>
          }
        </div>
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="submit" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ 'onboarding.common.continue' | t }}</button>
          <div class="onb-bar-links">
            <button type="button" class="onb-link" [disabled]="busy()" (click)="skip()">{{ 'onboarding.business.cr.skip' | t }}</button>
            <app-onb-help />
          </div>
        </div>
      </form>
    </section>
  `,
})
export class BusinessCrScreen extends BusinessScreenBase {
  protected readonly field = 'cr' as const;
  private readonly toast = inject(LocUiService, { optional: true });
  readonly value = signal('');
  private started = false;

  constructor() {
    super();
    this.fieldId = 'onb-biz-cr';
    effect(() => {
      const cr = this.state.state()?.business?.crNumber ?? null;
      untracked(() => {
        if (this.started || this.state.state() === null) return;
        this.started = true;
        this.value.set(cr ?? '');
      });
    });
  }

  onInput(e: Event): void {
    this.value.set((e.target as HTMLInputElement).value);
    if (this.fieldError()) this.fieldError.set(false);
  }

  submit(e: Event): void {
    e.preventDefault();
    if (this.busy()) return;
    const cr = validCrNumber(this.value());
    if (!cr) {
      this.fieldError.set(true);
      this.focusField();
      return;
    }
    this.save({ crNumber: cr }, 'cr');
  }

  /** "I don't have it yet": one idempotent write, a short reassurance, then on to Step 2. */
  skip(): void {
    if (this.busy()) return;
    this.save({ crSkipped: true }, 'cr', () => {
      this.analytics.track('step_skip', 'business', 'cr_skipped');
      this.toast?.toast(this.i18n.t('onboarding.business.cr.skipped'), 'info');
      this.announcer.say('onboarding.business.cr.skipped');
    });
  }
}
