import {
  ChangeDetectionStrategy, Component, HostListener, OnDestroy, ViewEncapsulation, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { pathOf } from '../../onb-links';
import { ONB_EXTERNAL_NAVIGATE, OnbAError, OnbScreenBase, safeExternalUrl } from './onb-a-kit';

export type BillingMode = 'loading' | 'none' | 'pending' | 'pastDue' | 'cancelled' | 'cancelReturn' | 'active';

/** Polling cadence while the payment is being confirmed: every 5 s for the first 2 minutes, then every 30 s. */
export const BILLING_POLL_FAST_MS = 5_000;
export const BILLING_POLL_SLOW_MS = 30_000;
export const BILLING_FAST_WINDOW_MS = 120_000;
/** One server-side billing re-check (POST /billing/refresh) this long after the screen starts waiting. */
export const BILLING_REFRESH_AFTER_MS = 10_000;

// Access states (spec 1b, DF 3.1). One component for /setup/billing and for the dashboard takeover (`<app-onb-billing />`).
// It never shows a step and never calls a step endpoint. Plan names come from /state only (nothing is priced here), the
// Stripe return (?checkout=return) is never treated as proof of payment (only the server's `active` moves the merchant on).
@Component({
  selector: 'app-onb-billing',
  imports: [OnbFocus, OnbHelp, OnbAError, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      @if (mode() === 'loading') {
        @if (state.failed()) {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.title">{{ 'onboarding.title' | t }}</h1>
          <app-onb-a-error [error]="{ error: { code: 'ONB_STATE_UNAVAILABLE' } }" />
          <button type="button" class="onb-btn onb-btn-primary" (click)="reload()">{{ 'onboarding.common.tryAgain' | t }}</button>
        } @else {
          <div class="onb-row" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.common.loading' | t }}</span></div>
        }
      } @else if (mode() === 'active') {
        <!-- the server says active: the screen is only a moment on its way to the landing step -->
        <div class="onb-row" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.billing.confirmed' | t }}</span></div>
      } @else if (mode() === 'pending') {
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.billing.pending.title" onbStep="billing">{{ 'onboarding.billing.pending.title' | t }}</h1>
        <p class="onb-lead">{{ (stillWaiting() ? 'onboarding.billing.stillWaiting' : 'onboarding.billing.pending.body') | t }}</p>
        <div class="onb-row"><span class="onb-spinner" aria-hidden="true"></span></div>
        @if (checkedNow()) {
          <p class="onb-muted" role="status">{{ 'onboarding.common.checkedNow' | t }}</p>
        }
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="checkAgain()">{{ 'onboarding.common.checkAgain' | t }}</button>
          <div class="onb-bar-links">
            @if (isOwner()) {
              <button type="button" class="onb-link" [disabled]="busy()" (click)="startCheckout()">{{ 'onboarding.billing.pending.retry' | t }}</button>
            } @else {
              <span class="onb-muted">{{ 'onboarding.strip.askOwner' | t }}</span>
            }
            <app-onb-help />
          </div>
        </div>
      } @else if (mode() === 'pastDue') {
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.billing.pastDue.title" onbStep="billing">{{ 'onboarding.billing.pastDue.title' | t }}</h1>
        <p class="onb-lead">{{ 'onboarding.billing.pastDue.body' | t }}</p>
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          @if (isOwner()) {
            <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="openPortal()">{{ 'onboarding.billing.pastDue.cta' | t }}</button>
          } @else {
            <p class="onb-alert onb-alert-info" role="note">{{ 'onboarding.strip.askOwner' | t }}</p>
          }
          <div class="onb-bar-links"><span></span><app-onb-help /></div>
        </div>
      } @else {
        <!-- none, cancelReturn (back from Stripe without paying) and cancelled share the plan choice and the checkout button -->
        <h1 class="onb-q" tabindex="-1" [attr.data-mode]="mode()" onbFocus="onboarding.billing.cta" onbStep="billing">{{ titleKey() | t }}</h1>
        <p class="onb-lead">{{ bodyKey() | t }}</p>
        @if (manual()) {
          <p class="onb-alert onb-alert-info" role="note">{{ 'onboarding.billing.manual' | t }}</p>
        } @else {
          @if (showChooser()) {
            <fieldset class="onb-choices">
              <legend>{{ 'onboarding.billing.plan' | t }}</legend>
              @for (p of plans(); track p.code) {
                <label class="onb-choice">
                  <input type="radio" name="onb-plan" [value]="p.code" [checked]="chosen() === p.code" (change)="selected.set(p.code)" />
                  <span class="onb-choice-name" appUserText>{{ p.name }}</span>
                </label>
              }
            </fieldset>
          }
          <p class="onb-muted">{{ 'onboarding.billing.metaFees' | t }}</p>
        }
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          @if (manual()) {
            <button type="button" class="onb-btn onb-btn-primary" (click)="help.openSheet()">{{ 'onboarding.help.cta' | t }}</button>
          } @else if (isOwner()) {
            <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="startCheckout()">{{ ctaKey() | t }}</button>
          } @else {
            <p class="onb-alert onb-alert-info" role="note">{{ 'onboarding.strip.askOwner' | t }}</p>
          }
          @if (!manual()) {
            <div class="onb-bar-links"><span></span><app-onb-help /></div>
          }
        </div>
      }
    </section>
  `,
})
export class BillingScreen extends OnbScreenBase implements OnDestroy {
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly navigateExternal = inject(ONB_EXTERNAL_NAVIGATE);

  readonly selected = signal<string | null>(null);
  readonly stillWaiting = signal(false);
  readonly checkedNow = signal(false);
  private readonly manualSeen = signal(false);
  private readonly param = signal<'return' | 'cancel' | null>(this.readParam());

  readonly plans = computed(() => (this.state.state()?.checkout?.plans ?? []).filter((p) => !!p && typeof p.code === 'string' && p.code));
  readonly namedPlans = computed(() => this.plans().length > 1 && this.plans().every((p) => typeof p.name === 'string' && p.name.trim() !== ''));

  readonly mode = computed<BillingMode>(() => {
    if (this.state.state() === null) return 'loading';
    const sub = this.state.subState();
    if (sub === 'active') return 'active';
    if (sub === 'past_due') return 'pastDue';
    if (sub === 'cancelled') return 'cancelled';
    const p = this.param();
    if (p === 'cancel') return 'cancelReturn';
    if (sub === 'pending' || p === 'return') return 'pending';
    return 'none';
  });

  /** Online payment is not switched on: the merchant is asked to tell us, admin activation is the fallback (D1). */
  readonly manual = computed(() => {
    if (this.manualSeen()) return true;
    const s = this.state.state();
    if (s?.checkout?.available === false) return true;
    const mode = this.mode();
    return (mode === 'none' || mode === 'cancelled' || mode === 'cancelReturn') && s?.subscription?.retry?.checkout === false;
  });

  readonly showChooser = computed(() => this.namedPlans());
  /** The plan sent to checkout: the radio choice, else the pre-filled plan, else the first one. No plan at all = none sent. */
  readonly chosen = computed(() => {
    const plans = this.plans();
    const pick = this.selected();
    if (pick && plans.some((p) => p.code === pick)) return pick;
    const pre = this.state.state()?.prefill?.planCode;
    if (pre && plans.some((p) => p.code === pre)) return pre;
    return plans[0]?.code ?? null;
  });

  readonly titleKey = computed(() =>
    this.mode() === 'cancelled' ? 'onboarding.billing.cancelled.title' : this.mode() === 'cancelReturn' ? 'onboarding.billing.cancelReturn.title' : 'onboarding.billing.none.title');
  readonly bodyKey = computed(() => (this.mode() === 'cancelled' ? 'onboarding.billing.cancelled.body' : 'onboarding.billing.none.body'));
  readonly ctaKey = computed(() =>
    this.mode() === 'cancelled' ? 'onboarding.billing.cancelled.cta' : this.mode() === 'cancelReturn' ? 'onboarding.common.tryAgain' : 'onboarding.billing.cta');

  private polling = false;
  private waited = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private sawUnpaid = false;
  private left = false;

  constructor() {
    super();
    effect(() => {
      const mode = this.mode();
      untracked(() => {
        if (mode === 'pending') this.startPolling();
        else this.stopPolling();
        if (mode !== 'active' && mode !== 'loading') this.sawUnpaid = true;
        if (mode === 'active') this.onActive();
      });
    });
  }

  private readParam(): 'return' | 'cancel' | null {
    try {
      const v = this.route?.snapshot?.queryParamMap?.get('checkout');
      return v === 'return' || v === 'cancel' ? v : null;
    } catch {
      return null;
    }
  }

  ngOnDestroy(): void {
    this.left = true;
    this.stopPolling();
  }

  /** Back from Stripe through the browser's back button (page cache): the button must not stay disabled. */
  @HostListener('window:pageshow')
  onPageShow(): void {
    this.busy.set(false);
  }

  reload(): void {
    this.clearError();
    void this.state.reloadNow();
  }

  // ---- checkout / portal -----------------------------------------------------------------------------------

  startCheckout(): void {
    if (this.busy() || !this.isOwner()) return;
    this.clearError();
    this.busy.set(true);
    const plan = this.chosen() ?? undefined;
    this.api.checkout(plan).subscribe({
      next: (res) => this.redirect(res?.url),
      error: (err: unknown) => this.checkoutFailed(err),
    });
  }

  openPortal(): void {
    if (this.busy() || !this.isOwner()) return;
    this.clearError();
    this.busy.set(true);
    this.api.billingPortal().subscribe({
      next: (res) => this.redirect(res?.url),
      error: (err: unknown) => this.fail(err),
    });
  }

  private redirect(url: unknown): void {
    const safe = safeExternalUrl(url, typeof location === 'undefined' ? '' : location.origin);
    if (!safe) {
      this.fail({ error: { code: 'STRIPE_ERROR' } });
      return;
    }
    this.navigateExternal(safe); // busy stays on: the page is leaving
  }

  private checkoutFailed(err: unknown): void {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 409) {
      // a subscription already exists (active or being confirmed): not an error, read the truth again
      this.busy.set(false);
      void this.state.reloadNow();
      this.announcer.say('onboarding.common.checkedNow');
      return;
    }
    if ((err as { error?: { code?: unknown } } | null)?.error?.code === 'CHECKOUT_NOT_CONFIGURED') this.manualSeen.set(true);
    this.fail(err);
  }

  // ---- waiting for the payment -------------------------------------------------------------------------------

  /** [Check again]: ask the server to re-read Stripe (a 429 just means "not yet"), then read the state. */
  checkAgain(): void {
    if (this.busy()) return;
    this.clearError();
    this.busy.set(true);
    const done = (): void => {
      void this.state.reloadNow().finally(() => {
        this.busy.set(false);
        this.checkedNow.set(true);
        this.announcer.say('onboarding.common.checkedNow');
      });
    };
    this.api.billingRefresh().subscribe({ next: done, error: done });
  }

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.waited = 0;
    this.stillWaiting.set(false);
    this.announcer.say('onboarding.billing.pending.title');
    this.schedule();
    this.refreshTimer = setTimeout(() => this.serverRefresh(), BILLING_REFRESH_AFTER_MS);
  }

  private stopPolling(): void {
    this.polling = false;
    clearTimeout(this.pollTimer);
    clearTimeout(this.refreshTimer);
  }

  private schedule(): void {
    if (!this.polling) return;
    const delay = this.waited < BILLING_FAST_WINDOW_MS ? BILLING_POLL_FAST_MS : BILLING_POLL_SLOW_MS;
    this.pollTimer = setTimeout(() => void this.tick(delay), delay);
  }

  private async tick(delay: number): Promise<void> {
    if (!this.polling) return;
    this.waited += delay;
    try {
      await this.state.reloadNow(4000);
    } catch {
      /* a failed poll is not an error to show: the next one tries again */
    }
    if (!this.polling) return;
    if (this.waited >= BILLING_FAST_WINDOW_MS && !this.stillWaiting()) {
      this.stillWaiting.set(true);
      this.announcer.say('onboarding.billing.stillWaiting');
    }
    this.schedule();
  }

  private serverRefresh(): void {
    if (!this.polling) return;
    this.api.billingRefresh().subscribe({
      next: (r) => {
        if (r?.changed === true) void this.state.reloadNow();
      },
      error: () => undefined, // 429 = not yet, anything else = the poll keeps going
    });
  }

  // ---- the server says active ----------------------------------------------------------------------------------

  private activated = false;
  private onActive(): void {
    if (this.activated || this.left) return;
    this.activated = true;
    if (this.sawUnpaid) this.announcer.say('onboarding.billing.confirmed');
    const landing = this.state.landingUrl();
    const target = !landing || pathOf(landing) === '/setup/billing' ? '/dashboard' : landing;
    void this.router.navigateByUrl(target, { replaceUrl: true });
  }
}
