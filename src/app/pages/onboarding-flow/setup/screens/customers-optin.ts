import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import type { ConsentMode } from '../../customers/csv';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { CUSTOMER_URLS, PromptScreenBase } from './onb-c-kit';

type Choice = 'yes' | 'unsure';

// Customers prompt, screen O: "Did these customers agree to get WhatsApp messages from you?"
// Compliance (DF 3.7, spec 0b / 8): nothing is selected and the confirmation box is unticked on entry. "Yes" needs the explicit tick
// of the attestation before Continue works; "Not sure" imports everyone WITHOUT marketing consent. When the file has its own
// opt-in column, "yes" confirms only the rows marked yes there; every other row is imported without consent either way, and so is
// every row marked no or unsubscribed (an explicit negative wins over any answer).
// Consent is never guessed (R6-03): a column that looks like consent but is not the opt-in column we understand is named on screen and
// switches the "all of them agreed" answer OFF (only "Not sure" is left); the merchant can rename the column Opt-in and upload again.
@Component({
  selector: 'app-onb-customers-optin',
  imports: [OnbFocus, OnbHelp, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    @if (flow.parsed()) {
      <section class="onb-stack">
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">
          {{ (fromFile() ? 'onboarding.customers.optin.fileTitle' : 'onboarding.customers.optin.title') | t }}
        </h1>
        @if (unknown().length > 0) {
          <div class="onb-alert onb-alert-warn" id="onb-cust-optin-unknown" role="note">
            <span class="onb-alert-icon" aria-hidden="true">!</span>
            <div class="onb-stack onb-tight">
              <span>{{ (blocked() ? 'onboarding.customers.optin.unknownBlocked' : 'onboarding.customers.optin.unknownIgnored') | t }}</span>
              <ul class="onb-prompt-columns" data-columns="unknown">
                @for (c of unknown(); track $index) {
                  <li appUserText>{{ c }}</li>
                }
              </ul>
            </div>
          </div>
        }
        @if (optOut().length > 0) {
          <div class="onb-alert onb-alert-info" id="onb-cust-optin-optout" role="note">
            <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
            <div class="onb-stack onb-tight">
              <span>{{ 'onboarding.customers.optin.optOutFound' | t }}</span>
              <ul class="onb-prompt-columns" data-columns="optout">
                @for (c of optOut(); track $index) {
                  <li appUserText>{{ c }}</li>
                }
              </ul>
            </div>
          </div>
        }
        <fieldset class="onb-choices">
          <legend class="onb-sr">{{ (fromFile() ? 'onboarding.customers.optin.fileTitle' : 'onboarding.customers.optin.title') | t }}</legend>
          <label class="onb-choice" [class.onb-prompt-choice-off]="blocked()">
            <input type="radio" name="onb-cust-optin" value="yes" id="onb-cust-optin-yes" [checked]="choice() === 'yes'" [disabled]="blocked()"
              [attr.aria-describedby]="blocked() ? 'onb-cust-optin-unknown' : null" (change)="pick('yes')" />
            <span class="onb-choice-name">{{ (fromFile() ? 'onboarding.customers.optin.fileYes' : 'onboarding.customers.optin.yes') | t }}</span>
          </label>
          <label class="onb-choice">
            <input type="radio" name="onb-cust-optin" value="unsure" id="onb-cust-optin-unsure" [checked]="choice() === 'unsure'" (change)="pick('unsure')" />
            <span class="onb-choice-name">{{ 'onboarding.customers.optin.unsure' | t }}</span>
          </label>
        </fieldset>
        <div class="onb-alert onb-alert-info" id="onb-cust-optin-warning">
          <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
          <span>{{ 'onboarding.customers.optin.warning' | t }}</span>
        </div>
        @if (choice() === 'yes') {
          <label class="onb-check" for="onb-cust-attest">
            <input type="checkbox" id="onb-cust-attest" [checked]="attest()" (change)="onAttest($event)" />
            <span>{{ 'onboarding.customers.attest' | t }}</span>
          </label>
        }
        <div class="onb-bar">
          <button type="button" id="onb-cust-optin-continue" class="onb-btn onb-btn-primary" [disabled]="!canContinue()" (click)="next()">{{ 'onboarding.common.continue' | t }}</button>
          <div class="onb-bar-links">
            <button type="button" class="onb-link" (click)="back()">{{ 'onboarding.common.back' | t }}</button>
            <app-onb-help />
          </div>
        </div>
      </section>
    }
  `,
})
export class CustomersOptinScreen extends PromptScreenBase {
  readonly flow = inject(CustomersFlowService);
  /** Nothing is selected on entry and the tick is never pre-set. */
  readonly choice = signal<Choice | null>(null);
  readonly attest = signal(false);
  readonly fromFile = computed(() => this.flow.parsed()?.hasOptInColumn === true);
  /** Columns that look like consent but are not understood (named on screen, never used as consent). */
  readonly unknown = computed(() => this.flow.parsed()?.unknownConsentColumns ?? []);
  /** Opt-out columns that are understood (a marked row is always added without permission). */
  readonly optOut = computed(() => this.flow.parsed()?.optOutColumns ?? []);
  /** "Yes, all of them agreed" is off: a consent-like column of the file is not understood. */
  readonly blocked = this.flow.shortcutBlocked;
  readonly canContinue = computed(() => this.choice() === 'unsure' || (this.choice() === 'yes' && !this.blocked() && this.attest()));

  constructor() {
    super();
    // A deep link without a parsed list (refresh, bookmark): back to the first screen.
    if (!this.flow.parsed()) void this.router.navigateByUrl(CUSTOMER_URLS.method, { replaceUrl: true });
  }

  pick(c: Choice): void {
    if (c === 'yes' && this.blocked()) return;
    this.choice.set(c);
    this.attest.set(false); // changing the answer always clears the confirmation
  }

  onAttest(e: Event): void {
    this.attest.set((e.target as HTMLInputElement).checked);
  }

  back(): void {
    void this.router.navigateByUrl(this.flow.fileName() !== null ? CUSTOMER_URLS.upload : CUSTOMER_URLS.paste);
  }

  next(): void {
    if (!this.canContinue()) return;
    const yes = this.choice() === 'yes' && this.attest();
    const mode: ConsentMode = yes ? (this.fromFile() ? 'rows' : 'all') : 'none';
    this.flow.setConsent(mode, yes);
    void this.router.navigateByUrl(CUSTOMER_URLS.preview);
  }
}
