import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, signal } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import type { OnbTemplateRow } from '../../onb.types';
import { OnbScreenBase } from './onb-a-kit';

/** Approved templates among the rows the server returned (case-insensitive; the internal test template is not counted). Pure. */
export function approvedTemplateCount(rows: readonly (Pick<OnbTemplateRow, 'status'> & { key?: string })[] | null | undefined): number {
  return (rows ?? []).filter((r) => r?.key !== 'setup_test' && typeof r?.status === 'string' && r.status.toUpperCase() === 'APPROVED').length;
}

/** Products plus services added, or null when the server did not count either (the line is then left out). Pure. */
export function catalogCount(counts: { products?: number | null; services?: number | null } | null | undefined): number | null {
  const p = counts?.products;
  const s = counts?.services;
  if (typeof p !== 'number' && typeof s !== 'number') return null;
  return (typeof p === 'number' ? p : 0) + (typeof s === 'number' ? s : 0);
}

// Step 5, screen D: the celebration (DF 3.9). Short and honest: it says what is true from the state, never promises
// sending that the account cannot do yet, and uses a small CSS tick (no confetti, no motion when the visitor asks for less).
@Component({
  selector: 'app-onb-done',
  imports: [OnbFocus, OnbHelp, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-promotion.css'],
  template: `
    <section class="onb-promo onb-promo-done" [attr.data-variant]="sent() ? 'sent' : 'finished'" [attr.aria-busy]="busy()">
      <span class="onb-promo-check" aria-hidden="true">&#10003;</span>
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.done.title" onbStep="promotion">{{ 'onboarding.done.title' | t }}</h1>
      <p class="onb-lead">{{ (sent() ? 'onboarding.done.sent' : 'onboarding.done.finished') | t }}</p>
      @if (notSending()) {
        <p class="onb-alert onb-alert-info" role="note" data-policy="block"><span class="onb-alert-icon" aria-hidden="true">&#8505;</span><span>{{ 'onboarding.promotion.first.blocked' | t }}</span></p>
      }
      <ul class="onb-promo-lines">
        @if (numberMasked(); as n) {
          <li data-line="connected">
            {{ 'onboarding.done.connected' | t: { phone: n } }}
            @if (verifiedName(); as v) {
              <span appUserText>({{ v }})</span>
            }
          </li>
        }
        @if (templates() !== null) {
          <li data-line="templates">{{ 'onboarding.done.templates' | t: { n: templates() } }}</li>
        }
        @if (customers() !== null) {
          <li data-line="customers">{{ 'onboarding.done.customers' | t: { n: customers() } }}</li>
        }
        @if (products() !== null) {
          <li data-line="products">{{ 'onboarding.home.count.products' | t: { n: products() } }}</li>
        }
      </ul>
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" data-act="dashboard" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="goDashboard()">{{ 'onboarding.done.go' | t }}</button>
        <div class="onb-bar-links"><span></span><app-onb-help /></div>
      </div>
    </section>
  `,
})
export class DoneScreen extends OnbScreenBase {
  /** Templates the server reports as approved (null = unknown: the line is left out). */
  readonly templates = signal<number | null>(null);
  /** The send policy is "block": sending from the merchant's own number is not switched on yet. */
  readonly policyBlock = signal(false);

  readonly sent = computed(() => this.state.state()?.firstPromotion?.state === 'done');
  readonly notSending = computed(() => !this.sent() && this.policyBlock());
  readonly numberMasked = computed(() => this.state.state()?.connection?.numberMasked ?? null);
  readonly verifiedName = computed(() => this.state.state()?.connection?.verifiedName ?? null);
  readonly customers = computed(() => {
    const c = this.state.state()?.prompts?.counts?.customers;
    return typeof c === 'number' ? c : null;
  });
  readonly products = computed(() => catalogCount(this.state.state()?.prompts?.counts));

  constructor() {
    super();
    this.announcer.say('onboarding.done.title');
    this.api.templates().subscribe({
      next: (r) => this.templates.set(approvedTemplateCount(r?.templates)),
      error: () => undefined, // the line is simply left out
    });
    this.api.firstPromotion().subscribe({
      next: (d) => this.policyBlock.set(d?.sendPolicy !== 'platform_number'),
      error: () => undefined,
    });
  }

  /** Re-reads the state (the server now says the setup is finished) and lands on the dashboard. */
  goDashboard(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.state
      .reloadNow()
      .catch(() => null)
      .finally(() => {
        this.busy.set(false);
        void this.go('/dashboard');
      });
  }
}
