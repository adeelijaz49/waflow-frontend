import { ChangeDetectionStrategy, Component, HostListener, Injectable, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../i18n/i18n.pipes';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../shared/auth.service';
import { ModalFocus } from '../localization/shared/modal-focus';
import { OnbAnalyticsService } from './onb-analytics.service';
import { OnbApiService } from './onb-api.service';
import { OnbAnnouncer } from './onb-focus';
import { pathOf } from './onb-links';
import { OnbStateService } from './onb-state.service';
import type { OnbEventStep, OnbHelpContext, OnbNextStep } from './onb.types';

// ---- pure builders (unit tested) -----------------------------------------------------------------------------

const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;
const EMAIL_LIKE = /\S+@\S+/;

/** Digits only (the wa.me format). */
export function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/** https://wa.me/<digits>?text=<encoded>; null when there is no usable number. */
export function buildWaMeUrl(whatsapp: string | null | undefined, text: string): string | null {
  const digits = digitsOnly(whatsapp);
  if (digits.length < 7 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** mailto:<address>?subject=...&body=... ; null when the address does not look like one. */
export function buildMailtoUrl(email: string | null | undefined, subject: string, body: string): string | null {
  const to = String(email ?? '').trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) return null;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Names are free text typed by the merchant: keep them short, single line, and never let a phone number or an
// e-mail address through (the help text must carry neither).
// control characters and bidi marks (code point escapes: no raw hidden characters in this file)
const HIDDEN_CHARS = /[\u{0}-\u{1f}\u{7f}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

function safeLabel(value: string | null | undefined): string {
  const v = String(value ?? '').replace(HIDDEN_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!v) return '-';
  if (EMAIL_LIKE.test(v) || (v.match(/\d/g) ?? []).length >= 7) return '-';
  return v;
}

export interface OnbHelpTextInput {
  businessName?: string | null;
  userName?: string | null;
  stepNumber: number;
  stepKey: string;
  lastError?: string | null;
  lang: 'en' | 'ar';
  path: string;
}

/** The pre-filled message for support staff (English on purpose). */
export function buildHelpText(i: OnbHelpTextInput): string {
  const err = i.lastError && ERROR_CODE.test(i.lastError) ? i.lastError : 'none';
  const key = /^[a-z_]{1,30}$/.test(i.stepKey) ? i.stepKey : '-';
  return [
    'Hi WaFlow, I need help with my setup.',
    `Business: ${safeLabel(i.businessName)}`,
    `Name: ${safeLabel(i.userName)}`,
    `Step: ${Math.min(5, Math.max(1, Math.round(i.stepNumber) || 1))} of 5 (${key})`,
    `Last problem: ${err}`,
    `Language: ${i.lang === 'ar' ? 'ar' : 'en'}`,
    `Page: ${pathOf(i.path)}`,
  ].join('\n');
}

const STEP_NUMBER: Record<string, number> = { business: 1, number: 2, connect: 3, customers: 3, products: 3, approvals: 4, promotion: 5 };

export function stepNumberOf(next: OnbNextStep | string | null | undefined): number {
  return (next && STEP_NUMBER[next]) || 5;
}

export function eventStepOf(takeover: boolean, next: OnbNextStep | string | null | undefined): OnbEventStep {
  if (takeover) return 'billing';
  return (next && next in STEP_NUMBER ? next : 'promotion') as OnbEventStep;
}

// ---- service -------------------------------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class OnbHelpService {
  private readonly api = inject(OnbApiService);
  private readonly state = inject(OnbStateService);
  private readonly analytics = inject(OnbAnalyticsService);

  /** The last ONB_* / backend code a screen showed (in memory only): pre-fills "Need help?". */
  readonly lastError = signal<string | null>(null);
  readonly open = signal(false);
  readonly context = signal<OnbHelpContext | null>(null);
  readonly contextFailed = signal(false);

  constructor() {
    // Logout / another login in the same tab: the previous merchant's business name, support contacts and last problem must not
    // reach the next merchant's help message (R6-13).
    this.state.onSessionEnd(() => this.clear());
  }

  /** Forgets everything this service holds for the current login. */
  clear(): void {
    this.open.set(false);
    this.context.set(null);
    this.contextFailed.set(false);
    this.lastError.set(null);
  }

  setLastError(code: string | null): void {
    this.lastError.set(code && ERROR_CODE.test(code) ? code : null);
  }

  openSheet(): void {
    this.open.set(true);
    const code = this.lastError() ?? this.state.state()?.lastError?.code ?? undefined;
    this.analytics.track('help_opened', eventStepOf(this.state.takeover(), this.state.state()?.nextStep), code);
    this.api.helpContext().subscribe({
      next: (c) => {
        this.context.set(c ?? null);
        this.contextFailed.set(false);
      },
      error: () => this.contextFailed.set(true), // contacts unknown: the sheet falls back to the support page
    });
  }

  close(): void {
    this.open.set(false);
  }
}

// ---- components ----------------------------------------------------------------------------------------------

/** The "Need help?" button (sticky bar and header). The sheet itself is <app-onb-help-sheet> (one per page). */
@Component({
  selector: 'app-onb-help',
  imports: [...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" class="onb-link onb-help-btn" (click)="help.openSheet()">{{ 'onboarding.help.cta' | t }}</button>`,
})
export class OnbHelp {
  readonly help = inject(OnbHelpService);
}

@Component({
  selector: 'app-onb-help-sheet',
  imports: [RouterLink, ModalFocus, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (help.open()) {
      <div class="onb-sheet-backdrop" (click)="help.close()"></div>
      <div class="onb-sheet" role="dialog" aria-modal="true" appModalFocus [attr.aria-label]="'onboarding.help.title' | t">
        <h2 class="onb-sheet-title">{{ 'onboarding.help.title' | t }}</h2>
        @if (whatsappUrl(); as wa) {
          <a class="onb-btn onb-btn-primary" [href]="wa" target="_blank" rel="noopener noreferrer" (click)="help.close()">{{ 'onboarding.help.whatsapp' | t }}</a>
        }
        @if (mailtoUrl(); as mail) {
          <a class="onb-btn onb-btn-secondary" [href]="mail" (click)="help.close()">{{ 'onboarding.help.email' | t }}</a>
        }
        @if (!whatsappUrl() && !mailtoUrl()) {
          <a class="onb-btn onb-btn-primary" routerLink="/support" (click)="help.close()">{{ 'onboarding.help.page' | t }}</a>
        }
        <button type="button" class="onb-link" (click)="copy()">{{ 'onboarding.help.copy' | t }}</button>
        <button type="button" class="onb-link" (click)="help.close()">{{ 'onboarding.common.close' | t }}</button>
      </div>
    }
  `,
})
export class OnbHelpSheet {
  readonly help = inject(OnbHelpService);
  private readonly state = inject(OnbStateService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly announcer = inject(OnbAnnouncer);

  readonly text = computed(() => {
    const ctx = this.help.context();
    const s = this.state.state();
    return buildHelpText({
      businessName: ctx?.businessName ?? s?.business?.name ?? null,
      userName: this.auth.sessionSnapshot?.user?.name ?? null,
      stepNumber: stepNumberOf(s?.nextStep),
      stepKey: String(s?.nextStep ?? ctx?.stepKey ?? '-'),
      lastError: this.help.lastError() ?? s?.lastError?.code ?? null,
      lang: this.i18n.lang(),
      path: typeof location === 'undefined' ? '/' : location.pathname,
    });
  });

  readonly whatsappUrl = computed(() => buildWaMeUrl(this.help.context()?.supportWhatsapp, this.text()));
  readonly mailtoUrl = computed(() => buildMailtoUrl(this.help.context()?.supportEmail, 'WaFlow setup help', this.text()));

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.help.open()) this.help.close();
  }

  copy(): void {
    try {
      void navigator.clipboard?.writeText(this.text());
      this.announcer.say('onboarding.common.copied');
    } catch {
      /* clipboard unavailable: the text stays visible in the message links */
    }
  }
}
