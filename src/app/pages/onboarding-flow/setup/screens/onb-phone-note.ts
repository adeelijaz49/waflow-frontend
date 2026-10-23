import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { I18nService } from '../../../../i18n/i18n.service';
import { phoneCountry, phoneExample } from '../../customers/phone';

// One short line under every place a phone number is typed, pasted or uploaded (R6-01): how a number WITHOUT a country code is read.
// "Numbers without a country code are treated as Saudi Arabia (+966)." For "Another country" there is no calling code to assume, so the
// line asks for the country code on every number and shows a pattern (a phone number is always an LTR isolate).
@Component({
  selector: 'app-onb-phone-note',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <p class="onb-muted" data-phone-note [attr.data-country]="dial().key" [attr.id]="noteId()">
      @if (dial().cc; as code) {
        {{ 'onboarding.customers.phone.note' | t: { country: countryName(), code: code } }}
      } @else {
        {{ 'onboarding.customers.phone.noteOther' | t }} <span appPhone>{{ example() }}</span>
      }
    </p>
  `,
})
export class OnbPhoneNote {
  private readonly i18n = inject(I18nService);

  /** The country of Step 1 (`state.business.country`); null / empty = Saudi Arabia, the default of Step 1. */
  readonly country = input<string | null | undefined>(null);
  /** An id for `aria-describedby` of the field the line belongs to. */
  readonly noteId = input<string | null>(null);

  readonly dial = computed(() => phoneCountry(this.country()));
  readonly countryName = computed(() => this.i18n.t(`onboarding.country.${this.dial().key}`));
  readonly example = computed(() => phoneExample(this.country()));
}
