import { ModalFocus } from '../shared/modal-focus';
import { Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { InboxApiService } from '../../../services/inbox-api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import { errorText } from '../shared/loc-errors';
import type { LoyaltyFallbackResult } from './inbox-types';
import { parseAmount } from './inbox-labels';

// Offer draft, payment link (modal), loyalty reminder, and links to Services/Orders.
// Payment links and loyalty reminders are sent by the backend in the customer's
// language. The English loyalty reminder is offered only as a clearly-labelled,
// confirmed fallback.
@Component({
  selector: 'app-loc-quick-actions',
  imports: [ModalFocus, ...I18N_PIPES, RouterLink],
  templateUrl: './quick-actions.html',
  styleUrl: './quick-actions.css',
})
export class QuickActions {
  private readonly i18n = inject(I18nService);
  private readonly locApi = inject(LocalizationApiService);
  private readonly inboxApi = inject(InboxApiService);
  private readonly ui = inject(LocUiService);

  readonly customerId = input.required<string>();
  readonly optedOut = input(false);
  // The language messages to this customer go out in (from the inbox context).
  readonly language = input<Lang>('en');

  readonly offer = output<string>();
  readonly done = output<void>();

  readonly modalOpen = signal(false);
  readonly amountText = signal('');
  readonly paying = signal(false);
  readonly payError = signal('');
  readonly loyaltyBusy = signal(false);
  private readonly amountEl = viewChild<ElementRef<HTMLInputElement>>('amountEl');

  constructor() {
    effect(() => this.amountEl()?.nativeElement.focus());
  }

  languageName(): string {
    return this.i18n.t(`status.language.${this.language()}`);
  }

  useOffer(): void {
    this.offer.emit(this.i18n.t('inbox.offer.draft', undefined, this.language()));
  }

  openPayment(): void {
    this.amountText.set('');
    this.payError.set('');
    this.modalOpen.set(true);
  }

  closePayment(): void {
    if (!this.paying()) this.modalOpen.set(false);
  }

  onAmount(event: Event): void {
    this.amountText.set((event.target as HTMLInputElement).value);
  }

  sendPayment(): void {
    if (this.paying()) return;
    const amount = parseAmount(this.amountText());
    if (amount === null) {
      this.payError.set(this.i18n.t('inbox.pay.invalid'));
      return;
    }
    this.paying.set(true);
    this.payError.set('');
    this.locApi.sendLocalizedPaymentLink(this.customerId(), amount).subscribe({
      next: () => {
        this.paying.set(false);
        this.modalOpen.set(false);
        this.ui.toast(this.i18n.t('inbox.pay.sent'), 'success');
        this.done.emit();
      },
      error: (err) => {
        this.paying.set(false);
        this.payError.set(errorText(this.i18n, err, 'inbox.pay.failed'));
      },
    });
  }

  // A real WhatsApp message to the customer: nothing is sent before the merchant confirms.
  async sendLoyalty(): Promise<void> {
    if (this.loyaltyBusy()) return;
    this.loyaltyBusy.set(true);
    const ok = await this.ui.confirm({
      title: this.i18n.t('inbox.loyalty.confirmTitle'),
      message: this.i18n.t('inbox.loyalty.confirmMessage', { language: this.languageName() }),
      confirmLabel: this.i18n.t('inbox.loyalty.confirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) {
      this.loyaltyBusy.set(false);
      return;
    }
    this.locApi.sendLocalizedLoyaltyReminder(this.customerId()).subscribe({
      next: (res) => {
        this.loyaltyBusy.set(false);
        if (res.sent) {
          this.ui.toast(this.i18n.t('inbox.loyalty.sent'), 'success');
          this.done.emit();
        } else if (res.reason === 'no_approved_variant' && res.fallbackAvailable) {
          void this.offerEnglishFallback();
        } else if (res.reason === 'no_consent') {
          this.ui.toast(this.i18n.t('inbox.loyalty.noConsent'), 'info');
        } else if (res.reason === 'no_points') {
          this.ui.toast(this.i18n.t('inbox.loyalty.noPoints'), 'info');
        } else {
          this.ui.toast(this.i18n.t('inbox.loyalty.notSent'), 'info');
        }
      },
      error: (err) => {
        this.loyaltyBusy.set(false);
        this.ui.toast(errorText(this.i18n, err, 'inbox.loyalty.failed'), 'error');
      },
    });
  }

  // No approved reminder in the customer's language: ask before sending the
  // existing English reminder instead.
  private async offerEnglishFallback(): Promise<void> {
    const ok = await this.ui.confirm({
      title: this.i18n.t('inbox.loyalty.fallbackTitle'),
      message: this.i18n.t('inbox.loyalty.fallbackMessage'),
      confirmLabel: this.i18n.t('inbox.loyalty.fallbackConfirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.loyaltyBusy.set(true);
    this.inboxApi.sendLoyaltyReminder(this.customerId()).subscribe({
      next: (res: LoyaltyFallbackResult) => {
        this.loyaltyBusy.set(false);
        if (res?.skippedOptedOut || res?.skippedNoConsent) {
          this.ui.toast(this.i18n.t('inbox.loyalty.noConsent'), 'info');
        } else {
          this.ui.toast(this.i18n.t('inbox.loyalty.fallbackSent'), 'success');
          this.done.emit();
        }
      },
      error: (err) => {
        this.loyaltyBusy.set(false);
        this.ui.toast(errorText(this.i18n, err, 'inbox.loyalty.failed'), 'error');
      },
    });
  }
}
