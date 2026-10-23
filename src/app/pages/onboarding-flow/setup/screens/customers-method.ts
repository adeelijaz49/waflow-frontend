import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject } from '@angular/core';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { CUSTOMER_URLS, PromptScreenBase } from './onb-c-kit';

// Customers prompt, screen M: "How would you like to add your customers?" Three equal answers and "Skip for now".
// Entering here forgets any list from an earlier visit (the flow state lives in memory only).
@Component({
  selector: 'app-onb-customers-method',
  imports: [OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.method.title' | t }}</h1>
      <div class="onb-stack">
        <button type="button" class="onb-answer" id="onb-cust-upload" (click)="open(urls.upload)">{{ 'onboarding.customers.method.upload' | t }}</button>
        <button type="button" class="onb-answer" id="onb-cust-paste" (click)="open(urls.paste)">{{ 'onboarding.customers.method.paste' | t }}</button>
        <button type="button" class="onb-answer" id="onb-cust-one" (click)="open(urls.one)">{{ 'onboarding.customers.method.one' | t }}</button>
      </div>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <div class="onb-bar-links">
          <button type="button" class="onb-link" id="onb-cust-skip" [disabled]="busy()" (click)="skip('customers')">{{ 'onboarding.common.skip' | t }}</button>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class CustomersMethodScreen extends PromptScreenBase {
  readonly urls = CUSTOMER_URLS;

  constructor() {
    super();
    inject(CustomersFlowService).reset();
  }
}
