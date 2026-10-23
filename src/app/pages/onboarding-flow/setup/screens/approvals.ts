import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { I18nService } from '../../../../i18n/i18n.service';
import { LocaleFormatService } from '../../../../i18n/locale-format.service';
import { AuthService } from '../../../../shared/auth.service';
import type { MetaStatus } from '../../../localization/localization.types';
import { ApprovalBadge } from '../../../localization/shared/approval-badge';
import { LangPill } from '../../../localization/shared/lang-pill';
import { OnbApiService } from '../../onb-api.service';
import { ONB_ERROR_CODES, onbErrorCode, onbErrorText, retryAfterOf } from '../../onb-error';
import { OnbAnnouncer, OnbFocus } from '../../onb-focus';
import { OnbHelp, OnbHelpService } from '../../onb-help';
import { ONB_EXTERNAL_LINKS } from '../../onb-links';
import { OnbStateService } from '../../onb-state.service';
import type { OnbApprovalRow, OnbPromptKind, OnbTemplateRow } from '../../onb.types';

export const APPROVALS_POLL_MS = 30_000;
export const APPROVALS_DEFAULT_COOLDOWN_S = 60;

export type ApprovalRowKey = 'verification' | 'displayName' | 'payment' | 'messagingLimit' | 'templates';
export type ApprovalRowState = 'done' | 'waiting' | 'needs' | 'unknown';

export const APPROVAL_ROW_KEYS: readonly ApprovalRowKey[] = ['verification', 'displayName', 'payment', 'messagingLimit', 'templates'] as const;

const TITLE_KEY: Record<ApprovalRowKey, string> = {
  verification: 'onboarding.approvals.row.verification',
  displayName: 'onboarding.approvals.row.displayName',
  payment: 'onboarding.approvals.row.payment',
  messagingLimit: 'onboarding.approvals.row.limit',
  templates: 'onboarding.approvals.row.templates',
};
const STATUS_KEY: Record<ApprovalRowState, string> = {
  done: 'onboarding.stepstatus.done',
  waiting: 'onboarding.stepstatus.waiting',
  needs: 'onboarding.stepstatus.needsYou',
  unknown: 'onboarding.stepstatus.checking',
};

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** The server's row status as a UI state; anything unexpected is "unknown" (shown as Checking). */
export function rowState(raw: unknown): ApprovalRowState {
  switch (raw) {
    case 'done': return 'done';
    case 'waiting': return 'waiting';
    case 'needs_you': return 'needs';
    default: return 'unknown';
  }
}

/** "now" / "2 minutes ago" in the UI language (Western digits). Pure. */
export function relativeTime(thenMs: number, nowMs: number, locale: string): string {
  const diff = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  if (diff < 45) return rtf.format(0, 'second');
  if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
  if (diff < 86_400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86_400), 'day');
}

export interface DisplayNameView { value: string | null; canEdit: boolean | null; editsRemaining: number | null; rejectionKey: string | null }

/**
 * The display-name row. The backend sends the name as the row's `value` (a string) and `canEdit`, `editsRemaining` and
 * `rejectionKey` as sibling fields of the row; the same fields inside an object `value` (DECISIONS C5 wording) are read too.
 */
export function displayNameView(row: OnbApprovalRow | undefined): DisplayNameView {
  const raw = row?.value;
  const o = obj(raw);
  const value = typeof raw === 'string' ? raw : typeof o['value'] === 'string' ? o['value'] : null;
  const rem = row?.editsRemaining ?? o['editsRemaining'];
  const rk = row?.rejectionKey ?? o['rejectionKey'];
  const key = typeof rk === 'string' ? rk : null;
  const edit = typeof row?.canEdit === 'boolean' ? row.canEdit : typeof o['canEdit'] === 'boolean' ? o['canEdit'] : null;
  return {
    value: value && value.trim() ? value.trim() : null,
    canEdit: edit,
    editsRemaining: typeof rem === 'number' && Number.isFinite(rem) && rem >= 0 ? Math.floor(rem) : null,
    rejectionKey: key && /^[A-Z][A-Z0-9_]{1,63}$/.test(key) ? key : null,
  };
}

/**
 * The numeric messaging tier if the server knows it (never invented, never promised). The backend sends `tierNumber` as a
 * sibling field of the row (and the number as `value` when known); a `tierNumber` inside an object `value` is read too.
 */
export function messagingTier(row: OnbApprovalRow | undefined): number | null {
  const t = row?.tierNumber ?? obj(row?.value)['tierNumber'] ?? (typeof row?.value === 'number' ? row.value : undefined);
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? Math.floor(t) : null;
}

/** Only https URLs are ever put in a link (the backend sends constants; this is the last line of defence). */
export function safeHttps(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 600) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const META_STATUSES = new Set([
  'NOT_CREATED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'ERROR', 'PENDING_DELETION', 'DELETED', 'LIMIT_EXCEEDED', 'ARCHIVED',
]);
const QUEUED_STATUSES = new Set(['QUEUED', 'SUBMITTING', 'SUBMITTED', 'IN_REVIEW', 'WAITING']);

/** A template row status as a Meta status for the shared badge. */
export function metaStatusOf(status: unknown): MetaStatus {
  const s = String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (META_STATUSES.has(s)) return s as MetaStatus;
  if (QUEUED_STATUSES.has(s)) return 'PENDING';
  return 'NOT_CREATED';
}

export type TemplateRowView = OnbTemplateRow;
const ARABIC_BLOCKED = new Set(['arabic_not_reviewed', 'legal']);
/** The internal "send me a test" template (backend TEST_TEMPLATE_KEY): it enables Step 5's test message and is never listed or counted. */
export const SETUP_TEST_TEMPLATE_KEY = 'setup_test';

/**
 * Rows that are never submitted for a reason the merchant cannot act on (e.g. 'invalid') are not shown at all, and neither
 * is the internal test template. A merchant who never asked for Arabic (capacity.arabicRequested === false) is not shown the
 * Arabic rows the backend keeps blocked for them: "Arabic version waiting for review" would claim something they never asked for.
 */
export function visibleTemplates(list: readonly TemplateRowView[] | null | undefined, arabicRequested?: boolean | null): TemplateRowView[] {
  return (list ?? []).filter((t) => {
    if (t.key === SETUP_TEST_TEMPLATE_KEY) return false;
    if (t.blockedReason && !ARABIC_BLOCKED.has(String(t.blockedReason))) return false;
    return !(arabicRequested === false && t.blockedReason && String(t.language).toLowerCase().startsWith('ar'));
  });
}

export function templateCounts(
  list: readonly TemplateRowView[] | null | undefined, arabicRequested?: boolean | null,
): { approved: number; waiting: number; total: number; rejected: number } {
  const real = visibleTemplates(list, arabicRequested).filter((t) => !t.blockedReason);
  let approved = 0;
  let waiting = 0;
  let rejected = 0;
  for (const t of real) {
    const s = metaStatusOf(t.status);
    if (s === 'APPROVED') approved++;
    else if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'NOT_CREATED') waiting++;
    else if (s === 'REJECTED') rejected++;
  }
  return { approved, waiting, rejected, total: real.length };
}

interface RowView { key: ApprovalRowKey; titleKey: string; state: ApprovalRowState; statusKey: string; raw: OnbApprovalRow | undefined }
interface TemplateItem {
  id: string;
  row: TemplateRowView;
  title: string;
  lang: 'en' | 'ar';
  status: MetaStatus;
  blocked: boolean;
  rejected: boolean;
  /** Catalogue key of the plain-language reason of a rejection (never Meta's raw code). */
  reasonKey: string;
  /** What Meta suggests (the backend's recommendation text), when it sent one. */
  recommendation: string | null;
  /** Rejected AGAIN after a resubmission: sending the same text once more would be rejected the same way, so the merchant is routed to Need help. */
  repeated: boolean;
}

/** From this revision on a rejection is a REPEATED one (the first resubmission is revision 2). */
export const REPEATED_REJECTION_REVISION = 2;

/** The recommendation text of a rejected template, without control characters and at most 300 characters; null when there is none. Pure. */
export function recommendationOf(row: Pick<OnbTemplateRow, 'recommendation'> | null | undefined): string | null {
  const text = typeof row?.recommendation === 'string' ? row.recommendation.replace(/[\u{0}-\u{1f}\u{7f}]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
  return text ? (text.length > 300 ? `${text.slice(0, 299)}...` : text) : null;
}

/** True when a rejected template has already been resubmitted at least once (its revision is 2 or more). Pure. */
export function isRepeatedRejection(row: Pick<OnbTemplateRow, 'revision'> | null | undefined): boolean {
  return typeof row?.revision === 'number' && row.revision >= REPEATED_REJECTION_REVISION;
}

// Step 4: one calm status page (DF 3.6). "Waiting on Meta" is normal: nothing here blocks the merchant, and the page always
// offers the next useful thing. Polls every 30 s only while the tab is visible and something is still waiting.
@Component({
  selector: 'app-onb-approvals',
  imports: [RouterLink, ApprovalBadge, LangPill, OnbFocus, OnbHelp, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./onb-approvals.css'],
  template: `
    <div class="onb-appr">
      <div class="onb-wrap onb-stack">
        <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.approvals" onbStep="approvals">{{ 'onboarding.approvals.title' | t }}</h1>
        <p class="onb-lead">{{ 'onboarding.approvals.body' | t }}</p>

        @if (loadError(); as e) {
          <div class="onb-alert onb-alert-error" role="alert">
            <span class="onb-alert-icon" aria-hidden="true">&#9888;</span>
            <span>{{ e }}</span>
          </div>
          <button type="button" class="onb-btn onb-btn-secondary" (click)="reload()">{{ 'onboarding.common.tryAgain' | t }}</button>
        } @else if (!loaded()) {
          <div class="onb-appr-loading" role="status">
            <div class="onb-spinner" aria-hidden="true"></div>
            <span>{{ 'onboarding.stepstatus.checking' | t }}</span>
          </div>
        }

        @if (loaded()) {
          <ul class="onb-appr-rows">
            @for (r of rows(); track r.key) {
              <li class="onb-card onb-appr-row" [attr.data-key]="r.key" [attr.data-state]="r.state">
                <div class="onb-appr-head">
                  <h2 class="onb-card-title">{{ r.titleKey | t }}</h2>
                  <span [class]="'onb-badge onb-badge-' + badgeKind(r.state)">
                    <span aria-hidden="true">{{ glyphOf(r.state) }}</span>
                    {{ r.statusKey | t }}
                  </span>
                </div>

                @switch (r.key) {
                  @case ('verification') {
                    <p>{{ verificationKey(r.state) | t }}</p>
                    @if (r.state === 'needs' && linkOf(r, 'securityCenter'); as href) {
                      <a class="onb-btn onb-btn-secondary" [href]="href" target="_blank" rel="noopener noreferrer">{{ 'onboarding.approvals.verification.open' | t }}</a>
                    }
                    @if (r.state !== 'done' && crSkipped()) {
                      <a class="onb-link" routerLink="/setup/business/cr">{{ 'onboarding.approvals.verification.addCr' | t }}</a>
                    }
                  }
                  @case ('displayName') {
                    @if (nameView().value; as nm) {
                      <p class="onb-appr-name" appUserText>{{ nm }}</p>
                    }
                    <p>{{ nameKey(r.state) | t }}</p>
                    @if (r.state === 'needs') {
                      @if (nameReasonKey(); as rk) {
                        <p class="onb-alert onb-alert-warn" role="note">{{ rk | t }}</p>
                      }
                      <p class="onb-muted">{{ 'onboarding.approvals.name.limit' | t }}</p>
                      @if (nameView().editsRemaining !== null) {
                        <p class="onb-muted">{{ 'onboarding.approvals.name.remaining' | t: { n: nameView().editsRemaining } }}</p>
                      }
                      @if (canEditName()) {
                        <form class="onb-stack" (submit)="submitName($event)" novalidate>
                          <label class="onb-label" for="onb-appr-name">{{ 'onboarding.approvals.name.field' | t }}</label>
                          <input
                            id="onb-appr-name" class="onb-input" type="text" name="newName" appUserText autocomplete="organization"
                            enterkeyhint="send" maxlength="100" [value]="newName()" (input)="onNameInput($event)"
                            [attr.aria-invalid]="nameError() ? true : null" [attr.aria-describedby]="nameError() ? 'onb-appr-name-err' : null"
                          />
                          @if (nameError(); as e) {
                            <div id="onb-appr-name-err" class="onb-field-error" role="alert">{{ e }}</div>
                          }
                          <button type="submit" class="onb-btn onb-btn-secondary" [disabled]="nameBusy()" [attr.aria-busy]="nameBusy()">
                            {{ 'onboarding.approvals.name.resubmit' | t }}
                          </button>
                        </form>
                      }
                    }
                    @if (nameSent()) {
                      <p class="onb-alert onb-alert-success" role="status">{{ 'onboarding.approvals.name.sent' | t }}</p>
                    }
                  }
                  @case ('payment') {
                    <p>{{ 'onboarding.approvals.payment.body' | t }}</p>
                    @if (r.state === 'done') {
                      <p class="onb-badge onb-badge-done"><span aria-hidden="true">&#10003;</span> {{ 'onboarding.approvals.payment.confirmed' | t }}</p>
                    } @else {
                      <p class="onb-muted">{{ 'onboarding.approvals.payment.cantSee' | t }}</p>
                      @if (linkOf(r, 'paymentSettings'); as href) {
                        <a class="onb-btn onb-btn-secondary" [href]="href" target="_blank" rel="noopener noreferrer">{{ 'onboarding.approvals.payment.open' | t }}</a>
                      }
                      @if (linkOf(r, 'paymentHelp'); as href) {
                        <a class="onb-link" [href]="href" target="_blank" rel="noopener noreferrer">{{ 'onboarding.approvals.payment.help' | t }}</a>
                      }
                      <button type="button" class="onb-btn onb-btn-secondary" [disabled]="payBusy()" [attr.aria-busy]="payBusy()" (click)="confirmPayment()">
                        {{ 'onboarding.approvals.payment.confirm' | t }}
                      </button>
                      @if (payError(); as e) {
                        <div class="onb-field-error" role="alert">{{ e }}</div>
                      }
                    }
                  }
                  @case ('messagingLimit') {
                    @if (tierText(); as n) {
                      <p>{{ 'onboarding.approvals.limit.value' | t: { count: n } }}</p>
                    } @else {
                      <p>{{ 'onboarding.approvals.limit.unknown' | t }}</p>
                      @if (linkOf(r, 'whatsappManager') ?? managerFallback; as href) {
                        <a class="onb-link" [href]="href" target="_blank" rel="noopener noreferrer">{{ 'onboarding.approvals.limit.open' | t }}</a>
                      }
                    }
                  }
                  @case ('templates') {
                    @if (templatesView().length === 0) {
                      <p class="onb-muted">{{ (!templatesLoaded() || r.state === 'unknown' ? 'onboarding.approvals.verification.unknown' : 'onboarding.approvals.templates.queued') | t }}</p>
                      @if (templatesLoaded()) {
                        <button type="button" class="onb-btn onb-btn-secondary" [disabled]="submitBusy()" [attr.aria-busy]="submitBusy()" (click)="submitTemplates()">
                          {{ 'onboarding.approvals.templates.submit' | t }}
                        </button>
                      }
                    } @else {
                      <p>{{ 'onboarding.approvals.templates.summary' | t: { approved: counts().approved, total: counts().total, waiting: counts().waiting } }}</p>
                      <button type="button" class="onb-link" [attr.aria-expanded]="showTemplates()" aria-controls="onb-appr-tpls" (click)="showTemplates.set(!showTemplates())">
                        {{ (showTemplates() ? 'onboarding.approvals.templates.hide' : 'onboarding.approvals.templates.show') | t }}
                      </button>
                      @if (showTemplates()) {
                        <ul id="onb-appr-tpls" class="onb-appr-tpls">
                          @for (it of templatesView(); track it.id) {
                            <li class="onb-appr-tpl">
                              <div class="onb-appr-tpl-head">
                                <span class="onb-appr-tpl-title">{{ it.title }}</span>
                                <app-lang-pill [lang]="it.lang" />
                              </div>
                              @if (it.blocked) {
                                <span class="onb-muted">{{ 'onboarding.approvals.templates.arBlocked' | t }}</span>
                              } @else {
                                <app-approval-badge [status]="it.status" [uiLang]="i18n.lang()" />
                              }
                              @if (it.rejected) {
                                <p class="onb-appr-tpl-note">{{ 'onboarding.approvals.templates.rejected' | t }}</p>
                                <p class="onb-muted" data-reason>{{ it.reasonKey | t }}</p>
                                @if (it.recommendation; as rec) {
                                  <p class="onb-muted" data-recommendation>
                                    <span>{{ 'onboarding.approvals.templates.suggests' | t }}</span>
                                    <span dir="auto" appUserText>{{ rec }}</span>
                                  </p>
                                }
                                @if (it.repeated) {
                                  <p class="onb-alert onb-alert-info" role="note" data-repeated>{{ 'onboarding.approvals.templates.again' | t }}</p>
                                  <button type="button" class="onb-btn onb-btn-secondary" data-act="help" (click)="askHelp()">{{ 'onboarding.help.cta' | t }}</button>
                                } @else {
                                  <button type="button" class="onb-btn onb-btn-secondary" [disabled]="resubmitBusy() === it.id" [attr.aria-busy]="resubmitBusy() === it.id" (click)="resubmit(it)">
                                    {{ 'onboarding.common.tryAgain' | t }}
                                  </button>
                                }
                              }
                            </li>
                          }
                        </ul>
                      }
                    }
                    @if (templateError(); as e) {
                      <div class="onb-field-error" role="alert">{{ e }}</div>
                    }
                  }
                }
              </li>
            }
          </ul>

          <section class="onb-stack" [attr.aria-label]="'onboarding.approvals.waitFor' | t">
            <h2 class="onb-card-title">{{ 'onboarding.approvals.waitFor' | t }}</h2>
            @for (c of cards(); track c.kind) {
              <div class="onb-card" [attr.data-state]="c.state">
                <div class="onb-card-title">{{ 'onboarding.home.card.' + c.kind + '.title' | t }}</div>
                @if (c.state === 'done') {
                  <p class="onb-badge onb-badge-done"><span aria-hidden="true">&#10003;</span> {{ 'onboarding.home.count.' + c.kind | t: { n: c.count } }}</p>
                } @else {
                  <p class="onb-muted">{{ 'onboarding.home.card.' + c.kind + '.body' | t }}</p>
                  <a class="onb-btn onb-btn-secondary" [routerLink]="c.url">{{ 'onboarding.home.card.' + c.kind + '.cta' | t }}</a>
                }
              </div>
            }
          </section>

          <div class="onb-row onb-appr-checked">
            @if (checkedText(); as when) {
              <span class="onb-muted">{{ 'onboarding.approvals.checked' | t: { time: when } }}</span>
            }
            <button type="button" class="onb-btn onb-btn-secondary onb-appr-check" [disabled]="busy() || cooldown() > 0" [attr.aria-busy]="busy()" (click)="checkNow()">
              {{ 'onboarding.approvals.checkNow' | t }}
            </button>
          </div>
          @if (cooldown() > 0) {
            <p class="onb-muted" aria-live="off" data-countdown>{{ 'onboarding.common.waitSeconds' | t: { n: cooldown() } }}</p>
          }
          @if (checkError(); as e) {
            <div class="onb-alert onb-alert-error" role="alert">
              <span class="onb-alert-icon" aria-hidden="true">&#9888;</span>
              <span>{{ e }}</span>
            </div>
          }
        }
      </div>

      <div class="onb-bar">
        <a class="onb-btn onb-btn-primary" [routerLink]="next().url">{{ next().labelKey | t }}</a>
        <div class="onb-bar-links">
          <span></span>
          <app-onb-help />
        </div>
      </div>
    </div>
  `,
})
export class ApprovalsScreen implements OnInit, OnDestroy {
  private readonly api = inject(OnbApiService);
  private readonly auth = inject(AuthService);
  private readonly announcer = inject(OnbAnnouncer);
  private readonly help = inject(OnbHelpService);
  private readonly fmt = inject(LocaleFormatService);
  readonly state = inject(OnbStateService);
  readonly i18n = inject(I18nService);

  private readonly session = toSignal(this.auth.session, { initialValue: this.auth.sessionSnapshot });
  readonly isOwner = computed(() => this.session()?.role === 'owner');

  readonly loaded = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly serverRows = signal<OnbApprovalRow[]>([]);
  readonly templates = signal<TemplateRowView[] | null>(null);
  /** capacity.arabicRequested of GET /templates (null = not known: every row is shown). */
  readonly arabicRequested = signal<boolean | null>(null);
  readonly checkedAt = signal<string | null>(null);
  readonly now = signal(Date.now());

  readonly busy = signal(false);
  readonly cooldown = signal(0);
  readonly checkError = signal<string | null>(null);
  readonly newName = signal('');
  readonly nameBusy = signal(false);
  readonly nameError = signal<string | null>(null);
  readonly nameSent = signal(false);
  readonly payBusy = signal(false);
  readonly payError = signal<string | null>(null);
  readonly submitBusy = signal(false);
  readonly resubmitBusy = signal<string | null>(null);
  readonly templateError = signal<string | null>(null);
  readonly showTemplates = signal(false);

  readonly managerFallback = safeHttps(ONB_EXTERNAL_LINKS.whatsappManager);

  readonly rows = computed<RowView[]>(() =>
    APPROVAL_ROW_KEYS.map((key) => {
      const raw = this.serverRows().find((r) => r.key === key);
      const state = rowState(raw?.status);
      return { key, titleKey: TITLE_KEY[key], state, statusKey: STATUS_KEY[state], raw };
    }));
  readonly anyWaiting = computed(() => this.rows().some((r) => r.state === 'waiting' || r.state === 'unknown'));

  readonly nameView = computed(() => displayNameView(this.serverRows().find((r) => r.key === 'displayName')));
  readonly canEditName = computed(() => this.isOwner() && this.nameView().canEdit !== false);
  readonly nameReasonKey = computed(() => {
    const k = this.nameView().rejectionKey;
    if (!k) return null;
    const key = 'onboarding.approvals.name.reason.' + k;
    return this.i18n.has(key) ? key : null;
  });

  /** The plain-language reason of a rejection: a known Meta code has its own sentence, anything else the generic one. Never the raw code. */
  private rejectionReasonKey(raw: unknown): string {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
    const key = 'onboarding.approvals.templates.reason.' + code;
    return /^[A-Z][A-Z0-9_]{1,63}$/.test(code) && this.i18n.has(key) ? key : 'onboarding.approvals.templates.reason.generic';
  }

  readonly tierText = computed(() => {
    const tier = messagingTier(this.serverRows().find((r) => r.key === 'messagingLimit'));
    return tier === null ? null : this.fmt.number(tier);
  });
  readonly crSkipped = computed(() => this.state.state()?.business?.crSkipped === true);

  readonly templatesLoaded = computed(() => this.templates() !== null);
  readonly templatesView = computed<TemplateItem[]>(() => {
    const lang = this.i18n.lang();
    return visibleTemplates(this.templates(), this.arabicRequested()).map((row) => {
      const blocked = !!row.blockedReason;
      const status = metaStatusOf(row.status);
      return {
        id: `${row.key}:${row.language}`,
        row,
        title: row.title?.[lang] || row.title?.en || row.key,
        lang: String(row.language).toLowerCase().startsWith('ar') ? 'ar' : 'en',
        status,
        blocked,
        rejected: !blocked && status === 'REJECTED',
        reasonKey: this.rejectionReasonKey(row.rejectedReason),
        recommendation: recommendationOf(row),
        repeated: !blocked && status === 'REJECTED' && isRepeatedRejection(row),
      } as TemplateItem;
    });
  });
  readonly counts = computed(() => templateCounts(this.templates(), this.arabicRequested()));

  readonly cards = computed(() => {
    const p = this.state.state()?.prompts;
    const mk = (kind: OnbPromptKind, st: string | undefined, count: number, url: string) => ({ kind, state: st ?? 'pending', count, url });
    return [
      mk('customers', p?.customers?.state, p?.counts?.customers ?? 0, '/setup/customers'),
      mk('products', p?.products?.state, (p?.counts?.products ?? 0) + (p?.counts?.services ?? 0), '/setup/products'),
    ];
  });

  /** The one primary action: the next useful thing, never "wait". */
  readonly next = computed(() => {
    const c = this.cards();
    if (c[0].state === 'pending') return { labelKey: 'onboarding.home.card.customers.cta', url: '/setup/customers' };
    if (c[1].state === 'pending') return { labelKey: 'onboarding.home.card.products.cta', url: '/setup/products' };
    return { labelKey: 'onboarding.step.promotion', url: '/setup/promotion' };
  });

  readonly checkedText = computed(() => {
    const at = this.checkedAt();
    const t = at ? Date.parse(at) : NaN;
    return Number.isFinite(t) ? relativeTime(t, this.now(), this.fmt.locale()) : null;
  });

  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;
  private readonly subs = new Set<Subscription>();
  private lastLoadAt = 0;
  private loadSeq = 0;
  private destroyed = false;

  private readonly onVisibility = (): void => {
    if (this.destroyed || document.visibilityState !== 'visible') return;
    this.now.set(Date.now());
    if (this.anyWaiting() && !this.busy() && Date.now() - this.lastLoadAt >= APPROVALS_POLL_MS) this.loadAll('poll');
  };

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.onVisibility);
    this.tickTimer = setInterval(() => this.tick(), APPROVALS_POLL_MS);
    this.loadAll('none');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearInterval(this.tickTimer);
    clearInterval(this.cooldownTimer);
    for (const s of this.subs) s.unsubscribe();
    this.subs.clear();
  }

  // ---- loading and polling ----------------------------------------------------------------------------------------

  private tick(): void {
    if (this.destroyed) return;
    this.now.set(Date.now());
    // Polling only while the tab is visible, and only while something is still waiting.
    if (document.visibilityState === 'visible' && this.anyWaiting() && !this.busy()) this.loadAll('poll');
  }

  reload(): void {
    this.loadError.set(null);
    this.loaded.set(false);
    this.loadAll('none');
  }

  /**
   * announce: 'poll' = the 30 s read: only a REAL change is announced (silence otherwise: a screen reader must not hear "Checked now"
   * every 30 seconds); 'manual' = the merchant pressed Check now: a change, or "checked just now"; 'none' = no announcement.
   */
  private loadAll(announce: 'none' | 'poll' | 'manual'): void {
    const seq = ++this.loadSeq;
    this.lastLoadAt = Date.now();
    this.keep(
      this.api.approvals().subscribe({
        next: (res) => {
          if (this.destroyed || seq !== this.loadSeq) return;
          const before = this.rows();
          const next = Array.isArray(res?.rows) ? res.rows : [];
          const firstLoad = !this.loaded();
          this.serverRows.set(next);
          this.checkedAt.set(res?.checkedAt ?? next.find((r) => r.checkedAt)?.checkedAt ?? null);
          this.now.set(Date.now());
          this.loadError.set(null);
          this.loaded.set(true);
          if (announce !== 'none' && !firstLoad) this.announceChange(before, announce === 'manual');
        },
        error: (err: unknown) => {
          if (this.destroyed || seq !== this.loadSeq) return;
          this.help.setLastError(onbErrorCode(err));
          // A failed poll keeps the last good answer on screen; only the first load shows an error.
          if (!this.loaded()) this.loadError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
    this.keep(
      this.api.templates().subscribe({
        next: (res) => {
          if (this.destroyed || seq !== this.loadSeq) return;
          this.templates.set(Array.isArray(res?.templates) ? res.templates : []);
          const wanted = res?.capacity?.arabicRequested;
          this.arabicRequested.set(typeof wanted === 'boolean' ? wanted : null);
        },
        error: () => undefined, // the templates row falls back to "Checking"; the rest of the page does not depend on it
      }),
    );
  }

  private announceChange(before: RowView[], manual: boolean): void {
    const changed = this.rows().find((r) => {
      const b = before.find((x) => x.key === r.key);
      return b !== undefined && b.state !== r.state;
    });
    if (changed) {
      this.announcer.say('onboarding.approvals.live', { row: this.i18n.t(changed.titleKey), status: this.i18n.t(changed.statusKey) });
    } else if (manual) {
      this.announcer.say('onboarding.approvals.checked', { time: relativeTime(this.now(), this.now(), this.fmt.locale()) });
    }
  }

  // ---- Check now (server limit: 1 per 60 s; the button shows a countdown) -----------------------------------------------

  checkNow(): void {
    if (this.busy() || this.cooldown() > 0) return;
    this.busy.set(true);
    this.checkError.set(null);
    this.keep(
      this.api.connectionRefresh().subscribe({
        next: () => {
          this.busy.set(false);
          this.loadAll('manual');
          this.state.refresh();
        },
        error: (err: unknown) => {
          this.busy.set(false);
          const code = onbErrorCode(err);
          this.help.setLastError(code);
          if (code === 'RATE_LIMITED' || code === 'META_RATE_LIMITED') this.startCooldown(this.retryAfterSeconds(err));
          else this.checkError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  private retryAfterSeconds(err: unknown): number {
    const n = retryAfterOf(err); // no header: the documented limit applies
    return n > 0 ? Math.min(n, 300) : APPROVALS_DEFAULT_COOLDOWN_S;
  }

  /**
   * The wait is shown as a text that counts down, but it is NOT a live region (a screen reader would read every second): the start
   * ("Please wait 60 seconds") and the end ("You can try again now") are announced once each.
   */
  private startCooldown(seconds: number): void {
    clearInterval(this.cooldownTimer);
    this.cooldown.set(seconds);
    this.announcer.say('onboarding.common.waitSeconds', { n: seconds });
    this.cooldownTimer = setInterval(() => {
      const n = this.cooldown() - 1;
      this.cooldown.set(Math.max(0, n));
      if (n <= 0) {
        clearInterval(this.cooldownTimer);
        if (!this.destroyed) this.announcer.say('onboarding.common.waitOver');
      }
    }, 1000);
  }

  // ---- display name (owner), payment self-attestation, templates ------------------------------------------------------

  onNameInput(ev: Event): void {
    this.newName.set((ev.target as HTMLInputElement | null)?.value ?? '');
    if (this.nameError()) this.nameError.set(null);
  }

  submitName(ev: Event): void {
    ev.preventDefault();
    if (this.nameBusy() || !this.canEditName()) return;
    const name = this.newName().trim();
    if (!name) {
      this.nameError.set(this.i18n.t('onboarding.errors.VALIDATION_FAILED'));
      return;
    }
    this.nameBusy.set(true);
    this.nameError.set(null);
    this.nameSent.set(false);
    this.keep(
      this.api.displayName(name).subscribe({
        next: () => {
          this.nameBusy.set(false);
          this.nameSent.set(true);
          this.newName.set('');
          this.announcer.say('onboarding.approvals.name.sent');
          this.loadAll('none');
        },
        error: (err: unknown) => {
          this.nameBusy.set(false);
          this.help.setLastError(onbErrorCode(err));
          this.nameError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  confirmPayment(): void {
    if (this.payBusy()) return;
    this.payBusy.set(true);
    this.payError.set(null);
    this.keep(
      this.api.paymentConfirmed().subscribe({
        next: () => {
          this.payBusy.set(false);
          // Shown as Done at once ("You told us you added a card"): never "verified", the server stays the truth.
          this.serverRows.update((rows) => rows.map((r) => (r.key === 'payment' ? { ...r, status: 'done' } : r)));
          this.announcer.say('onboarding.approvals.payment.confirmed');
          this.loadAll('none');
        },
        error: (err: unknown) => {
          this.payBusy.set(false);
          this.help.setLastError(onbErrorCode(err));
          this.payError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  submitTemplates(): void {
    if (this.submitBusy()) return;
    this.submitBusy.set(true);
    this.templateError.set(null);
    this.keep(
      this.api.templatesSubmit().subscribe({
        next: (res) => {
          this.submitBusy.set(false);
          // 200 with blocked:{code}: nothing could be sent (no usable connection); say why instead of looking like nothing happened
          const blocked = res?.blocked?.code;
          if (typeof blocked === 'string' && ONB_ERROR_CODES.includes(blocked)) {
            this.help.setLastError(blocked);
            this.templateError.set(this.i18n.t('onboarding.errors.' + blocked));
          }
          this.loadAll('none');
        },
        error: (err: unknown) => {
          this.submitBusy.set(false);
          this.help.setLastError(onbErrorCode(err));
          this.templateError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  resubmit(it: TemplateItem): void {
    if (this.resubmitBusy() !== null) return;
    this.resubmitBusy.set(it.id);
    this.templateError.set(null);
    this.keep(
      this.api.templateResubmit(it.row.key, it.row.language).subscribe({
        next: () => {
          this.resubmitBusy.set(null);
          this.loadAll('none');
        },
        error: (err: unknown) => {
          this.resubmitBusy.set(null);
          this.help.setLastError(onbErrorCode(err));
          this.templateError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  /** "Need help?" for a template Meta rejected again: the help message carries the code, so the team sees what happened. */
  askHelp(): void {
    this.help.setLastError('TEMPLATE_REJECTED');
    this.help.openSheet();
  }

  // ---- template helpers --------------------------------------------------------------------------------------------

  verificationKey(s: ApprovalRowState): string {
    return `onboarding.approvals.verification.${s === 'needs' ? 'needs' : s}`;
  }

  nameKey(s: ApprovalRowState): string {
    return s === 'unknown' ? 'onboarding.approvals.verification.unknown' : `onboarding.approvals.name.${s === 'needs' ? 'needs' : s}`;
  }

  linkOf(r: RowView, which: 'securityCenter' | 'paymentHelp' | 'paymentSettings' | 'whatsappManager'): string | null {
    return safeHttps(r.raw?.links?.[which]) ?? (which === 'securityCenter' ? safeHttps(ONB_EXTERNAL_LINKS.metaSecurityCenter) : null);
  }

  badgeKind(s: ApprovalRowState): string {
    return s === 'done' ? 'done' : s === 'needs' ? 'needs' : 'waiting';
  }

  glyphOf(s: ApprovalRowState): string {
    return s === 'done' ? '\u{2713}' : s === 'needs' ? '\u{26A0}' : '\u{23F3}';
  }

  private keep(s: Subscription): void {
    this.subs.add(s);
  }
}
