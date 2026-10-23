import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { rejectReasonText } from './customers-preview';
import { OnbAiNext } from './onb-ai-handoff';
import { CUSTOMER_URLS, PromptScreenBase } from './onb-c-kit';

// Customers prompt, screen R: "128 added, 4 skipped (invalid numbers)", the skipped rows to download, and what to do about
// customers added without a recorded opt-in. `done` is recorded as soon as at least one customer exists (the server checks).
@Component({
  selector: 'app-onb-customers-result',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, OnbAiNext, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    @if (flow.result(); as r) {
      <section class="onb-stack">
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.result.line' | t: { added: r.added, skipped: r.skipped } }}</h1>
        @if (r.duplicates > 0) {
          <ul class="onb-prompt-counts">
            <li id="onb-cust-res-dupes">{{ 'onboarding.customers.result.dupes' | t: { n: r.duplicates } }}</li>
          </ul>
        }
        @if (r.withoutOptin > 0) {
          <div class="onb-alert onb-alert-info" id="onb-cust-res-nooptin">
            <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
            <div class="onb-stack onb-tight">
              <span>{{ 'onboarding.customers.result.noOptin' | t: { n: r.withoutOptin } }}</span>
              <a class="onb-link" routerLink="/customers">{{ 'onboarding.customers.result.ask' | t }}</a>
            </div>
          </div>
        }
        @if (r.skipped > 0) {
          <div>
            <button type="button" class="onb-link" id="onb-cust-res-download" [disabled]="downloading()" (click)="download()">{{ 'onboarding.customers.preview.download' | t }}</button>
          </div>
        }
        @if (r.added > 0) {
          <app-onb-ai-next kind="customers" [count]="r.added" />
        }
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          @if (hasCustomers()) {
            <button type="button" id="onb-cust-res-continue" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="finish()">{{ 'onboarding.common.continue' | t }}</button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" id="onb-cust-res-more" (click)="more()">{{ 'onboarding.customers.result.more' | t }}</button>
              <app-onb-help />
            </div>
          } @else {
            <button type="button" id="onb-cust-res-more" class="onb-btn onb-btn-primary" (click)="more()">{{ 'onboarding.customers.result.more' | t }}</button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" id="onb-cust-res-skip" [disabled]="busy()" (click)="skip('customers')">{{ 'onboarding.common.skip' | t }}</button>
              <app-onb-help />
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class CustomersResultScreen extends PromptScreenBase {
  readonly flow = inject(CustomersFlowService);
  readonly downloading = signal(false);
  /** At least one customer exists because of this import (added now, or already in the list). */
  readonly hasCustomers = computed(() => {
    const r = this.flow.result();
    return !!r && (r.added > 0 || r.duplicates > 0);
  });

  constructor() {
    super();
    const r = this.flow.result();
    if (!r) {
      // A deep link without a result (refresh, bookmark): back to the first screen.
      void this.router.navigateByUrl(CUSTOMER_URLS.method, { replaceUrl: true });
      return;
    }
    this.announcer.say('onboarding.customers.result.line', { added: r.added, skipped: r.skipped });
    if (this.hasCustomers()) this.markDone('customers', true);
  }

  finish(): void {
    if (this.busy()) return;
    this.clearError();
    this.busy.set(true);
    this.markDone('customers', false, () => {
      this.busy.set(false);
      void this.router.navigateByUrl(CUSTOMER_URLS.dashboard);
    });
    // markDone shows an error through fail(), which also clears busy
  }

  more(): void {
    this.flow.reset();
    void this.router.navigateByUrl(CUSTOMER_URLS.method);
  }

  download(): void {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.clearError();
    this.flow
      .downloadSkipped((reason) => rejectReasonText(this.i18n, reason))
      .then(() => this.downloading.set(false))
      .catch((err: unknown) => {
        this.downloading.set(false);
        this.fail(err);
      });
  }
}
