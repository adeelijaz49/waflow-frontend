import { ChangeDetectionStrategy, Component, Injectable, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type { OnbFirstPromotion, OnbState } from '../../onb.types';
import { OnbAError, OnbScreenBase } from './onb-a-kit';
import { copyToClipboard } from './onb-ai-handoff';

/** The Promotion types the existing builder understands (`/promotions?openCreate=true&campaignType=...`). */
export const PROMOTION_CAMPAIGN_TYPES = ['store_wide_offer', 'product_promotion', 'loyalty_reminder'] as const;
export type PromotionCampaignType = (typeof PROMOTION_CAMPAIGN_TYPES)[number];

export type PromotionMode = 'loading' | 'failed' | 'waiting' | 'ready';

/** Query params of the existing Promotions builder deep link. An unknown type is left out (the builder opens blank). */
export function builderQueryParams(campaignType: unknown): Record<string, string> {
  const params: Record<string, string> = { openCreate: 'true' };
  if (typeof campaignType === 'string' && (PROMOTION_CAMPAIGN_TYPES as readonly string[]).includes(campaignType)) {
    params['campaignType'] = campaignType;
  }
  return params;
}

/**
 * Step 5 order (spec, orchestrator ruling 4): the test message to the merchant's own phone comes FIRST, then the first
 * Promotion hand-off. `decided` is true once the merchant sent the test or chose "Skip the test" (in memory only: nothing is
 * stored, a page reload offers the test once more while the server still counts none).
 */
@Injectable({ providedIn: 'root' })
export class OnbTestChoice {
  readonly decided = signal(false);

  constructor() {
    // Another login in the same tab starts without the previous merchant's choice (R6-13).
    inject(OnbStateService).onSessionEnd(() => this.decided.set(false));
  }
}

/**
 * True while /setup/promotion must lead with the test message offer: the server counted no test yet (a number 0, an unknown
 * count never redirects), the merchant did not skip it and the first Promotion is not under way or finished. Pure.
 */
export function testOffered(fp: OnbState['firstPromotion'] | null | undefined, decided: boolean): boolean {
  if (decided || !fp) return false;
  if (fp.state === 'started' || fp.state === 'done' || fp.state === 'skipped') return false;
  return typeof fp.testMessageCount === 'number' && fp.testMessageCount <= 0;
}

/**
 * Where "See where things stand" goes: back to the connection step when WhatsApp needs reconnecting, else to Step 4
 * (the first message template is waiting there). Pure.
 */
export function waitLinkOf(level: string | null | undefined): string {
  return level === 'reconnect_needed' ? '/setup/connect' : '/setup/approvals';
}

/**
 * Step 5 preconditions: a usable connection and an approved template. The server decides (backend firstPromotion.js:
 * ready = connected or needs attention, not waiting for a reconnect, plus an approved library template); the only level the
 * client adds is "reconnect needed". A connection that merely needs attention (account health, a name decision) can still send,
 * so it is NOT a reason to wait. Pure.
 */
export function promotionPreconditionsMet(level: string | null | undefined, data: OnbFirstPromotion | null): boolean {
  if (level === 'reconnect_needed') return false;
  if (!data) return false;
  if (data.missing?.template === true) return false;
  if (data.ready === false) return false;
  return true;
}

/**
 * "Finish setup without sending": the way out of Step 5 that never depends on anything (G3). The server always accepts 'skipped'
 * (even with no approved template and under the "block" send policy) and marks the Promotion step skipped, so the setup completes.
 * Every state of Step 5 (waiting for a template, a failed load, ready, blocked) offers it, so no state leaves the merchant stuck.
 */
export abstract class OnbFinishBase extends OnbScreenBase {
  finish(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.api.firstPromotionState('skipped').subscribe({
      next: () => {
        this.busy.set(false);
        const s = this.state.state();
        if (s) {
          const steps = { ...(s.steps ?? {}), promotion: { ...(s.steps?.promotion ?? {}), status: 'skipped' } };
          this.state.patch({ steps, nextStep: null, firstPromotion: { ...(s.firstPromotion ?? {}), state: 'skipped' } });
        }
        this.analytics.track('step_skip', 'promotion');
        void this.state.reloadNow();
        void this.go('/setup/done');
      },
      error: (err: unknown) => this.fail(err),
    });
  }
}

/**
 * "Almost there": the calm explanation shown while the first message template is not approved (never an error).
 * Used by the first Promotion screen and by the test message screen. It always offers "Finish setup without sending" (G3): a
 * template that is waiting, was rejected or is never approved must not keep the merchant from completing the setup.
 */
@Component({
  selector: 'app-onb-promotion-wait',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-promotion.css'],
  template: `
    <section class="onb-promo" data-mode="waiting">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.promotion" onbStep="promotion">{{ 'onboarding.promotion.wait.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.promotion.wait.body' | t }}</p>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <a class="onb-btn onb-btn-primary" [routerLink]="link()">{{ 'onboarding.promotion.wait.link' | t }}</a>
        <div class="onb-promo-links">
          <a class="onb-link" routerLink="/setup/customers">{{ 'onboarding.home.card.customers.cta' | t }}</a>
          <a class="onb-link" routerLink="/setup/products">{{ 'onboarding.home.card.products.cta' | t }}</a>
          <button type="button" class="onb-link" data-act="finish" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="finish()">{{ 'onboarding.promotion.first.finish' | t }}</button>
        </div>
        <div class="onb-bar-links"><span></span><app-onb-help /></div>
      </div>
    </section>
  `,
})
export class OnbPromotionWait extends OnbFinishBase {
  /** Where the main button goes. */
  readonly link = input<string>('/setup/approvals');
}

// Step 5, screen F: the first Promotion hand-off (DF 3.9). It never builds a Promotion itself: it opens the existing
// Promotions builder through the router with a starter type. Under the "block" send policy (DB D5) it says plainly that
// sending is not switched on for the account yet and offers "Finish setup without sending" as the way to finish.
@Component({
  selector: 'app-onb-promotion',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, OnbPromotionWait, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-promotion.css'],
  template: `
    @if (mode() === 'waiting') {
      <app-onb-promotion-wait [link]="waitLink()" />
    } @else {
      <section class="onb-promo" [attr.aria-busy]="busy()" [attr.data-mode]="mode()">
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.promotion" onbStep="promotion">{{ 'onboarding.promotion.first.title' | t }}</h1>

        @if (mode() === 'loading') {
          <div class="onb-promo-loading" role="status"><span class="onb-spinner" aria-hidden="true"></span><span>{{ 'onboarding.common.loading' | t }}</span></div>
        } @else if (mode() === 'failed') {
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="button" class="onb-btn onb-btn-secondary" (click)="load()">{{ 'onboarding.common.tryAgain' | t }}</button>
            <div class="onb-promo-links">
              <button type="button" class="onb-link" data-act="finish" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="finish()">{{ 'onboarding.promotion.first.finish' | t }}</button>
            </div>
            <div class="onb-bar-links"><span></span><app-onb-help /></div>
          </div>
        } @else {
          <p class="onb-lead">{{ 'onboarding.promotion.first.suggest' | t }}</p>
          @if (preview(); as p) {
            <div class="onb-card">
              <p class="onb-promo-preview" [attr.lang]="previewLang()" [attr.dir]="previewLang() === 'ar' ? 'rtl' : 'ltr'">{{ p }}</p>
            </div>
          }
          @if (optedIn() > 0) {
            <p class="onb-promo-audience">{{ 'onboarding.promotion.first.audience' | t: { n: optedIn() } }}</p>
          } @else {
            <p class="onb-alert onb-alert-warn" role="note"><span class="onb-alert-icon" aria-hidden="true">!</span><span>{{ 'onboarding.promotion.first.noAudience' | t }}</span></p>
          }
          @if (noProducts()) {
            <div class="onb-alert onb-alert-info" role="note">
              <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
              <span class="onb-stack onb-tight">
                <span>{{ 'onboarding.promotion.first.noProducts' | t }}</span>
                <a class="onb-link" routerLink="/setup/products">{{ 'onboarding.home.card.products.cta' | t }}</a>
              </span>
            </div>
          }
          @if (blocked()) {
            <p class="onb-alert onb-alert-info" role="note" data-policy="block"><span class="onb-alert-icon" aria-hidden="true">&#8505;</span><span>{{ 'onboarding.promotion.first.blocked' | t }}</span></p>
          }
          @if (aiShown()) {
            <div class="onb-stack onb-tight" role="status">
              @if (aiCopied()) {
                <span>{{ 'onboarding.promotion.first.aiCopied' | t }}</span>
              } @else {
                <p class="onb-promo-ai" data-ai-prompt>{{ 'onboarding.promotion.first.aiPrompt' | t }}</p>
              }
              <a class="onb-link" routerLink="/ai-mode">{{ 'onboarding.promotion.first.aiOpen' | t }}</a>
            </div>
          }
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            @if (blocked()) {
              <button type="button" class="onb-btn onb-btn-primary" data-act="finish" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="finish()">{{ 'onboarding.promotion.first.finish' | t }}</button>
              <button type="button" class="onb-btn onb-btn-secondary" data-act="create" [disabled]="busy()" (click)="create()">{{ 'onboarding.promotion.first.create' | t }}</button>
            } @else {
              <button type="button" class="onb-btn onb-btn-primary" data-act="create" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="create()">{{ 'onboarding.promotion.first.create' | t }}</button>
            }
            <div class="onb-promo-links">
              <button type="button" class="onb-link" data-act="ai" (click)="askAi()">{{ 'onboarding.promotion.first.ai' | t }}</button>
              <a class="onb-link" data-act="test" routerLink="/setup/promotion/test">{{ 'onboarding.promotion.test.title' | t }}</a>
              @if (!blocked()) {
                <button type="button" class="onb-link" data-act="finish" [disabled]="busy()" (click)="finish()">{{ 'onboarding.promotion.first.finish' | t }}</button>
              }
            </div>
            <div class="onb-bar-links"><span></span><app-onb-help /></div>
          </div>
        }
      </section>
    }
  `,
})
export class PromotionScreen extends OnbFinishBase {
  readonly data = signal<OnbFirstPromotion | null>(null);
  readonly loadFailed = signal(false);
  readonly aiShown = signal(false);
  readonly aiCopied = signal(false);
  private doneChecked = false;
  private readonly choice = inject(OnbTestChoice);

  readonly fpState = computed(() => this.state.state()?.firstPromotion?.state ?? null);
  /** The test message is offered first (ruling 4): the screen shows "loading" for the instant before the redirect. */
  readonly offerTest = computed(() => testOffered(this.state.state()?.firstPromotion, this.choice.decided()));
  readonly mode = computed<PromotionMode>(() => {
    if (this.loadFailed()) return 'failed';
    const d = this.data();
    if (!d) return 'loading';
    if (!promotionPreconditionsMet(this.state.level(), d)) return 'waiting';
    return this.offerTest() ? 'loading' : 'ready';
  });
  readonly waitLink = computed(() => waitLinkOf(this.state.level()));
  /** Under the default send policy the merchant's number is not used for sending yet (DB D5). Unknown policy = honest "block". */
  readonly blocked = computed(() => this.data()?.sendPolicy !== 'platform_number');
  readonly optedIn = computed(() => this.data()?.suggestion?.audience?.optedIn ?? 0);
  readonly noProducts = computed(() => this.data()?.missing?.products === true);
  readonly previewLang = computed<'en' | 'ar'>(() => {
    const p = this.data()?.suggestion?.bodyPreview;
    const ui = this.i18n.lang() === 'ar' ? 'ar' : 'en';
    if (p?.[ui]) return ui;
    return p?.en ? 'en' : 'ar';
  });
  readonly preview = computed(() => {
    const p = this.data()?.suggestion?.bodyPreview;
    return p?.[this.previewLang()] ?? null;
  });

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
        this.afterLoad();
        if (this.mode() === 'waiting') this.announcer.say('onboarding.promotion.wait.title');
      },
      error: (err: unknown) => {
        this.loadFailed.set(true);
        this.fail(err);
      },
    });
  }

  private afterLoad(): void {
    if (this.fpState() === 'done') {
      void this.go('/setup/done');
      return;
    }
    if (this.offerTest() && promotionPreconditionsMet(this.state.level(), this.data())) {
      void this.router.navigateByUrl('/setup/promotion/test', { replaceUrl: true });
      return;
    }
    // Returning from the builder under the platform-number policy: ask the server to verify the send once.
    if (!this.doneChecked && this.data()?.sendPolicy === 'platform_number' && this.fpState() === 'started') {
      this.doneChecked = true;
      this.api.firstPromotionState('done').subscribe({
        next: () => {
          void this.state.reloadNow().then((s) => {
            if (s?.firstPromotion?.state === 'done') {
              this.analytics.track('step_complete', 'promotion');
              void this.go('/setup/done');
            }
          });
        },
        error: () => undefined, // not verified (yet): the merchant simply stays here
      });
    }
  }

  /** Opens the existing Promotions builder with the starter type (router navigation, never a page reload). */
  create(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.api.firstPromotionState('started').subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/promotions'], { queryParams: builderQueryParams(this.data()?.suggestion?.campaignType) });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** AI Mode has no prefill: the ready sentence goes to the clipboard (shown on screen when the browser refuses). */
  askAi(): void {
    const text = this.i18n.t('onboarding.promotion.first.aiPrompt');
    this.aiShown.set(true);
    this.aiCopied.set(false);
    void copyToClipboard(text).then((ok) => {
      if (!ok) return; // the prompt stays visible for a manual copy
      this.aiCopied.set(true);
      this.announcer.say('onboarding.promotion.first.aiCopied');
    });
  }
}
