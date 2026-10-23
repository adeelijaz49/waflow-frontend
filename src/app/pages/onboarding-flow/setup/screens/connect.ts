import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewEncapsulation, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { I18nService } from '../../../../i18n/i18n.service';
import { AuthService } from '../../../../shared/auth.service';
import { ModalFocus } from '../../../localization/shared/modal-focus';
import { buildLoginOptions, parseEsMessage, toCompleteBody, type EsSignal } from '../../connect/es-adapter';
import { FacebookSdkService, type FbLoginResponse } from '../../connect/facebook-sdk.service';
import { OnbAnalyticsService } from '../../onb-analytics.service';
import { OnbApiService } from '../../onb-api.service';
import { ONB_ERROR_CODES, onbErrorAction, onbErrorCode, onbErrorText, onbErrorTone, type OnbAction } from '../../onb-error';
import { OnbAnnouncer, OnbFocus } from '../../onb-focus';
import { OnbHelp, OnbHelpService } from '../../onb-help';
import { OnbStateService } from '../../onb-state.service';
import type {
  OnbConnection, OnbConnectCompleteBody, OnbConnectConfig, OnbConnectEventResponse, OnbConnectResult, OnbConnectionSnapshot, OnbConnectionSummary,
  OnbPromptKind,
} from '../../onb.types';
import { OnbStatusPill } from '../../shell/onb-status-pill';

/** Timings of the Embedded Signup hand-off (DF 4.3). Meta's code lives 30 s: nothing slow may sit between code and POST. */
export const CONNECT_TIMING = {
  popupBlockedMs: 700,
  noCodeGraceMs: 300,
  signalWaitMs: 1500,
  codeTtlMs: 25_000,
  watchdogMs: 120_000,
  pollMs: 5000,
  pollMaxMs: 120_000,
  configRefreshMs: 600_000,
  networkRetryMs: 1000,
} as const;

export type ConnectPhase =
  | 'loading' | 'ready' | 'popup' | 'checking' | 'finishing' | 'partial' | 'success' | 'wabaOnly' | 'connected' | 'member' | 'failure';

export type ConnectOutcome = 'connected' | 'waba_only' | 'connecting' | 'unknown';

const IN_APP_UA = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok/i;

/** Heuristic: built-in browsers of other apps, where the Facebook window often does not open. */
export function isInAppBrowser(ua: string | null | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return IN_APP_UA.test(String(ua ?? ''));
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * What a /connect/complete, /connect/resume or /connection answer means (tolerant: fields may be missing). The backend always
 * sends the connection `status` (connect.js resultOf, GET /connection); `level` is only read when there is no status.
 */
export function connectOutcome(res: OnbConnectResult | OnbConnectionSnapshot | null | undefined | unknown): ConnectOutcome {
  const r = obj(res);
  const c = obj(r['connection']);
  const status = str(r['status']) || str(c['status']);
  if (status === 'waba_only') return 'waba_only';
  if (status === 'connected' || status === 'needs_attention') return 'connected';
  if (status === 'connecting' || status === 'partial') return 'connecting';
  if (status) return 'unknown'; // not_connected, disconnected, reconnect_required, error: nothing is connected
  const level = str(r['level']) || str(c['level']);
  if (level === 'connected' || level === 'needs_attention') return 'connected';
  return 'unknown';
}

/**
 * What the saved /state says about a connection that is not finished. The backend sends `connection.level` and a cause, not the
 * raw status: a pending number is the cause NUMBER_PENDING (status waba_only). A partial run (status connecting) is invisible
 * in /state: the screen asks GET /connection for it. A `status` is used when the state carries one.
 */
export function stateConnectionHint(conn: OnbConnection | null | undefined): ConnectOutcome {
  if (!conn) return 'unknown';
  if (conn.status) return connectOutcome({ status: conn.status });
  return conn.causeCode === 'NUMBER_PENDING' ? 'waba_only' : 'unknown';
}

export interface ConnectRecovery { action: OnbAction; labelKey: string; url?: string }

/** The one recovery button of a failure (null = nothing to press). Members are never sent to owner-only actions. */
export function connectRecovery(code: string, isOwner: boolean): ConnectRecovery | null {
  const action = onbErrorAction(code, { isOwner });
  const tryAgain = 'onboarding.common.tryAgain';
  switch (action) {
    case 'retry': case 'reloadConfig': case 'waitRetry': return { action, labelKey: tryAgain };
    case 'goNumber': return { action, labelKey: 'onboarding.connect.toNumber', url: '/setup/number' };
    case 'goMigrate': return { action, labelKey: 'onboarding.connect.toMigrate', url: '/setup/number/migrate?reason=coexistence' };
    case 'goConnect': return { action, labelKey: 'onboarding.common.continue', url: '/setup/connect' };
    case 'goApprovals': return { action, labelKey: 'onboarding.common.continue', url: '/setup/approvals' };
    case 'goLanding': return { action, labelKey: 'onboarding.common.continue' };
    case 'billing': return { action, labelKey: 'onboarding.strip.payGo', url: '/setup/billing' };
    case 'portal': return { action, labelKey: 'onboarding.strip.updatePay', url: '/setup/billing' };
    case 'reconnect': return isOwner ? { action, labelKey: 'onboarding.strip.reconnectBtn' } : { action: 'help', labelKey: 'onboarding.help.cta' };
    case 'legal': return { action, labelKey: 'onboarding.common.continue' };
    case 'resume': return { action, labelKey: 'onboarding.connect.partial.cta' };
    case 'noFacebook': return { action, labelKey: 'onboarding.connect.noFb', url: '/setup/connect/no-facebook' };
    case 'disconnect': return { action, labelKey: 'onboarding.connect.disconnect.cta' };
    case 'help': return { action, labelKey: 'onboarding.help.cta' };
    default: return null; // fix, none
  }
}

/** Status 0, or a 5xx the server gave no known code for (a gateway, a crash): the POST may or may not have been processed. */
function isNetworkFailure(err: unknown): boolean {
  const status = obj(err)['status'];
  if (status === 0) return true;
  return typeof status === 'number' && status >= 500 && onbErrorCode(err) === 'ONB_GENERIC';
}

const WAIT_SECONDS: Record<string, number> = { CONNECT_IN_PROGRESS: 15, RATE_LIMITED: 30, META_RATE_LIMITED: 60 };
// After these codes the merchant may still want to retry (the number was freed elsewhere): a second, quieter button.
const SECONDARY_RETRY = new Set(['CONNECT_NUMBER_REGISTERED_ELSEWHERE']);
const SDK_CODES = new Set(['ONB_SDK_BLOCKED', 'ONB_SDK_TIMEOUT']);
const KNOWN_CODES = new Set<string>(ONB_ERROR_CODES);
const DISCONNECT_WORD = 'DISCONNECT';
const IMPACT_KEY = /^[a-z][a-z_]{0,31}$/;

interface DisconnectDialog { token: string; impact: string[]; error: string | null; busy: boolean }
interface PromptCard { kind: OnbPromptKind; url: string }

// Step 3: Connect to WhatsApp through Meta's Embedded Signup (DF 4). The Facebook SDK is loaded only here. The browser
// never sees a Facebook token: only the single-use code goes from memory to POST /connect/complete.
@Component({
  selector: 'app-onb-connect',
  imports: [NgTemplateOutlet, RouterLink, ModalFocus, OnbFocus, OnbHelp, OnbStatusPill, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../connect/onb-connect.css'],
  template: `
    <div class="onb-conn">
      <div class="onb-wrap onb-stack">
        @switch (phase()) {
          @case ('loading') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ titleKey() | t }}</h1>
            <div class="onb-conn-wait" role="status">
              <div class="onb-spinner" aria-hidden="true"></div>
              <span>{{ 'onboarding.connect.preparing' | t }}</span>
            </div>
          }
          @case ('ready') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ titleKey() | t }}</h1>
            @if (reconnectCopy() && !addNumber()) {
              <p class="onb-lead">{{ 'onboarding.connect.reconnect.body' | t }}</p>
            } @else if (addNumber()) {
              <p class="onb-lead">{{ 'onboarding.connect.waba.body' | t }}</p>
            } @else {
              <p class="onb-lead">{{ 'onboarding.connect.note' | t }}</p>
            }
            <p class="onb-muted">{{ 'onboarding.connect.codeNote' | t }}</p>
            @if (notice(); as n) {
              <div [class]="'onb-alert onb-alert-' + toneOf(n)" [attr.role]="toneOf(n) === 'info' ? 'status' : 'alert'">
                @if (toneOf(n) === 'info') {
                  <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
                } @else {
                  <span class="onb-alert-icon" aria-hidden="true">&#9888;</span>
                }
                <span>{{ noticeText(n) }}</span>
              </div>
            }
            @if (inApp) {
              <div class="onb-alert onb-alert-info" role="note">
                <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
                <span>{{ 'onboarding.connect.inapp' | t }}</span>
              </div>
              <button type="button" class="onb-btn onb-btn-secondary" (click)="copyLink()">
                {{ (copied() ? 'onboarding.common.copied' : 'onboarding.common.copyLink') | t }}
              </button>
            }
            @if (coexistence()) {
              <div class="onb-alert onb-alert-info" role="note">
                <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
                <span>{{ 'onboarding.connect.appSteps' | t }}</span>
              </div>
            }
            @if (landline()) {
              <div class="onb-alert onb-alert-info" role="note">
                <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
                <span>{{ 'onboarding.connect.landlineHint' | t }}</span>
              </div>
            }
          }
          @case ('popup') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.waiting.title' | t }}</h1>
            <div class="onb-conn-wait" role="status">
              <div class="onb-spinner" aria-hidden="true"></div>
              <span>{{ 'onboarding.connect.waiting.body' | t }}</span>
            </div>
          }
          @case ('checking') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ titleKey() | t }}</h1>
            <div class="onb-conn-wait" role="status">
              <div class="onb-spinner" aria-hidden="true"></div>
              <span>{{ 'onboarding.stepstatus.checking' | t }}</span>
            </div>
          }
          @case ('finishing') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.finishing.title' | t }}</h1>
            <div class="onb-conn-wait" role="status">
              <div class="onb-spinner" aria-hidden="true"></div>
              <span>{{ 'onboarding.connect.finishing.body' | t }}</span>
            </div>
          }
          @case ('partial') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.partial.title' | t }}</h1>
            <div class="onb-conn-wait" role="status">
              <div class="onb-spinner" aria-hidden="true"></div>
              <span>{{ errorText('CONNECT_PARTIAL') }}</span>
            </div>
          }
          @case ('wabaOnly') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.waba.title' | t }}</h1>
            <p class="onb-lead">{{ 'onboarding.connect.waba.body' | t }}</p>
          }
          @case ('member') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.title' | t }}</h1>
            <div class="onb-alert onb-alert-info" role="note">
              <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
              <span>{{ 'onboarding.strip.askOwner' | t }}</span>
            </div>
          }
          @case ('failure') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.title' | t }}</h1>
            @if (errorCode(); as c) {
              <div [class]="'onb-alert onb-alert-' + toneOf(c)" role="alert">
                <span class="onb-alert-icon" aria-hidden="true">&#9888;</span>
                <span>{{ errorText(c) }}</span>
              </div>
              @if (waitLeft() > 0) {
                <p class="onb-muted" aria-live="off" data-countdown>{{ 'onboarding.common.waitSeconds' | t: { n: waitLeft() } }}</p>
              }
              @if (inApp && sdkFailure()) {
                <button type="button" class="onb-btn onb-btn-secondary" (click)="copyLink()">
                  {{ (copied() ? 'onboarding.common.copied' : 'onboarding.common.copyLink') | t }}
                </button>
              }
            }
          }
          @case ('success') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.success.title' | t }}</h1>
            <div class="onb-conn-done" aria-hidden="true">&#10003;</div>
            <ng-container *ngTemplateOutlet="numberBlock" />
            @for (c of cards(); track c.kind) {
              <div class="onb-card">
                <div class="onb-card-title">{{ 'onboarding.home.card.' + c.kind + '.title' | t }}</div>
                <p class="onb-muted">{{ 'onboarding.home.card.' + c.kind + '.body' | t }}</p>
                <a class="onb-btn onb-btn-secondary" [routerLink]="c.url">{{ 'onboarding.home.card.' + c.kind + '.cta' | t }}</a>
              </div>
            }
          }
          @case ('connected') {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.connected.title' | t }}</h1>
            @if (level()) {
              <div><app-onb-status-pill [level]="level()" /></div>
            }
            <ng-container *ngTemplateOutlet="numberBlock" />
            @if (connectionNeedsReconnect()) {
              <button type="button" class="onb-btn onb-btn-secondary" data-act="reconnect" (click)="reconnectNow()">{{ 'onboarding.strip.reconnectBtn' | t }}</button>
            }
            @if (disconnectError(); as e) {
              <div class="onb-alert onb-alert-error" role="alert">
                <span class="onb-alert-icon" aria-hidden="true">&#9888;</span>
                <span>{{ e }}</span>
              </div>
            }
            @if (isOwner()) {
              <button type="button" class="onb-btn onb-btn-secondary onb-conn-danger" [disabled]="disconnectBusy()" [attr.aria-busy]="disconnectBusy()" (click)="askDisconnect()">
                {{ 'onboarding.connect.disconnect.cta' | t }}
              </button>
            }
          }
        }
      </div>

      <div class="onb-bar">
        @switch (phase()) {
          @case ('loading') {
            <button type="button" class="onb-btn onb-btn-primary" disabled aria-busy="true">{{ 'onboarding.connect.preparing' | t }}</button>
          }
          @case ('ready') {
            <button type="button" class="onb-btn onb-btn-primary" (click)="connect()">{{ ctaKey() | t }}</button>
          }
          @case ('wabaOnly') {
            <button type="button" class="onb-btn onb-btn-primary" (click)="addMyNumber()">{{ 'onboarding.connect.waba.cta' | t }}</button>
          }
          @case ('success') {
            <a class="onb-btn onb-btn-primary" routerLink="/setup/customers">{{ 'onboarding.connect.success.next' | t }}</a>
            <a class="onb-btn onb-btn-secondary" routerLink="/setup/approvals">{{ 'onboarding.connect.success.approvals' | t }}</a>
          }
          @case ('connected') {
            <a class="onb-btn onb-btn-primary" [routerLink]="continueUrl()">{{ 'onboarding.common.continue' | t }}</a>
          }
          @case ('failure') {
            @if (recovery(); as r) {
              <button type="button" class="onb-btn onb-btn-primary" [disabled]="r.action === 'waitRetry' && waitLeft() > 0" (click)="recover(r)">{{ r.labelKey | t }}</button>
            }
            @if (secondaryRetry()) {
              <button type="button" class="onb-btn onb-btn-secondary" (click)="startAttempt()">{{ 'onboarding.common.tryAgain' | t }}</button>
            }
          }
        }
        <div class="onb-bar-links">
          @if (phase() === 'popup') {
            <button type="button" class="onb-link" (click)="reopen()">{{ 'onboarding.connect.waiting.reopen' | t }}</button>
          } @else if (phase() === 'ready' && !reconnectCopy() && !addNumber()) {
            <button type="button" class="onb-link" (click)="noFacebook()">{{ 'onboarding.connect.noFb' | t }}</button>
          } @else {
            <span></span>
          }
          @if (!(phase() === 'failure' && recovery()?.action === 'help')) {
            <app-onb-help />
          }
        </div>
      </div>

      @if (dialog(); as d) {
        <div class="onb-sheet-backdrop" (click)="cancelDisconnect()"></div>
        <div class="onb-sheet" role="dialog" aria-modal="true" appModalFocus aria-labelledby="onb-conn-dlg-title" (keydown.escape)="cancelDisconnect()">
          <h2 class="onb-sheet-title" id="onb-conn-dlg-title">{{ 'onboarding.connect.disconnect.title' | t }}</h2>
          <p>{{ 'onboarding.connect.disconnect.body' | t }}</p>
          @if (impactKeys().length) {
            <ul class="onb-conn-impact">
              @for (k of impactKeys(); track k) {
                <li>{{ 'onboarding.connect.disconnect.impact.' + k | t }}</li>
              }
            </ul>
          }
          <label class="onb-label" for="onb-conn-confirm">{{ 'onboarding.connect.disconnect.type' | t: { word: word } }}</label>
          <input
            id="onb-conn-confirm" class="onb-input" dir="ltr" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
            [value]="confirmText()" (input)="onConfirmInput($event)" [attr.aria-describedby]="d.error ? 'onb-conn-dlg-error' : null"
          />
          @if (d.error) {
            <div id="onb-conn-dlg-error" class="onb-field-error" role="alert">{{ d.error }}</div>
          }
          <button type="button" class="onb-btn onb-btn-primary onb-conn-danger-fill" [disabled]="!confirmMatches() || d.busy" [attr.aria-busy]="d.busy" (click)="confirmDisconnect()">
            {{ 'onboarding.connect.disconnect.confirm' | t }}
          </button>
          <button type="button" class="onb-btn onb-btn-secondary" (click)="cancelDisconnect()">{{ 'onboarding.common.cancel' | t }}</button>
        </div>
      }

      <ng-template #numberBlock>
        <dl class="onb-conn-facts">
          @if (numberText(); as n) {
            <dt>{{ 'onboarding.connect.connected.number' | t }}</dt>
            <dd><span appPhone>{{ n }}</span></dd>
          }
          @if (verifiedName(); as v) {
            <dt>{{ 'onboarding.connect.connected.name' | t }}</dt>
            <dd appUserText>{{ v }}</dd>
          }
        </dl>
      </ng-template>
    </div>
  `,
})
export class ConnectScreen implements OnInit, OnDestroy {
  private readonly api = inject(OnbApiService);
  private readonly sdk = inject(FacebookSdkService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(OnbAnalyticsService);
  private readonly announcer = inject(OnbAnnouncer);
  private readonly help = inject(OnbHelpService);
  readonly state = inject(OnbStateService);
  readonly i18n = inject(I18nService);

  private readonly session = toSignal(this.auth.session, { initialValue: this.auth.sessionSnapshot });
  readonly isOwner = computed(() => this.session()?.role === 'owner');

  readonly phase = signal<ConnectPhase>('loading');
  readonly errorCode = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly copied = signal(false);
  readonly waitLeft = signal(0);
  readonly addNumber = signal(false);
  readonly reconnectMode = signal(false);
  private readonly cfgSig = signal<OnbConnectConfig | null>(null);
  private readonly completeConn = signal<OnbConnectionSummary | null>(null);

  readonly dialog = signal<DisconnectDialog | null>(null);
  readonly confirmText = signal('');
  readonly disconnectBusy = signal(false);
  readonly disconnectError = signal<string | null>(null);
  readonly word = DISCONNECT_WORD;

  readonly inApp = isInAppBrowser();

  readonly reconnectCopy = computed(() => this.reconnectMode() || !!this.cfgSig()?.reconnect?.expectedWabaId);
  readonly coexistence = computed(() => this.state.state()?.number?.['businessAppChoice'] === 'coexistence');
  readonly landline = computed(() => this.state.state()?.number?.usage === 'landline');
  readonly level = computed(() => this.state.state()?.connection?.level ?? null);
  /**
   * "Needs attention" because of the CONNECTION itself (statusRefresh cause path /setup/connect: token about to expire, missing
   * permission, webhook not subscribed, registration failed ...): the owner can run the reconnect flow, which keeps the same
   * WhatsApp Business account. Causes on /setup/approvals (name, limit, account health) are fixed there, not here.
   */
  readonly connectionNeedsReconnect = computed(
    () => this.isOwner() && this.level() === 'needs_attention' && this.state.state()?.connection?.causePath === '/setup/connect',
  );
  readonly sdkFailure = computed(() => SDK_CODES.has(this.errorCode() ?? ''));

  readonly titleKey = computed(() =>
    this.addNumber() ? 'onboarding.connect.waba.title' : this.reconnectCopy() ? 'onboarding.connect.reconnect.title' : 'onboarding.connect.title');
  readonly ctaKey = computed(() =>
    this.addNumber() ? 'onboarding.connect.waba.cta' : this.reconnectCopy() ? 'onboarding.strip.reconnectBtn' : 'onboarding.connect.cta');

  readonly recovery = computed<ConnectRecovery | null>(() => {
    const c = this.errorCode();
    return c ? connectRecovery(c, this.isOwner()) : null;
  });
  readonly secondaryRetry = computed(() => SECONDARY_RETRY.has(this.errorCode() ?? ''));

  readonly numberText = computed(() => {
    const c = this.state.state()?.connection;
    const done = this.completeConn();
    const masked = c?.numberMasked || done?.numberMasked || null;
    if (!this.isOwner()) return masked;
    return c?.numberFull || done?.numberFull || masked;
  });
  readonly verifiedName = computed(() => this.state.state()?.connection?.verifiedName || this.completeConn()?.verifiedName || null);

  readonly impactKeys = computed(() =>
    (this.dialog()?.impact ?? []).filter((k) => typeof k === 'string' && IMPACT_KEY.test(k) && this.i18n.has('onboarding.connect.disconnect.impact.' + k)));
  readonly confirmMatches = computed(() => this.confirmText().trim().toUpperCase() === DISCONNECT_WORD);

  readonly cards = computed<PromptCard[]>(() => {
    const p = this.state.state()?.prompts;
    const out: PromptCard[] = [];
    if (p?.customers?.state !== 'done') out.push({ kind: 'customers', url: '/setup/customers' });
    if (p?.products?.state !== 'done') out.push({ kind: 'products', url: '/setup/products' });
    return out;
  });

  readonly continueUrl = computed(() => {
    const u = this.state.landingUrl();
    return u && u !== '/setup/connect' ? u : '/setup/approvals';
  });

  // ---- in-memory attempt state: never logged, stored, put in a URL or sent anywhere but POST /connect/complete ----
  private code: string | null = null;
  private finishSignal: EsSignal | null = null;
  private cancelSignal: EsSignal | null = null;
  private lastBody: OnbConnectCompleteBody | null = null;
  private clickSeq = 0;
  private attemptSeq = 0;
  private clickedAt = 0;
  private codeAt = 0;
  private configAt = 0;
  private cfg: OnbConnectConfig | null = null;
  private pendingNotice: string | null = null;
  private noCodePending = false;
  private popupOpen = false;
  private retried = false;
  private destroyed = false;
  private partialStartedAt = 0;

  private handoffTimer: ReturnType<typeof setTimeout> | undefined;
  private noCodeTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private configTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private waitTimer: ReturnType<typeof setInterval> | undefined;
  private readonly subs = new Set<Subscription>();
  private inAppReported = false;

  private readonly onMessage = (ev: MessageEvent): void => {
    if (this.destroyed || !this.popupOpen) return;
    const ph = this.phase();
    if (ph !== 'popup' && ph !== 'ready') return;
    const sig = parseEsMessage({ origin: ev.origin, data: ev.data });
    if (!sig) return;
    if (sig.kind === 'finish') {
      this.finishSignal = sig;
      this.cancelSignal = null;
      if (this.code && this.handoffTimer !== undefined) this.post(); // code arrived first: the wait is over
      return;
    }
    this.cancelSignal = sig;
    if (this.noCodePending) this.resolveNoCode(); // the popup closed first: this late signal explains why
  };

  constructor() {
    // A member who becomes known as owner after the session loads (owner is unknown until then) starts the flow.
    effect(() => {
      if (this.isOwner() && untracked(() => this.phase()) === 'member') untracked(() => this.begin());
    });
  }

  ngOnInit(): void {
    window.addEventListener('message', this.onMessage);
    const q = this.route?.snapshot?.queryParamMap?.get('reconnect');
    this.reconnectMode.set(q === '1' || this.state.state()?.connection?.level === 'reconnect_needed');
    this.begin();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener('message', this.onMessage);
    for (const t of [this.handoffTimer, this.noCodeTimer, this.watchdogTimer, this.pollTimer, this.configTimer, this.retryTimer]) clearTimeout(t);
    clearInterval(this.waitTimer);
    for (const s of this.subs) s.unsubscribe();
    this.subs.clear();
    this.code = null;
    this.lastBody = null;
    this.finishSignal = null;
    this.cancelSignal = null;
  }

  // ---- entry ----------------------------------------------------------------------------------------------------

  private begin(): void {
    const status: string | undefined = this.state.state()?.steps?.connect?.status;
    if (!this.isOwner()) {
      this.phase.set(status === 'done' ? 'connected' : 'member');
      return;
    }
    const hint = stateConnectionHint(this.state.state()?.connection);
    if (this.reconnectMode()) {
      this.startAttempt();
    } else if (status === 'done') {
      this.phase.set('connected');
    } else if (status === 'waba_only' || hint === 'waba_only') {
      this.phase.set('wabaOnly');
    } else if (status === 'connecting' || status === 'partial' || hint === 'connecting') {
      this.startPartial(true);
    } else if (this.state.state()?.connection?.status) {
      this.startAttempt(); // the state itself names a status that is neither pending nor partial: nothing stored to resume
    } else {
      this.peekConnection();
    }
  }

  /**
   * The step is not done: ask the server what is stored before offering a fresh start. The state has no word for a partial run
   * (status connecting) or for a number that is still pending, GET /connection has. A failed read just starts a fresh attempt.
   */
  private peekConnection(): void {
    this.phase.set('loading');
    this.keep(
      this.api.connection().subscribe({
        next: (snap) => {
          if (this.destroyed) return;
          const o = connectOutcome(snap);
          if (o === 'waba_only') this.phase.set('wabaOnly');
          else if (o === 'connecting') this.startPartial(true);
          else if (o === 'connected') {
            this.phase.set('connected');
            void this.state.reloadNow();
          } else this.startAttempt();
        },
        error: () => {
          if (!this.destroyed) this.startAttempt();
        },
      }),
    );
  }

  /** The owner's "Reconnect" button on a connection that needs attention: same WhatsApp Business account, fresh permission. */
  reconnectNow(): void {
    if (!this.isOwner()) return;
    this.reconnectMode.set(true);
    this.startAttempt();
  }

  /** Fetches a fresh connect attempt (config) and loads the Facebook SDK. Safe to call again from any phase. */
  startAttempt(forceReconnect = false): void {
    if (this.destroyed) return;
    const seq = ++this.attemptSeq;
    this.resetAttempt();
    this.phase.set('loading');
    this.errorCode.set(null);
    this.notice.set(this.pendingNotice);
    this.pendingNotice = null;
    this.reportInAppOnce();
    const call = forceReconnect || this.reconnectMode() ? this.api.reconnect() : this.api.connectConfig();
    this.keep(
      call.subscribe({
        next: (cfg) => {
          if (seq !== this.attemptSeq || this.destroyed) return;
          if (!cfg || cfg.enabled === false || !cfg.appId || !cfg.configId || !cfg.attemptId) {
            this.fail('CONNECT_NOT_CONFIGURED');
            return;
          }
          this.cfg = cfg;
          this.cfgSig.set(cfg);
          this.configAt = Date.now();
          this.loadSdk(cfg, seq);
        },
        error: (err: unknown) => {
          if (seq === this.attemptSeq && !this.destroyed) this.fail(onbErrorCode(err));
        },
      }),
    );
  }

  private loadSdk(cfg: OnbConnectConfig, seq: number): void {
    this.sdk
      .load({ appId: String(cfg.appId), graphVersion: String(cfg.graphVersion ?? ''), sdkLocale: cfg.sdkLocale })
      .then(
        () => {
          if (seq !== this.attemptSeq || this.destroyed) return;
          this.phase.set('ready');
          this.scheduleConfigRefresh();
        },
        (err: unknown) => {
          if (seq !== this.attemptSeq || this.destroyed) return;
          const c = onbErrorCode(err);
          this.fail(SDK_CODES.has(c) ? c : 'ONB_SDK_BLOCKED');
        },
      );
  }

  // The attempt id lives 15 minutes: while the screen waits in `ready` the config is renewed quietly after 10, because
  // a click must open the popup synchronously and cannot wait for a request.
  private scheduleConfigRefresh(): void {
    clearTimeout(this.configTimer);
    this.configTimer = setTimeout(() => {
      if (this.destroyed || this.phase() !== 'ready') return;
      const seq = this.attemptSeq;
      this.keep(
        (this.reconnectCopy() ? this.api.reconnect() : this.api.connectConfig()).subscribe({
          next: (cfg) => {
            if (seq !== this.attemptSeq || this.destroyed || !cfg?.attemptId) return;
            this.cfg = { ...(this.cfg ?? {}), ...cfg };
            this.cfgSig.set(this.cfg);
            this.configAt = Date.now();
            if (this.phase() === 'ready') this.scheduleConfigRefresh();
          },
          error: () => undefined, // the click path still has a config; an expired one is answered by CONNECT_ATTEMPT_INVALID
        }),
      );
    }, CONNECT_TIMING.configRefreshMs);
  }

  private reportInAppOnce(): void {
    if (this.inApp && !this.inAppReported) {
      this.inAppReported = true;
      this.analytics.track('step_fail', 'connect', 'ONB_IN_APP_BROWSER');
    }
  }

  // ---- the click: synchronous, nothing awaited before FB.login (popup blockers) -----------------------------------

  connect(): void {
    const cfg = this.cfg;
    if (this.phase() !== 'ready' || !cfg || !this.isOwner()) return; // double-tap guard
    this.clickSeq++;
    const seq = this.clickSeq;
    this.finishSignal = null;
    this.cancelSignal = null;
    this.code = null;
    this.noCodePending = false;
    clearTimeout(this.noCodeTimer);
    clearTimeout(this.handoffTimer);
    this.handoffTimer = undefined;
    this.notice.set(null);
    this.clickedAt = Date.now();
    this.popupOpen = true;
    this.phase.set('popup');
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => this.onWatchdog(seq), CONNECT_TIMING.watchdogMs);
    try {
      this.sdk.login(buildLoginOptions({ configId: String(cfg.configId), extras: cfg.extras }), (r) => this.onLogin(r, seq));
    } catch {
      this.fail('ONB_SDK_BLOCKED');
      return;
    }
    this.announcer.say('onboarding.connect.waiting.title');
  }

  /** "Window closed? Try again": a new click is allowed, the old popup's late callback is ignored. */
  reopen(): void {
    this.clickSeq++;
    this.clearAttemptTimers();
    this.resetAttempt(false);
    if (Date.now() - this.configAt > CONNECT_TIMING.configRefreshMs) {
      this.startAttempt();
    } else {
      this.phase.set('ready');
      this.scheduleConfigRefresh();
    }
  }

  private onWatchdog(seq: number): void {
    if (this.destroyed || seq !== this.clickSeq || this.phase() !== 'popup') return;
    // Neither a callback nor a signal for 2 minutes: do not leave a spinner forever (a late callback is still honoured).
    this.notice.set('stillThere');
    this.phase.set('ready');
    this.scheduleConfigRefresh();
  }

  private onLogin(r: FbLoginResponse | null | undefined, seq: number): void {
    if (this.destroyed || !this.popupOpen || seq !== this.clickSeq) return;
    const ph = this.phase();
    if (ph !== 'popup' && ph !== 'ready') return;
    clearTimeout(this.watchdogTimer);
    const code = r?.authResponse?.code;
    if (typeof code === 'string' && code.length > 0) {
      this.code = code;
      this.codeAt = Date.now();
      this.cancelSignal = null;
      this.tryHandoff();
      return; // no analytics, navigation or await between the code and the POST
    }
    this.onNoCode();
  }

  // ---- code -> POST /connect/complete ----------------------------------------------------------------------------

  private tryHandoff(): void {
    if (!this.code) return;
    if (this.finishSignal) {
      this.post();
      return;
    }
    // The finish message may arrive a moment after the callback: wait for it, but never longer than 1.5 s.
    clearTimeout(this.handoffTimer);
    this.handoffTimer = setTimeout(() => this.post(), CONNECT_TIMING.signalWaitMs);
  }

  private post(): void {
    clearTimeout(this.handoffTimer);
    this.handoffTimer = undefined;
    const code = this.code;
    const attemptId = this.cfg?.attemptId;
    if (!code || !attemptId || this.destroyed) return;
    if (Date.now() - this.codeAt > CONNECT_TIMING.codeTtlMs) {
      this.code = null;
      this.fail('ONB_CODE_HANDOFF_SLOW');
      return;
    }
    const body = toCompleteBody(attemptId, code, this.finishSignal);
    this.popupOpen = false;
    this.code = null; // out of the component state as soon as the request is built
    this.lastBody = body;
    this.retried = false;
    this.phase.set('finishing');
    this.announcer.say('onboarding.connect.finishing.title');
    this.send(body); // the request leaves now: nothing else (no analytics, no navigation) sits between the code and this call
  }

  private send(body: OnbConnectCompleteBody): void {
    this.keep(
      this.api.connectComplete(body).subscribe({
        next: (res) => this.onComplete(res),
        error: (err: unknown) => this.onCompleteError(err),
      }),
    );
  }

  private onComplete(res: OnbConnectResult | null | undefined): void {
    if (this.destroyed) return;
    this.lastBody = null;
    this.handleOutcome(connectOutcome(res), res);
  }

  private handleOutcome(out: ConnectOutcome, res: OnbConnectResult | OnbConnectionSnapshot | null | undefined): void {
    switch (out) {
      case 'connected': this.succeed(res); break;
      case 'waba_only': this.lastBody = null; this.phase.set('wabaOnly'); this.announcer.say('onboarding.connect.waba.title'); break;
      case 'connecting': this.startPartial(true); break;
      default:
        // an answer we cannot read: ask the server what the connection is before showing anything
        this.keep(
          this.api.connection().subscribe({
            next: (snap) => {
              const o = connectOutcome(snap);
              if (o === 'unknown') this.startPartial(false);
              else this.handleOutcome(o, snap);
            },
            error: () => this.startPartial(false),
          }),
        );
    }
  }

  private onCompleteError(err: unknown): void {
    if (this.destroyed) return;
    const code = onbErrorCode(err);
    if (code === 'CONNECT_PARTIAL') {
      this.lastBody = null;
      this.startPartial(true);
      return;
    }
    if (isNetworkFailure(err)) {
      // The POST may have been processed even though the answer was lost: ask the server before ANY retry.
      this.verifyAfterNetworkFailure();
      return;
    }
    this.lastBody = null;
    this.fail(code);
  }

  private verifyAfterNetworkFailure(): void {
    this.keep(
      this.api.connection().subscribe({
        next: (snap) => {
          const o = connectOutcome(snap);
          if (o === 'unknown') this.retryOnce();
          else {
            this.lastBody = null;
            this.handleOutcome(o, snap);
          }
        },
        error: () => this.retryOnce(),
      }),
    );
  }

  // One automatic retry of the same POST inside the code's window: the server replays a stored result for the same
  // attempt id / code hash with zero Meta calls, so it cannot connect twice.
  private retryOnce(): void {
    const body = this.lastBody;
    if (!body || this.retried || Date.now() - this.codeAt >= CONNECT_TIMING.codeTtlMs) {
      this.lastBody = null;
      this.fail('ONB_NETWORK');
      return;
    }
    this.retried = true;
    this.retryTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.keep(
        this.api.connectComplete(body).subscribe({
          next: (res) => this.onComplete(res),
          error: (err: unknown) => {
            this.lastBody = null;
            const c = onbErrorCode(err);
            if (c === 'CONNECT_PARTIAL') this.startPartial(true);
            else this.fail(c === 'ONB_GENERIC' ? 'ONB_NETWORK' : c);
          },
        }),
      );
    }, CONNECT_TIMING.networkRetryMs);
  }

  private succeed(res: OnbConnectResult | OnbConnectionSnapshot | null | undefined): void {
    this.lastBody = null;
    // /connect/complete and /connect/resume nest the summary under `connection`; GET /connection has the same fields on top.
    const nested = (res as OnbConnectResult | null | undefined)?.connection;
    const flat = res as OnbConnectionSnapshot | null | undefined;
    const conn: OnbConnectionSummary | null = nested && typeof nested === 'object'
      ? nested
      : flat && (flat.numberMasked || flat.verifiedName) ? { numberMasked: flat.numberMasked, verifiedName: flat.verifiedName } : null;
    this.completeConn.set(conn);
    this.errorCode.set(null);
    this.help.setLastError(null);
    this.phase.set('success');
    this.announcer.say('onboarding.connect.success.title');
    this.analytics.track('step_complete', 'connect');
    void this.state.reloadNow(); // the strip, the pill and the lock follow the server
  }

  // ---- partial finish: resume once, then poll every 5 s for up to 2 minutes ----------------------------------------

  private startPartial(callResume: boolean): void {
    if (this.destroyed) return;
    clearTimeout(this.pollTimer);
    this.partialStartedAt = Date.now();
    this.phase.set('partial');
    this.announcer.say('onboarding.connect.partial.title');
    if (!callResume) {
      this.schedulePoll();
      return;
    }
    this.keep(
      this.api.connectResume().subscribe({
        next: (res) => {
          const o = connectOutcome(res);
          if (o === 'connected' || o === 'waba_only') this.handleOutcome(o, res);
          else this.schedulePoll();
        },
        error: (err: unknown) => {
          const c = onbErrorCode(err);
          if (c === 'CONNECT_PARTIAL' || c === 'ONB_NETWORK' || c === 'ONB_GENERIC') this.schedulePoll();
          else this.fail(c);
        },
      }),
    );
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    if (Date.now() - this.partialStartedAt >= CONNECT_TIMING.pollMaxMs) {
      this.fail('CONNECT_PARTIAL');
      return;
    }
    this.pollTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.keep(
        this.api.connection().subscribe({
          next: (snap) => {
            const o = connectOutcome(snap);
            if (o === 'connected' || o === 'waba_only') this.handleOutcome(o, snap);
            else this.schedulePoll();
          },
          error: () => this.schedulePoll(),
        }),
      );
    }, CONNECT_TIMING.pollMs);
  }

  // ---- no code: cancelled, error reported by the popup, or blocked --------------------------------------------------

  private onNoCode(): void {
    if (this.cancelSignal) {
      this.reportSignal(this.cancelSignal);
    } else if (this.finishSignal) {
      this.fail('CONNECT_CODE_INVALID_OR_EXPIRED'); // Meta said "finished" but gave no code
    } else if (Date.now() - this.clickedAt < CONNECT_TIMING.popupBlockedMs) {
      this.analytics.track('step_fail', 'connect', 'ONB_POPUP_BLOCKED');
      this.backToReady('ONB_POPUP_BLOCKED');
    } else {
      // A plain close: give a late CANCEL/ERROR message a moment to say why, then report a cancel.
      this.noCodePending = true;
      this.noCodeTimer = setTimeout(() => this.resolveNoCode(), CONNECT_TIMING.noCodeGraceMs);
    }
  }

  private resolveNoCode(): void {
    if (!this.noCodePending) return;
    this.noCodePending = false;
    clearTimeout(this.noCodeTimer);
    this.reportSignal(this.cancelSignal ?? { kind: 'cancel', event: 'CANCEL' });
  }

  private reportSignal(sig: EsSignal): void {
    const attemptId = this.cfg?.attemptId;
    if (!attemptId) {
      this.backToReady('CONNECT_CANCELLED');
      return;
    }
    this.phase.set('checking');
    this.keep(
      this.api
        .connectEvent({
          attemptId,
          event: sig.kind === 'error' ? 'ERROR' : 'CANCEL',
          ...(sig.currentStep ? { currentStep: sig.currentStep } : {}),
          ...(sig.errorCode ? { errorCode: sig.errorCode } : {}),
          ...(sig.errorMessage ? { errorMessage: sig.errorMessage } : {}),
        })
        .subscribe({
          next: (res) => this.onEventResult(res),
          error: (err: unknown) => {
            if (sig.kind === 'error') this.fail(onbErrorCode(err));
            else this.backToReady('CONNECT_CANCELLED');
          },
        }),
    );
  }

  private onEventResult(res: OnbConnectEventResponse | null | undefined): void {
    if (this.destroyed) return;
    const code = typeof res?.code === 'string' && KNOWN_CODES.has(res.code) ? res.code : 'CONNECT_CANCELLED';
    if (code === 'CONNECT_CANCELLED') this.backToReady('CONNECT_CANCELLED');
    else if (onbErrorAction(code) === 'noFacebook') void this.router.navigateByUrl('/setup/connect/no-facebook');
    else this.fail(code);
  }

  private backToReady(noticeCode: string): void {
    this.help.setLastError(noticeCode === 'CONNECT_CANCELLED' ? null : noticeCode);
    this.clearAttemptTimers();
    this.resetAttempt(false);
    if (!this.cfg || Date.now() - this.configAt > CONNECT_TIMING.configRefreshMs) {
      this.pendingNotice = noticeCode;
      this.startAttempt();
      return;
    }
    this.errorCode.set(null);
    this.notice.set(noticeCode);
    this.phase.set('ready');
    this.scheduleConfigRefresh();
  }

  // ---- failures and their recovery -------------------------------------------------------------------------------

  private fail(code: string): void {
    if (this.destroyed) return;
    this.clearAttemptTimers();
    this.resetAttempt(false);
    this.errorCode.set(code);
    this.notice.set(null);
    this.help.setLastError(code);
    this.analytics.track('step_fail', 'connect', code); // only the six client codes pass the whitelist
    this.phase.set('failure');
    this.startWait(code);
  }

  /**
   * The wait is a text that counts down, NOT a live region (a screen reader would read every second): the start ("Please wait 30
   * seconds") and the end ("You can try again now") are announced once each; the failure itself is already an alert.
   */
  private startWait(code: string): void {
    clearInterval(this.waitTimer);
    const secs = connectRecovery(code, true)?.action === 'waitRetry' ? (WAIT_SECONDS[code] ?? 30) : 0;
    this.waitLeft.set(secs);
    if (secs <= 0) return;
    this.announcer.say('onboarding.common.waitSeconds', { n: secs });
    this.waitTimer = setInterval(() => {
      const n = this.waitLeft() - 1;
      this.waitLeft.set(Math.max(0, n));
      if (n <= 0) {
        clearInterval(this.waitTimer);
        if (!this.destroyed) this.announcer.say('onboarding.common.waitOver');
      }
    }, 1000);
  }

  recover(r: ConnectRecovery): void {
    switch (r.action) {
      case 'retry': case 'reloadConfig': case 'waitRetry': this.startAttempt(); break;
      case 'reconnect': this.reconnectMode.set(true); this.startAttempt(); break;
      case 'resume': this.startPartial(true); break;
      case 'help': this.help.openSheet(); break;
      case 'disconnect': this.phase.set('connected'); this.askDisconnect(); break;
      case 'legal': void this.router.navigate(['/legal-acceptance'], { queryParams: { returnUrl: '/setup/connect' } }); break;
      case 'goLanding': void this.router.navigateByUrl(this.state.landingUrl() ?? '/dashboard'); break;
      default: if (r.url) void this.router.navigateByUrl(r.url);
    }
  }

  addMyNumber(): void {
    this.addNumber.set(true);
    this.startAttempt(true);
  }

  noFacebook(): void {
    const attemptId = this.cfg?.attemptId;
    if (attemptId) this.keep(this.api.connectEvent({ attemptId, event: 'NO_FACEBOOK' }).subscribe({ error: () => undefined }));
    void this.router.navigateByUrl('/setup/connect/no-facebook');
  }

  // ---- disconnect (owner only; the server re-checks) --------------------------------------------------------------

  askDisconnect(): void {
    if (!this.isOwner() || this.disconnectBusy()) return;
    this.disconnectBusy.set(true);
    this.disconnectError.set(null);
    this.keep(
      this.api.disconnectRequest().subscribe({
        next: (r) => {
          this.disconnectBusy.set(false);
          this.confirmText.set('');
          this.dialog.set({ token: String(r?.confirmationToken ?? ''), impact: Array.isArray(r?.impactKeys) ? r.impactKeys : [], error: null, busy: false });
        },
        error: (err: unknown) => {
          this.disconnectBusy.set(false);
          this.help.setLastError(onbErrorCode(err));
          this.disconnectError.set(onbErrorText(this.i18n, err));
        },
      }),
    );
  }

  onConfirmInput(ev: Event): void {
    this.confirmText.set((ev.target as HTMLInputElement | null)?.value ?? '');
  }

  cancelDisconnect(): void {
    this.dialog.set(null);
    this.confirmText.set('');
  }

  confirmDisconnect(): void {
    const d = this.dialog();
    if (!d || d.busy || !this.confirmMatches() || !d.token) return;
    this.dialog.set({ ...d, busy: true, error: null });
    this.keep(
      this.api.disconnect(d.token).subscribe({
        next: () => {
          this.dialog.set(null);
          this.confirmText.set('');
          this.completeConn.set(null);
          this.reconnectMode.set(false);
          this.addNumber.set(false);
          this.help.setLastError(null);
          void this.state.reloadNow().then(() => {
            if (!this.destroyed) this.startAttempt(); // back to /setup/connect in the ready state
          });
        },
        error: (err: unknown) => {
          this.help.setLastError(onbErrorCode(err));
          this.dialog.set({ ...d, busy: false, error: onbErrorText(this.i18n, err) });
        },
      }),
    );
  }

  // ---- small helpers ---------------------------------------------------------------------------------------------

  toneOf(code: string): 'error' | 'warn' | 'info' {
    return code === 'stillThere' ? 'info' : onbErrorTone(code);
  }

  errorText(code: string): string {
    return onbErrorText(this.i18n, { code });
  }

  noticeText(code: string): string {
    return code === 'stillThere' ? this.i18n.t('onboarding.connect.stillThere') : this.errorText(code);
  }

  copyLink(): void {
    const url = `${window.location.origin}${window.location.pathname}`;
    const done = (): void => {
      this.copied.set(true);
      this.announcer.say('onboarding.common.copied');
    };
    const fallback = (): void => {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.insetBlockStart = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) done();
      } catch {
        /* nothing more to try: the link stays visible in the address bar */
      }
    };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    } catch {
      fallback();
    }
  }

  private keep(s: Subscription): void {
    this.subs.add(s);
  }

  private clearAttemptTimers(): void {
    for (const t of [this.handoffTimer, this.noCodeTimer, this.watchdogTimer, this.pollTimer, this.retryTimer]) clearTimeout(t);
    this.handoffTimer = undefined;
    this.noCodeTimer = undefined;
    this.noCodePending = false;
  }

  /** Forget everything of the previous popup (the code, the signals, the retry copy of the body). */
  private resetAttempt(full = true): void {
    this.popupOpen = false;
    this.code = null;
    this.lastBody = null;
    this.finishSignal = null;
    this.cancelSignal = null;
    this.noCodePending = false;
    if (full) {
      clearTimeout(this.configTimer);
      this.clearAttemptTimers();
      this.clickSeq++;
    }
  }
}
