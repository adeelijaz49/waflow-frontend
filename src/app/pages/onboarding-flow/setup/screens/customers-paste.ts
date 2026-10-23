import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { MAX_IMPORT_BYTES, parsePasteText } from '../../customers/csv';
import { pasteSampleLine } from '../../customers/phone';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { CUSTOMER_URLS, CustomersListBase } from './onb-c-kit';
import { OnbPhoneNote } from './onb-phone-note';

// Customers prompt, screen P: "Paste your customers", one per line (name, phone and, if known, yes / no for the permission). The text
// stays in memory while the merchant goes back from the next screen, and is dropped when the flow is reset. The sample line in the box
// is written in the way people of the workspace country write a number (phone.ts pasteSampleLine).
@Component({
  selector: 'app-onb-customers-paste',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbPhoneNote, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.paste.title' | t }}</h1>
      <form class="onb-stack" novalidate (submit)="check($event)" [attr.aria-busy]="busy()">
        <div>
          <label class="onb-label" for="onb-cust-paste">{{ 'onboarding.customers.paste.hint' | t }}</label>
          <textarea id="onb-cust-paste" class="onb-textarea onb-prompt-paste" rows="8" dir="auto" appUserText autocomplete="off" spellcheck="false"
            [placeholder]="example()" aria-describedby="onb-cust-paste-note" [value]="flow.pasteText()" (input)="onText($event)"></textarea>
        </div>
        <app-onb-phone-note [country]="businessCountry()" noteId="onb-cust-paste-note" />
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="submit" id="onb-cust-check" class="onb-btn onb-btn-primary" [disabled]="!hasText() || busy()" [attr.aria-busy]="busy()">{{ 'onboarding.customers.paste.check' | t }}</button>
          <div class="onb-bar-links">
            <button type="button" class="onb-link" (click)="open(urls.method)">{{ 'onboarding.common.back' | t }}</button>
            <app-onb-help />
          </div>
        </div>
      </form>
    </section>
  `,
})
export class CustomersPasteScreen extends CustomersListBase {
  readonly urls = CUSTOMER_URLS;
  readonly example = computed(() => pasteSampleLine(this.businessCountry()));
  readonly hasText = computed(() => this.flow.pasteText().trim().length > 0);

  onText(e: Event): void {
    this.flow.pasteText.set((e.target as HTMLTextAreaElement).value);
    this.clearError();
  }

  check(e: Event): void {
    e.preventDefault();
    if (this.busy()) return;
    const text = this.flow.pasteText();
    if (!text.trim()) return;
    this.busy.set(true);
    this.clearError();
    if (text.length > MAX_IMPORT_BYTES) {
      this.fail({ code: 'ONB_IMPORT_BAD_FILE' });
      return;
    }
    this.accept(parsePasteText(text, { country: this.businessCountry() }), null);
  }
}
