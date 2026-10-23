import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { ApiService } from '../../../../services/api.service';
import { PHONE_MAX_DIGITS, PHONE_MIN_DIGITS, normalizePhone, phoneExample } from '../../customers/phone';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { CUSTOMER_URLS, PromptScreenBase } from './onb-c-kit';
import { OnbPhoneNote } from './onb-phone-note';

/** Name -> firstname / lastname exactly as the existing onboarding wizard does (a single word is used for both). */
export function splitName(full: string): { firstname: string; lastname: string } {
  const parts = full.trim().split(/\s+/);
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') || parts[0] };
}

// Customers prompt, screen 1: add one customer. The consent checkbox is UNTICKED on every entry and after every add; ticking it is
// the merchant's own statement for this one customer (the same flag the existing customer form sets).
@Component({
  selector: 'app-onb-customers-one',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbPhoneNote, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    <section class="onb-stack">
      @if (added() === 0 || adding()) {
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.one.title' | t }}</h1>
        <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
          <div>
            <label class="onb-label" for="onb-cust-name">{{ 'onboarding.customers.one.name' | t }}</label>
            <input id="onb-cust-name" class="onb-input" type="text" appUserText autocomplete="off" enterkeyhint="next" maxlength="120"
              [value]="name()" (input)="onName($event)" [attr.aria-invalid]="nameError() ? 'true' : null" aria-describedby="onb-cust-name-err" />
            @if (nameError()) {
              <p id="onb-cust-name-err" class="onb-field-error" role="alert">{{ 'onboarding.customers.one.nameNeeded' | t }}</p>
            }
          </div>
          <div>
            <label class="onb-label" for="onb-cust-phone">{{ 'onboarding.customers.one.phone' | t }}</label>
            <input id="onb-cust-phone" class="onb-input" type="tel" inputmode="tel" dir="ltr" autocomplete="off" enterkeyhint="done" maxlength="30"
              [value]="phone()" (input)="onPhone($event)" [attr.aria-invalid]="phoneError() ? 'true' : null" aria-describedby="onb-cust-phone-note onb-cust-phone-err" />
            <app-onb-phone-note [country]="businessCountry()" noteId="onb-cust-phone-note" />
            @if (phoneError() === 'needed') {
              <p id="onb-cust-phone-err" class="onb-field-error" role="alert">{{ 'onboarding.customers.one.phoneNeeded' | t }}</p>
            } @else if (phoneError() === 'country') {
              <p id="onb-cust-phone-err" class="onb-field-error" role="alert">{{ 'onboarding.customers.one.phoneCountryNeeded' | t: { example: example() } }}</p>
            } @else if (phoneError() === 'invalid') {
              <p id="onb-cust-phone-err" class="onb-field-error" role="alert">{{ 'onboarding.customers.one.phoneInvalid' | t: { min: minDigits, max: maxDigits, example: example() } }}</p>
            }
          </div>
          <label class="onb-check" for="onb-cust-agreed">
            <input type="checkbox" id="onb-cust-agreed" [checked]="agreed()" (change)="onAgreed($event)" />
            <span>{{ 'onboarding.customers.one.agreed' | t }}</span>
          </label>
          @if (rejected()) {
            <div class="onb-alert onb-alert-error" role="alert" tabindex="-1" id="onb-cust-one-error">
              <span class="onb-alert-icon" aria-hidden="true">!</span>
              <span>{{ 'onboarding.customers.one.error' | t: { example: example() } }}</span>
            </div>
          }
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="submit" id="onb-cust-one-add" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ 'onboarding.customers.one.add' | t }}</button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" (click)="back()">{{ 'onboarding.common.back' | t }}</button>
              <app-onb-help />
            </div>
          </div>
        </form>
      } @else {
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.one.added' | t }}</h1>
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="button" id="onb-cust-one-done" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="done()">{{ 'onboarding.common.done' | t }}</button>
          <button type="button" id="onb-cust-one-another" class="onb-btn onb-btn-secondary" (click)="another()">{{ 'onboarding.customers.one.another' | t }}</button>
          <div class="onb-bar-links"><span></span><app-onb-help /></div>
        </div>
      }
    </section>
  `,
})
export class CustomersOneScreen extends PromptScreenBase {
  private readonly customers = inject(ApiService);
  /** How a full number of the workspace country is written (a pattern for the messages, never a real number). */
  readonly example = computed(() => phoneExample(this.businessCountry()));
  readonly minDigits = PHONE_MIN_DIGITS;
  readonly maxDigits = PHONE_MAX_DIGITS;
  readonly name = signal('');
  readonly phone = signal('');
  /** Never true until the merchant ticks the box; reset after every add. */
  readonly agreed = signal(false);
  readonly nameError = signal(false);
  /** '' = fine, 'needed' = empty, 'country' = no country code and the workspace country has none to assume, 'invalid' = not a number (checked here before anything is sent). */
  readonly phoneError = signal<'' | 'needed' | 'country' | 'invalid'>('');
  /** The server refused this customer (400): shows the plain "check the phone number" message. */
  readonly rejected = signal(false);
  /** How many customers were added on this screen. */
  readonly added = signal(0);
  /** The form is shown again after "Add another". */
  readonly adding = signal(false);

  onName(e: Event): void {
    this.name.set((e.target as HTMLInputElement).value);
    this.nameError.set(false);
    this.rejected.set(false);
  }

  onPhone(e: Event): void {
    this.phone.set((e.target as HTMLInputElement).value);
    this.phoneError.set('');
    this.rejected.set(false);
  }

  onAgreed(e: Event): void {
    this.agreed.set((e.target as HTMLInputElement).checked === true);
  }

  back(): void {
    this.open(CUSTOMER_URLS.method);
  }

  submit(e: Event): void {
    e.preventDefault();
    if (this.busy()) return;
    const name = this.name().trim();
    const phone = this.phone().trim();
    // The server does NOT normalise a customer created one by one (it stores the text as it gets it, and WhatsApp's own lookups match the
    // number exactly). So the number is read HERE with the country of Step 1 (Arabic digits, 0501234567, +966 50 123 4567 and 00966... all
    // become 966501234567) and sent as digits only. A number that is not a number never leaves the screen.
    const number = normalizePhone(phone, this.businessCountry());
    const phoneOk = !!phone && number.ok;
    this.nameError.set(!name);
    this.phoneError.set(!phone ? 'needed' : phoneOk ? '' : number.reason === 'country_code_needed' ? 'country' : 'invalid');
    if (!name || !phoneOk) {
      setTimeout(() => document.getElementById(!name ? 'onb-cust-name' : 'onb-cust-phone')?.focus());
      return;
    }
    this.busy.set(true);
    this.clearError();
    this.rejected.set(false);
    const { firstname, lastname } = splitName(name);
    this.customers.createCustomer({ firstname, lastname, phone: number.e164Digits, marketingConsent: this.agreed() === true }).subscribe({
      next: () => {
        this.busy.set(false);
        this.added.update((n) => n + 1);
        this.adding.set(false);
        this.name.set('');
        this.phone.set('');
        this.agreed.set(false);
        this.announcer.say('onboarding.customers.one.added');
        this.markDone('customers', true); // background: at least one customer now exists
      },
      error: (err: unknown) => {
        const status = (err as { status?: unknown } | null)?.status;
        if (status === 400) {
          // The raw server text is never shown (it may echo the input).
          this.help.setLastError('VALIDATION_FAILED');
          this.busy.set(false);
          this.rejected.set(true);
          setTimeout(() => document.getElementById('onb-cust-one-error')?.focus());
        } else {
          this.fail(err);
        }
      },
    });
  }

  another(): void {
    this.adding.set(true);
    this.clearError();
    this.rejected.set(false);
  }

  done(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.markDone('customers', false, () => {
      this.busy.set(false);
      this.open(CUSTOMER_URLS.dashboard);
    });
  }
}
