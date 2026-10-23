import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, signal, untracked } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError, BusinessScreenBase } from './onb-a-kit';
import { BUSINESS_COUNTRIES, DEFAULT_COUNTRY, isAnswered, nextBusinessUrl, validBusinessName } from './onb-business-rules';

// Step 1, screen 1 of 4: "What's your business called?" + country. Skipped on the way through when the answer is known
// (saved, or a valid name captured at checkout: it is then saved for the merchant and shown on the next screen with "Change").
@Component({
  selector: 'app-onb-business-name',
  imports: [OnbFocus, OnbHelp, OnbAError, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack">
      @if (!ready() || skipping()) {
        <div class="onb-row" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.common.loading' | t }}</span></div>
      } @else {
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.business" onbStep="business">{{ 'onboarding.business.name.title' | t }}</h1>
        <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
          <div>
            <label class="onb-label" for="onb-biz-name">{{ 'onboarding.business.name.field' | t }}</label>
            <input id="onb-biz-name" class="onb-input" type="text" appUserText autocomplete="organization" enterkeyhint="next" maxlength="120"
              [value]="name()" (input)="onName($event)" [attr.aria-invalid]="fieldError() ? 'true' : null" aria-describedby="onb-biz-name-err" />
            @if (fieldError()) {
              <p id="onb-biz-name-err" class="onb-field-error" role="alert">{{ 'onboarding.business.error.name' | t }}</p>
            }
          </div>
          <div>
            <label class="onb-label" for="onb-biz-country">{{ 'onboarding.business.country' | t }}</label>
            <select id="onb-biz-country" class="onb-select" autocomplete="country" (change)="onCountry($event)">
              @for (c of countries; track c) {
                <option [value]="c" [selected]="country() === c">{{ 'onboarding.country.' + c | t }}</option>
              }
            </select>
          </div>
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="submit" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ 'onboarding.common.continue' | t }}</button>
            <div class="onb-bar-links"><span></span><app-onb-help /></div>
          </div>
        </form>
      }
    </section>
  `,
})
export class BusinessNameScreen extends BusinessScreenBase {
  protected readonly field = 'name' as const;
  readonly countries = BUSINESS_COUNTRIES;
  readonly name = signal('');
  readonly country = signal(DEFAULT_COUNTRY);
  /** True while a known answer is being passed through (no flash of the question). */
  readonly skipping = signal(false);
  private started = false;
  /** Arrived with the browser's back button: a known answer is shown, not skipped (no trap). */
  private readonly viaBack = this.router.currentNavigation()?.trigger === 'popstate';

  constructor() {
    super();
    this.fieldId = 'onb-biz-name';
    effect(() => {
      const ready = this.ready();
      untracked(() => {
        if (ready && !this.started) {
          this.started = true;
          this.start();
        }
      });
    });
  }

  private start(): void {
    const s = this.state.state();
    const b = s?.business ?? null;
    const prefill = validBusinessName(s?.prefill?.businessName);
    const savedName = validBusinessName(b?.name);
    this.name.set(savedName ?? prefill ?? '');
    this.country.set(b?.country && BUSINESS_COUNTRIES.includes(b.country) ? b.country : DEFAULT_COUNTRY);
    if (this.editing || this.viaBack || !s) return;
    if (isAnswered('name', b)) {
      this.skipping.set(true);
      void this.router.navigateByUrl(nextBusinessUrl('name', b), { replaceUrl: true });
    } else if (prefill && !savedName) {
      // a valid name from checkout: save it, show it on the next screen (with "Change"); on failure the question appears
      this.skipping.set(true);
      this.save({ name: prefill, country: this.country() }, 'name', undefined, () => this.skipping.set(false));
    }
  }

  onName(e: Event): void {
    this.name.set((e.target as HTMLInputElement).value);
    if (this.fieldError()) this.fieldError.set(false);
  }

  onCountry(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.country.set(BUSINESS_COUNTRIES.includes(v) ? v : DEFAULT_COUNTRY);
  }

  submit(e: Event): void {
    e.preventDefault();
    if (this.busy()) return;
    const name = validBusinessName(this.name());
    if (!name) {
      this.fieldError.set(true);
      this.focusField();
      return;
    }
    this.save({ name, country: this.country() }, 'name');
  }
}
