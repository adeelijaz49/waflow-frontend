import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { I18N_DIRECTIVES } from '../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { I18nService } from '../../../i18n/i18n.service';
import { AuthService } from '../../../shared/auth.service';
import { onbErrorAction } from '../onb-error';
import { OnbHelp, OnbHelpService, OnbHelpSheet, stepNumberOf } from '../onb-help';
import { isLockAllowed, isSendRoute, isSetupUrl } from '../onb-links';
import { OnbStateService } from '../onb-state.service';
import { OnbNotifications } from './onb-notifications';
import { OnbStatusPill } from './onb-status-pill';

export type OnbStripVariant = 'pay' | 'payPending' | 'pastDue' | 'cancelled' | 'reconnect' | 'paused' | 'locked' | 'finish' | 'pill' | 'none';

export interface OnbStripContext {
  enrolled: boolean;
  takeover: boolean;
  subState: string;
  level: string | null;
  sendingPaused: { code: string } | null;
  locked: boolean;
  finished: boolean;
  url: string;
}

/**
 * The eight strip variants of DF 2.3 in priority order (first match wins). Pure.
 * A page the lock veils (locked and not allow-listed) is explained by the lock message before the sending-paused banner:
 * the banner is for pages that are usable. `isSendRoute` and `isLockAllowed` are separate lists on purpose, so one page can be
 * both (Customers is a send route and is locked until Step 3 is done).
 */
export function computeStripVariant(c: OnbStripContext): OnbStripVariant {
  if (!c.enrolled) return 'none';
  if (c.takeover) return c.subState === 'pending' ? 'payPending' : 'pay';
  if (c.subState === 'past_due') return 'pastDue';
  if (c.subState === 'cancelled') return 'cancelled';
  if (c.level === 'reconnect_needed') return 'reconnect';
  const veiled = c.locked && !isLockAllowed(c.url);
  if (c.sendingPaused && isSendRoute(c.url) && !veiled) return 'paused';
  if (veiled) return 'locked';
  if (!c.finished) return 'finish';
  if (c.level) return 'pill';
  return 'none';
}

export interface OnbStripAction { labelKey: string; path?: string; help?: boolean }

/** Button of a variant (null = no button: pill-only, or an owner-only action for a member). */
export function stripActionFor(
  v: OnbStripVariant, isOwner: boolean, landing: string | null, pausedCode: string | null,
): OnbStripAction | null {
  switch (v) {
    case 'pay': case 'payPending': return { labelKey: 'onboarding.strip.payGo', path: '/setup/billing' };
    case 'pastDue': return isOwner ? { labelKey: 'onboarding.strip.updatePay', path: '/setup/billing' } : null;
    case 'cancelled': return isOwner ? { labelKey: 'onboarding.strip.restart', path: '/setup/billing' } : null;
    case 'reconnect': return isOwner ? { labelKey: 'onboarding.strip.reconnectBtn', path: '/setup/connect?reconnect=1' } : null;
    case 'locked': case 'finish': return { labelKey: 'onboarding.strip.continue', path: landing ?? '/setup' };
    case 'paused': {
      if (!pausedCode) return null;
      switch (onbErrorAction(pausedCode, { isOwner })) {
        case 'reconnect': return isOwner ? { labelKey: 'onboarding.strip.reconnectBtn', path: '/setup/connect?reconnect=1' } : null;
        case 'billing': case 'portal': return isOwner ? { labelKey: 'onboarding.strip.updatePay', path: '/setup/billing' } : null;
        case 'goConnect': return { labelKey: 'onboarding.strip.continue', path: '/setup/connect' };
        case 'help': return { labelKey: 'onboarding.help.cta', help: true };
        default: return null;
      }
    }
    default: return null;
  }
}

// The sticky strip mounted by OnbShellMount for ENROLLED merchants only. One line, one button; the WhatsApp status
// pill, the bell and "Need help?" stay on the right.
@Component({
  selector: 'app-onb-shell',
  imports: [OnbStatusPill, OnbNotifications, OnbHelp, OnbHelpSheet, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-shell.css', '../styles/onb-base.css', '../styles/onb-parts.css'],
  template: `
    @if (i18n.ready() && !hidden()) {
      <div class="onb-shell" role="region" [attr.aria-label]="'onboarding.title' | t" [appLangDir]="i18n.lang()" [attr.data-variant]="variant()">
        @if (variant() !== 'pill' && variant() !== 'none') {
          <div class="onb-shell-msg">
            <strong>{{ msg().key | t: msg().params }}</strong>
            @if (msg().bodyKey; as bodyKey) {
              <span class="onb-shell-sub onb-shell-more"> {{ bodyKey | t }}</span>
            }
            @if (action(); as a) {
              <button type="button" class="onb-btn onb-btn-primary onb-shell-btn" (click)="run(a)">{{ a.labelKey | t }}</button>
            } @else if (ownerOnly()) {
              <span class="onb-shell-sub">{{ 'onboarding.strip.askOwner' | t }}</span>
            }
          </div>
        }
        <div class="onb-shell-tools">
          @if (state.level() || variant() === 'reconnect') {
            <button type="button" class="onb-shell-pillbtn" (click)="openCause()"><app-onb-status-pill [level]="state.level()" /></button>
          }
          <button type="button" class="onb-link onb-shell-bell" [attr.aria-label]="'onboarding.bell.label' | t" (click)="bellOpen.set(true)">
            <span aria-hidden="true">&#128276;</span>
            @if (state.unread() > 0) {
              <span class="onb-shell-count">{{ state.unread() }}</span>
            }
          </button>
          <app-onb-help />
        </div>
      </div>
      @if (bellOpen()) {
        <app-onb-notifications (closed)="bellOpen.set(false)" />
      }
      <app-onb-help-sheet />
    }
  `,
})
export class OnbShell {
  readonly i18n = inject(I18nService);
  readonly state = inject(OnbStateService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly help = inject(OnbHelpService);

  readonly bellOpen = signal(false);
  private readonly url = toSignal(
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );
  private readonly session = toSignal(this.auth.session, { initialValue: this.auth.sessionSnapshot });

  /** Under /setup the setup header carries the same pill, bell and help: the strip steps aside. */
  readonly hidden = computed(() => isSetupUrl(this.url()));
  readonly isOwner = computed(() => this.session()?.role === 'owner');

  readonly variant = computed<OnbStripVariant>(() =>
    computeStripVariant({
      enrolled: this.state.enrolled(),
      takeover: this.state.takeover(),
      subState: this.state.subState(),
      level: this.state.level(),
      sendingPaused: this.state.sendingPaused(),
      locked: this.state.locked(),
      finished: this.state.finished(),
      url: this.url(),
    }),
  );

  readonly action = computed(() =>
    stripActionFor(this.variant(), this.isOwner(), this.state.landingUrl(), this.state.sendingPaused()?.code ?? null),
  );

  /** A variant whose button is owner-only and the viewer is not the owner. */
  readonly ownerOnly = computed(() => {
    const v = this.variant();
    return !this.isOwner() && (v === 'pastDue' || v === 'cancelled' || v === 'reconnect');
  });

  readonly msg = computed((): { key: string; params?: Record<string, string | number>; bodyKey?: string } => {
    switch (this.variant()) {
      case 'pay': return { key: 'onboarding.strip.payNow' };
      case 'payPending': return { key: 'onboarding.strip.payPending' };
      case 'pastDue': return { key: 'onboarding.strip.pastDue' };
      case 'cancelled': return { key: 'onboarding.strip.cancelled' };
      case 'reconnect': return { key: 'onboarding.strip.reconnect' };
      case 'paused': {
        const code = this.state.sendingPaused()?.code ?? 'ONB_GENERIC';
        return { key: 'onboarding.strip.paused', params: { cause: this.i18n.t(`onboarding.errors.${code}`) } };
      }
      case 'locked': return { key: 'onboarding.lock.title', bodyKey: 'onboarding.lock.body' };
      case 'finish': {
        // "to unlock" is only true while the app is locked (D6 unlocks it at Step 3): afterwards the line is neutral.
        const n = stepNumberOf(this.state.state()?.nextStep);
        return this.state.locked()
          ? { key: 'onboarding.strip.finish', params: { n } }
          : { key: 'onboarding.strip.finishUnlocked', params: { n, total: 5 } };
      }
      default: return { key: 'onboarding.title' };
    }
  });

  run(a: OnbStripAction): void {
    if (a.help) this.help.openSheet();
    else if (a.path) void this.router.navigateByUrl(a.path);
  }

  /** The pill leads to what fixes the problem (the server's cause path), else to the approvals page. */
  openCause(): void {
    const p = this.state.state()?.connection?.causePath;
    const target = typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/setup/approvals';
    void this.router.navigateByUrl(target);
  }
}
