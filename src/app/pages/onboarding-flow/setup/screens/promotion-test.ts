import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { normalizePhone } from '../../customers/phone';
import { onbErrorCode } from '../../onb-error';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import type { OnbFirstPromotion } from '../../onb.types';
import { OnbAError, OnbScreenBase } from './onb-a-kit';
import { OnbPhoneNote } from './onb-phone-note';
import { OnbPromotionWait, OnbTestChoice, promotionPreconditionsMet, waitLinkOf, type PromotionMode } from './promotion';

/**
 * Local check of a typed phone number before anything is sent (R6-05): the same reader as the customers screens (Arabic digits are
 * numbers, letters are not, a number without a country code is read in the workspace country, "Another country" needs a plus or 00).
 */
export function isPlausiblePhone(raw: string, country?: string | null): boolean {
  return normalizePhone(raw, country).ok;
}

/** The answers after which the merchant must type (another) phone number. */
export const TEST_PHONE_CODES: readonly string[] = ['TEST_PHONE_INVALID', 'TEST_RECIPIENT_OPTED_OUT'] as const;

// Step 5, screen T: a test message from the merchant's own business number to the merchant's own phone (DF 3.9). The
// server picks the login phone; an e-mail-login owner types a number once. Nothing here ever shows or stores a full
// number: the recipient is shown masked, the typed value lives only in this component.
@Component({
  selector: 'app-onb-promotion-test',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbPromotionWait, OnbPhoneNote, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-promotion.css'],
  template: `
    @if (mode() === 'waiting') {
      <app-onb-promotion-wait [link]="waitLink()" />
    } @else {
      <section class="onb-promo" [attr.aria-busy]="busy()" [attr.data-mode]="mode()">
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.promotion.test.title" onbStep="promotion">{{ 'onboarding.promotion.test.title' | t }}</h1>

        @if (mode() === 'loading') {
          <div class="onb-promo-loading" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.common.loading' | t }}</span></div>
        } @else if (mode() === 'failed') {
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="button" class="onb-btn onb-btn-secondary" (click)="load()">{{ 'onboarding.common.tryAgain' | t }}</button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" data-act="skip" (click)="skip()">{{ 'onboarding.promotion.test.skip' | t }}</button>
              <app-onb-help />
            </div>
          </div>
        } @else {
          @if (sentTo() === null) {
            @if (masked(); as m) {
              @if (!showPhone()) {
                <p class="onb-lead" data-recipient="masked">{{ 'onboarding.promotion.test.body' | t: { phone: m } }}</p>
              }
            }
          } @else {
            <p class="onb-promo-sent" role="status" data-sent><span class="onb-promo-tick" aria-hidden="true">&#10003;</span><span>{{ 'onboarding.promotion.test.sent' | t: { phone: sentTo() } }}</span></p>
          }

          @if (showPhone() && sentTo() === null) {
            <div>
              <label class="onb-label" for="onb-test-phone">{{ 'onboarding.promotion.test.phone' | t }}</label>
              <input id="onb-test-phone" class="onb-input" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="send" dir="ltr"
                [value]="phone()" [attr.aria-invalid]="phoneInvalid()" aria-describedby="onb-test-phone-note onb-test-phone-hint"
                (input)="onPhone($any($event.target).value)" (keydown.enter)="send()" />
              <p id="onb-test-phone-hint" class="onb-muted">{{ 'onboarding.promotion.test.different' | t }}</p>
              <app-onb-phone-note [country]="businessCountry()" noteId="onb-test-phone-note" />
            </div>
          }

          <app-onb-a-error [error]="error()" />

          @if (sentTo() !== null) {
            <p class="onb-lead" data-question>{{ 'onboarding.promotion.test.arrived' | t }}</p>
            @if (notArrived()) {
              <div class="onb-alert onb-alert-info" role="note" data-tips>
                <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
                <span>{{ 'onboarding.promotion.test.tips' | t: { name: verifiedName() } }}</span>
              </div>
            }
          }

          <div class="onb-bar">
            @if (sentTo() === null) {
              <button type="button" class="onb-btn onb-btn-primary" data-act="send" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="send()">{{ 'onboarding.promotion.test.send' | t }}</button>
              <div class="onb-bar-links">
                <button type="button" class="onb-link" data-act="skip" (click)="skip()">{{ 'onboarding.promotion.test.skip' | t }}</button>
                <app-onb-help />
              </div>
            } @else {
              <button type="button" class="onb-btn onb-btn-primary" data-act="yes" (click)="arrived()">{{ 'onboarding.promotion.test.yes' | t }}</button>
              @if (!notArrived()) {
                <button type="button" class="onb-btn onb-btn-secondary" data-act="no" (click)="didNotArrive()">{{ 'onboarding.promotion.test.no' | t }}</button>
              } @else {
                <button type="button" class="onb-btn onb-btn-secondary" data-act="again" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="sendAgain()">{{ 'onboarding.promotion.test.again' | t }}</button>
              }
              <div class="onb-bar-links">
                <span></span>
                <app-onb-help />
              </div>
            }
          </div>
        }
      </section>
    }
  `,
})
export class PromotionTestScreen extends OnbScreenBase {
  readonly data = signal<OnbFirstPromotion | null>(null);
  readonly loadFailed = signal(false);
  readonly phone = signal('');
  readonly phoneInvalid = signal(false);
  /** The server asked for a phone (invalid, or the login phone is opted out). */
  readonly phoneRequested = signal(false);
  /** Masked recipient the server echoed after a send. */
  readonly sentTo = signal<string | null>(null);
  readonly notArrived = signal(false);
  private readonly choice = inject(OnbTestChoice);

  readonly mode = computed<PromotionMode>(() => {
    if (this.loadFailed()) return 'failed';
    const d = this.data();
    if (!d) return 'loading';
    return promotionPreconditionsMet(this.state.level(), d) ? 'ready' : 'waiting';
  });
  readonly waitLink = computed(() => waitLinkOf(this.state.level()));
  readonly masked = computed(() => this.data()?.testRecipient?.masked ?? null);
  /** The single phone field: the login has no phone, the server did not name a recipient, or it refused the one it had. */
  readonly showPhone = computed(() => this.data()?.testRecipient?.needsPhone === true || !this.masked() || this.phoneRequested());
  readonly verifiedName = computed(() => this.state.state()?.connection?.verifiedName ?? '');

  constructor() {
    super();
    this.load();
  }

  load(): void {
    this.loadFailed.set(false);
    this.clearError();
    this.api.firstPromotion().subscribe({
      next: (d) => {
        this.data.set(d ?? {});
        if (this.mode() === 'waiting') this.announcer.say('onboarding.promotion.wait.title');
      },
      error: (err: unknown) => {
        this.loadFailed.set(true);
        this.fail(err);
      },
    });
  }

  onPhone(value: string): void {
    this.phone.set(value);
    if (this.phoneInvalid()) this.phoneInvalid.set(false);
  }

  /** Sends the sample message to the merchant's own phone. */
  send(): void {
    if (this.busy()) return;
    this.clearError();
    this.phoneInvalid.set(false);
    let typed: string | undefined;
    if (this.showPhone()) {
      // The number is read with the country of Step 1 and sent as +<digits>: the server's own default country (Saudi Arabia) is
      // never relied on, so a Kuwaiti or Emirati number cannot turn into a Saudi one.
      const number = normalizePhone(this.phone(), this.businessCountry());
      if (!number.ok) {
        this.phoneInvalid.set(true);
        this.fail({ error: { code: 'TEST_PHONE_INVALID' } });
        setTimeout(() => document.getElementById('onb-test-phone')?.focus());
        return;
      }
      typed = number.withPlus;
    }
    this.busy.set(true);
    this.api.testMessage(typed).subscribe({
      next: (res) => {
        if (res?.sent === false) {
          this.fail({ error: { code: 'META_ERROR' } });
          return;
        }
        this.busy.set(false);
        const to = res?.to ?? this.masked() ?? '';
        this.sentTo.set(to);
        this.notArrived.set(false);
        this.choice.decided.set(true);
        const s = this.state.state();
        if (s && !((s.firstPromotion?.testMessageCount ?? 0) > 0)) {
          this.state.patch({ firstPromotion: { ...(s.firstPromotion ?? {}), testMessageCount: 1 } });
        }
        this.announcer.say('onboarding.promotion.test.sent', { phone: to });
      },
      error: (err: unknown) => {
        if (TEST_PHONE_CODES.includes(onbErrorCode(err))) {
          this.phoneRequested.set(true);
          this.phoneInvalid.set(true);
        }
        this.fail(err);
      },
    });
  }

  /** "Send again" after "No": the same send, with the sent state reset so the form and limits apply again. */
  sendAgain(): void {
    this.sentTo.set(null);
    this.notArrived.set(false);
    this.send();
  }

  didNotArrive(): void {
    this.notArrived.set(true);
  }

  /** "Skip the test": on to the first Promotion hand-off (the test stays available there as a link). */
  skip(): void {
    this.choice.decided.set(true);
    void this.go('/setup/promotion');
  }

  /** "Yes, it arrived": on to the first Promotion. */
  arrived(): void {
    void this.go('/setup/promotion');
  }
}
