import {
  ChangeDetectionStrategy, Component, ElementRef, InjectionToken, ViewEncapsulation, computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { I18nService } from '../../../../i18n/i18n.service';
import { AuthService } from '../../../../shared/auth.service';
import { OnbAnalyticsService } from '../../onb-analytics.service';
import { OnbApiService } from '../../onb-api.service';
import { onbErrorAction, onbErrorCode, onbErrorText, onbErrorTone, type OnbAction } from '../../onb-error';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbHelpService } from '../../onb-help';
import { ONB_BILLING_REDIRECT_ORIGINS, pathOf } from '../../onb-links';
import { OnbStateService } from '../../onb-state.service';
import { nextBusinessUrl, type BusinessScreen } from './onb-business-rules';
import type { OnbBusiness, OnbNextStep, OnbNumberPathBody, OnbState, OnbStepKey } from '../../onb.types';

// Shared pieces of the Billing / Step 1 / Step 2 screens (F1-a). Nothing here is visible text: all copy is catalogue keys.

/** Where the browser goes for Stripe (checkout / billing portal). A token so a spec can observe the redirect. */
export const ONB_EXTERNAL_NAVIGATE = new InjectionToken<(url: string) => void>('ONB_EXTERNAL_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string): void => window.location.assign(url),
});

/**
 * The redirect allow-list (R2-11): an absolute https URL, without credentials, whose ORIGIN is one of the Stripe-hosted origins
 * of ONB_BILLING_REDIRECT_ORIGINS (checkout.stripe.com, billing.stripe.com) and is not our own origin. Anything else (another
 * host, a look-alike such as checkout.stripe.com.evil.test, another port, http, javascript:, data:, a relative URL, our own
 * origin, garbage) is refused (null). The origin list is a parameter only so a spec can prove it is the single source.
 */
export function safeExternalUrl(raw: unknown, ownOrigin: string, allowedOrigins: readonly string[] = ONB_BILLING_REDIRECT_ORIGINS): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  let own: URL | null = null;
  try {
    own = new URL(ownOrigin);
  } catch {
    own = null;
  }
  if (own && url.hostname.toLowerCase() === own.hostname.toLowerCase()) return null;
  if (!allowedOrigins.includes(url.origin)) return null; // the URL parser lower-cases the host and drops a default port
  return url.toString();
}

const NEXT_STEPS: readonly string[] = ['business', 'number', 'connect', 'approvals', 'customers', 'products', 'promotion'];

/** The nextStep of a number answer when it is one the app knows, else the fallback (the server's word wins). */
export function serverNextStep(res: { nextStep?: string | null } | null | undefined, fallback: OnbNextStep | null): OnbNextStep | null {
  const n = res?.nextStep;
  return typeof n === 'string' && NEXT_STEPS.includes(n) ? (n as OnbNextStep) : fallback;
}

/**
 * Optimistic local update after a write the server accepted: the step is done and the next one is open. The real answer is
 * re-read in the background; this only keeps the step guard of the next screen from bouncing the merchant back.
 */
export function markStepDone(state: OnbStateService, step: OnbStepKey, nextStep: OnbNextStep | null): void {
  const s = state.state();
  if (!s) return;
  const steps = { ...(s.steps ?? {}), [step]: { ...(s.steps?.[step] ?? {}), status: 'done' } };
  const partial: Partial<typeof s> = { steps, nextStep };
  if (step === 'number') partial.number = { ...(s.number ?? {}), paused: false };
  state.patch(partial);
}

/**
 * The field a VALIDATION_FAILED answer points at, mapped to a screen field (name | links | cr | email | null).
 * The REAL backend body (errors.respond + steps.validateBusinessInput) is
 * { error, code: 'VALIDATION_FAILED', details: { fields: { <field>: 'INVALID' | 'LENGTH' | 'EMPTY' } } }; other routes send
 * details.fields as an array of names or only details.reason. The other shapes (fields / field at the top, details as a list)
 * are read too: a different shape must never turn into a wrong inline message.
 */
export function fieldOfError(err: unknown): 'name' | 'links' | 'cr' | 'email' | null {
  const body = (err as { error?: { fields?: unknown; details?: unknown; field?: unknown } | null } | null)?.error;
  if (!body || typeof body !== 'object') return null;
  const names: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === 'string') names.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['field'] === 'string') names.push(o['field']);
      if (o['fields'] !== undefined) collect(o['fields']);
      else Object.keys(o).forEach((k) => names.push(k));
    }
  };
  collect(body.fields);
  collect(body.details);
  collect(body.field);
  for (const n of names) {
    if (n === 'name') return 'name';
    if (n === 'website' || n === 'instagram') return 'links';
    if (n === 'crNumber' || n === 'cr') return 'cr';
    if (n === 'contactEmail' || n === 'email') return 'email';
  }
  return null;
}

const ACTION_LINKS: Partial<Record<OnbAction, string>> = {
  goConnect: '/setup/connect',
  goNumber: '/setup/number',
  goApprovals: '/setup/approvals',
  goMigrate: '/setup/number/migrate?reason=coexistence',
  billing: '/setup/billing',
};

/**
 * The error block of a screen (`role="alert"`, icon + text, never colour alone). Gets focus when it appears so a screen
 * reader hears it. Shows the catalogue text of the error code (never the server text) and, when the code's recovery is a
 * page, a "Continue" link to it. Retrying / fixing is done by the screen's own button.
 */
@Component({
  selector: 'app-onb-a-error',
  imports: [RouterLink, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (error() !== null && error() !== undefined) {
      <div #box class="onb-alert" [class.onb-alert-error]="tone() === 'error'" [class.onb-alert-warn]="tone() === 'warn'" [class.onb-alert-info]="tone() === 'info'" role="alert" tabindex="-1" [attr.data-code]="code()">
        <span class="onb-alert-icon" aria-hidden="true">{{ tone() === 'info' ? 'i' : '!' }}</span>
        <div class="onb-stack onb-tight">
          <span>{{ text() }}</span>
          @if (link(); as l) {
            <a class="onb-link" [routerLink]="l">{{ 'onboarding.common.continue' | t }}</a>
          }
        </div>
      </div>
    }
  `,
})
export class OnbAError {
  /** The failed HTTP/client error (or `{ error: { code } }`); null hides the block. */
  readonly error = input<unknown>(null);

  private readonly i18n = inject(I18nService);
  private readonly state = inject(OnbStateService);
  private readonly router = inject(Router);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  readonly code = computed(() => (this.error() == null ? null : onbErrorCode(this.error())));
  readonly text = computed(() => (this.error() == null ? '' : onbErrorText(this.i18n, this.error())));
  readonly tone = computed(() => (this.code() ? onbErrorTone(this.code() as string) : 'error'));
  readonly link = computed(() => {
    const code = this.code();
    if (!code) return null;
    const action = onbErrorAction(code, { isOwner: true });
    const target = action === 'goLanding' ? (this.state.landingUrl() ?? '/dashboard') : (ACTION_LINKS[action] ?? null);
    if (!target) return null;
    return pathOf(this.router.url) === pathOf(target) ? null : target;
  });

  constructor() {
    effect(() => {
      if (this.error() == null) return;
      setTimeout(() => this.box()?.nativeElement.focus());
    });
  }
}

/** What every F1-a screen needs: services, the owner flag, the busy flag and one error slot with the "Need help?" hook. */
export abstract class OnbScreenBase {
  readonly i18n = inject(I18nService);
  readonly state = inject(OnbStateService);
  readonly api = inject(OnbApiService);
  readonly router = inject(Router);
  readonly help = inject(OnbHelpService);
  readonly announcer = inject(OnbAnnouncer);
  readonly analytics = inject(OnbAnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly session = toSignal(this.auth.session, { initialValue: this.auth.sessionSnapshot });

  /** Unknown session = not owner (owner-only buttons stay hidden until the session is known; the server stays the truth). */
  readonly isOwner = computed(() => this.session()?.role === 'owner');
  /** The country picked in Step 1 (null = not saved yet): it decides how a phone number without a country code is read. */
  readonly businessCountry = computed(() => this.state.state()?.business?.country ?? null);
  readonly busy = signal(false);
  readonly error = signal<unknown>(null);

  /** Maps the failure to catalogue copy (the block shows it) and primes "Need help?" with the code. */
  protected fail(err: unknown): void {
    this.error.set(err ?? { status: 0 });
    this.help.setLastError(onbErrorCode(err));
    this.busy.set(false);
  }

  protected clearError(): void {
    this.error.set(null);
  }

  protected go(url: string): Promise<boolean> {
    return this.router.navigateByUrl(url);
  }
}

/**
 * Applies the answer of PUT /business to the local state: the full state when the server returns one, always the fields we
 * just sent (the server's own value wins where it returned one). Returns the resulting business.
 */
export function applyBusinessWrite(state: OnbStateService, resp: unknown, body: Partial<OnbBusiness>): OnbBusiness {
  const r = resp as OnbState | null;
  const answered = !!r && typeof r === 'object' && r.enrolled === true;
  if (answered) state.patch(r as OnbState);
  const current = Object.fromEntries(Object.entries(state.state()?.business ?? {}).filter(([, v]) => v !== undefined && v !== null));
  const merged: OnbBusiness = answered ? { ...body, ...current } : { ...current, ...body };
  state.patch({ business: merged });
  const s = state.state();
  if (merged.name && merged.country && merged.industry && s?.steps?.business?.status !== 'done') {
    markStepDone(state, 'business', s?.nextStep === 'business' ? 'number' : (s?.nextStep ?? null));
  }
  return merged;
}

/** "Business: Sara's Cafe, Saudi Arabia (change)": the answers so far, shown at the top of the next Step 1 screens. */
@Component({
  selector: 'app-onb-a-summary',
  imports: [RouterLink, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (name(); as n) {
      <p class="onb-summary">
        <span appUserText>{{ 'onboarding.business.summary' | t: { name: n, country: country() } }}</span>
        <a class="onb-link" routerLink="/setup/business/name" [queryParams]="{ edit: 1 }">{{ 'onboarding.common.change' | t }}</a>
      </p>
    }
  `,
})
export class OnbASummary {
  private readonly state = inject(OnbStateService);
  private readonly i18n = inject(I18nService);
  readonly name = computed(() => this.state.state()?.business?.name?.trim() || null);
  readonly country = computed(() => {
    const code = this.state.state()?.business?.country;
    return code ? this.i18n.t(`onboarding.country.${code}`) : '';
  });
}

/** Shared behaviour of the four Step 1 screens: one partial, idempotent PUT per Continue, then the next unanswered screen. */
export abstract class BusinessScreenBase extends OnbScreenBase {
  protected readonly route = inject(ActivatedRoute, { optional: true });
  readonly business = computed(() => this.state.state()?.business ?? null);
  /** The state is known (or could not be loaded: the form is shown anyway and the server stays the truth). */
  readonly ready = computed(() => this.state.state() !== null || this.state.failed());
  /** The inline field message is shown (local validation or the server's VALIDATION_FAILED for this very field). */
  readonly fieldError = signal(false);
  protected abstract readonly field: 'name' | 'industry' | 'links' | 'cr';
  protected fieldId = '';

  protected get editing(): boolean {
    try {
      return this.route?.snapshot?.queryParamMap?.get('edit') === '1';
    } catch {
      return false;
    }
  }

  protected focusField(): void {
    setTimeout(() => document.getElementById(this.fieldId)?.focus());
  }

  /**
   * A server VALIDATION_FAILED that points at one of THIS screen's fields is shown inline next to the field (true); any other
   * answer is not ours (false) and goes to the generic error block. A screen with a second field overrides this.
   */
  protected showFieldError(which: ReturnType<typeof fieldOfError>): boolean {
    if (which !== this.field) return false;
    this.fieldError.set(true);
    this.focusField();
    return true;
  }

  protected save(body: Partial<OnbBusiness>, from: BusinessScreen, after?: (b: OnbBusiness) => void, onFail?: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.fieldError.set(false);
    this.api.putBusiness(body).subscribe({
      next: (resp) => {
        const b = applyBusinessWrite(this.state, resp, body);
        this.busy.set(false);
        if (this.state.state()?.steps?.business?.status === 'done') this.analytics.track('step_complete', 'business');
        after?.(b);
        void this.router.navigateByUrl(nextBusinessUrl(from, b));
      },
      error: (err: unknown) => {
        onFail?.();
        const code = onbErrorCode(err);
        if (code === 'VALIDATION_FAILED' && this.showFieldError(fieldOfError(err))) {
          this.help.setLastError(code);
          this.busy.set(false);
        } else {
          this.fail(err);
        }
      },
    });
  }
}

export const NUMBER_URLS = {
  question: '/setup/number',
  where: '/setup/number/where',
  personal: '/setup/number/personal',
  businessApp: '/setup/number/business-app',
  migrate: '/setup/number/migrate',
  landline: '/setup/number/landline',
  getOne: '/setup/number/get-one',
  help: '/setup/number/help',
  paused: '/setup/number/paused',
  connect: '/setup/connect',
} as const;

/** Shared behaviour of the Step 2 screens: one POST /number/path per answer (idempotent), then the next screen. */
export abstract class NumberScreenBase extends OnbScreenBase {
  /**
   * Sends an answer. `to` is where the merchant goes when the server accepts it; the connect step is entered with the number
   * step marked done locally (the real answer is re-read in the background, the server stays the truth).
   */
  protected answer(body: OnbNumberPathBody, to: string, onFail?: (err: unknown) => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.api.numberPath(body).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (to === NUMBER_URLS.connect) {
          markStepDone(this.state, 'number', serverNextStep(res, 'connect'));
          this.analytics.track('step_complete', 'number');
        }
        void this.state.reloadNow();
        void this.router.navigateByUrl(to);
      },
      error: (err: unknown) => {
        this.fail(err);
        onFail?.(err);
      },
    });
  }

  /** "I need one" / "Use a different number": Path B. */
  protected pathB(body: OnbNumberPathBody): void {
    this.answer(body, NUMBER_URLS.getOne);
  }

  /** "I've got my number" (Path B and the paused page): one idempotent POST, then Step 3. */
  protected numberReady(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.api.numberReady().subscribe({
      next: (res) => {
        this.busy.set(false);
        markStepDone(this.state, 'number', serverNextStep(res, 'connect'));
        this.analytics.track('step_complete', 'number');
        void this.state.reloadNow();
        void this.router.navigateByUrl(NUMBER_URLS.connect);
      },
      error: (err: unknown) => this.fail(err),
    });
  }
}
