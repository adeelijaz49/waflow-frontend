import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import type { I18nService } from '../../../../i18n/i18n.service';
import { LocalizationFlagService } from '../../../../services/localization-flag.service';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import type { RejectReason } from '../../customers/csv';
import { PHONE_MAX_DIGITS, PHONE_MIN_DIGITS } from '../../customers/phone';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { CUSTOMER_URLS, PromptScreenBase } from './onb-c-kit';

/** Catalogue key of the reason written into the skipped-rows download for a row rejected on this side. */
export const REJECT_REASON_KEYS: Record<RejectReason, string> = {
  missing_name: 'onboarding.customers.reason.missingName',
  missing_phone: 'onboarding.customers.reason.missingPhone',
  invalid_phone: 'onboarding.customers.reason.invalidPhone',
  country_code_needed: 'onboarding.customers.reason.countryCodeNeeded',
  unreadable: 'onboarding.customers.reason.unreadable',
};

/** The (localised) text of a client-side rejection, for the Reason column of the skipped-rows download. */
export function rejectReasonText(i18n: Pick<I18nService, 't'>, reason: RejectReason): string {
  const key = REJECT_REASON_KEYS[reason];
  return reason === 'invalid_phone' ? i18n.t(key, { min: PHONE_MIN_DIGITS, max: PHONE_MAX_DIGITS }) : i18n.t(key);
}

// Customers prompt, screen V: "132 customers found" with what can and cannot be added, and the one button that does it.
// The import job(s) are created and validated here (never before the opt-in answer), and only run when the merchant presses Add.
@Component({
  selector: 'app-onb-customers-preview',
  imports: [OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    @if (flow.parsed() && flow.consent() !== null) {
      <section class="onb-stack">
        @if (phase() === 'ready' && flow.preview(); as p) {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.preview.title' | t: { total: p.total } }}</h1>
          <ul class="onb-prompt-counts">
            <li id="onb-cust-prev-ok">{{ 'onboarding.customers.preview.ok' | t: { n: p.canAdd } }}</li>
            @if (p.cannotAdd > 0) {
              <li data-bad id="onb-cust-prev-bad">{{ 'onboarding.customers.preview.bad' | t: { n: p.cannotAdd } }}</li>
            }
            @if (p.unreadable > 0) {
              <li data-bad id="onb-cust-prev-unreadable">{{ 'onboarding.customers.preview.unreadable' | t: { n: p.unreadable } }}</li>
            }
            @if (p.duplicates > 0) {
              <li id="onb-cust-prev-dupes">{{ 'onboarding.customers.preview.dupes' | t: { n: p.duplicates } }}</li>
            }
            @if (p.repeated > 0) {
              <li id="onb-cust-prev-repeated">{{ 'onboarding.customers.preview.repeated' | t: { n: p.repeated } }}</li>
            }
          </ul>
          @if (p.conflicting > 0) {
            <div class="onb-alert onb-alert-info" id="onb-cust-prev-conflict" role="note">
              <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
              <span>{{ 'onboarding.customers.preview.conflicting' | t: { n: p.conflicting } }}</span>
            </div>
          }
          @if (p.withoutOptin > 0) {
            <div class="onb-alert onb-alert-info" id="onb-cust-prev-nooptin">
              <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
              <span>{{ 'onboarding.customers.preview.noOptin' | t: { n: p.withoutOptin } }}</span>
            </div>
          }
          @if (p.cannotAdd > 0) {
            <div>
              <button type="button" class="onb-link" id="onb-cust-prev-download" [disabled]="downloading()" (click)="download()">{{ 'onboarding.customers.preview.download' | t }}</button>
            </div>
          }
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="button" id="onb-cust-prev-add" class="onb-btn onb-btn-primary" [disabled]="p.canAdd === 0 || busy()" [attr.aria-busy]="busy()" (click)="add()">
              {{ 'onboarding.customers.preview.add' | t: { n: p.canAdd } }}
            </button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" (click)="back()">{{ 'onboarding.common.back' | t }}</button>
              <app-onb-help />
            </div>
          </div>
        } @else {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.stepName' | t }}</h1>
          @if (phase() === 'loading') {
            <div class="onb-row" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.common.loading' | t }}</span></div>
          } @else {
            <app-onb-a-error [error]="error()" />
            <div class="onb-bar">
              <button type="button" id="onb-cust-prev-retry" class="onb-btn onb-btn-primary" (click)="start()">{{ 'onboarding.common.tryAgain' | t }}</button>
              <div class="onb-bar-links">
                <button type="button" class="onb-link" (click)="back()">{{ 'onboarding.common.back' | t }}</button>
                <app-onb-help />
              </div>
            </div>
          }
        }
      </section>
    }
  `,
})
export class CustomersPreviewScreen extends PromptScreenBase {
  readonly flow = inject(CustomersFlowService);
  private readonly flag = inject(LocalizationFlagService);
  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly downloading = signal(false);

  constructor() {
    super();
    // A deep link without a list or an answer (refresh, bookmark): back to the first screen.
    if (!this.flow.parsed() || this.flow.consent() === null) {
      void this.router.navigateByUrl(CUSTOMER_URLS.method, { replaceUrl: true });
    } else {
      this.start();
    }
  }

  start(): void {
    this.phase.set('loading');
    this.clearError();
    this.announcer.say('onboarding.common.loading');
    this.flow.prepare(this.flag.arabicEnabled()).subscribe({
      next: () => {
        this.phase.set('ready');
        this.busy.set(false);
        this.announcer.say('onboarding.customers.preview.title', { total: this.flow.preview()?.total ?? 0 });
      },
      error: (err: unknown) => {
        this.phase.set('error');
        this.fail(err);
      },
    });
  }

  back(): void {
    const needsAnswer = this.flow.needsOptInQuestion();
    void this.router.navigateByUrl(needsAnswer ? CUSTOMER_URLS.optin : this.flow.fileName() !== null ? CUSTOMER_URLS.upload : CUSTOMER_URLS.paste);
  }

  add(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.announcer.say('onboarding.common.loading');
    this.flow.run().subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigateByUrl(CUSTOMER_URLS.result);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  download(): void {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.clearError();
    this.flow
      .downloadSkipped((r) => rejectReasonText(this.i18n, r))
      .then(() => this.downloading.set(false))
      .catch((err: unknown) => {
        this.downloading.set(false);
        this.fail(err);
      });
  }
}
