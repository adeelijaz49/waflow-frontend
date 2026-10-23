import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { OnbStateService } from '../onb-state.service';
import { ONB_STEP_KEYS, type OnbState, type OnbStepKey } from '../onb.types';

export type OnbRowStatus = 'done' | 'current' | 'waiting' | 'needsYou' | 'paused' | 'checking' | 'locked' | 'todo';

export interface OnbChecklistRow {
  key: OnbStepKey;
  n: number;
  status: OnbRowStatus;
  url: string;
  reachable: boolean;
  current: boolean;
}

export const ONB_STEP_URLS: Record<OnbStepKey, string> = {
  business: '/setup/business/name',
  number: '/setup/number',
  connect: '/setup/connect',
  approvals: '/setup/approvals',
  promotion: '/setup/promotion',
};

// Which setup step the nextStep belongs to (the two prompts open after Step 3 and belong to it).
const NEXT_TO_STEP: Record<string, OnbStepKey> = {
  business: 'business', number: 'number', connect: 'connect', customers: 'approvals', products: 'approvals', approvals: 'approvals', promotion: 'promotion',
};

function uiStatus(raw: string | undefined): OnbRowStatus | null {
  switch (raw) {
    case 'done': case 'skipped': case 'complete': case 'completed': return 'done';
    case 'waiting': case 'waiting_meta': case 'pending_meta': return 'waiting';
    case 'needs_you': case 'needs_attention': return 'needsYou';
    case 'paused': case 'paused_number': return 'paused';
    case 'checking': return 'checking';
    case 'in_progress': case 'current': return 'current';
    default: return null;
  }
}

/** The five checklist rows from the server state (pure). Missing data = neutral "to do". */
export function checklistRows(state: OnbState | null | undefined): OnbChecklistRow[] {
  const steps = state?.steps ?? {};
  const doneOf = (k: OnbStepKey): boolean => uiStatus(steps[k]?.status) === 'done';
  const nextStep = state?.nextStep ? NEXT_TO_STEP[state.nextStep] : undefined;
  const firstOpen = ONB_STEP_KEYS.find((k) => !doneOf(k));
  // A finished setup has no "next step", but Step 4 (waiting on Meta) may still be open: that open step stays the current one,
  // so the progress bar and the list never show "Step 4 of 5" with nothing highlighted. Everything done = no current row.
  const currentKey: OnbStepKey | undefined = state?.view === 'done' ? firstOpen : (nextStep ?? firstOpen);

  return ONB_STEP_KEYS.map((key, i) => {
    let status: OnbRowStatus = uiStatus(steps[key]?.status) ?? 'todo';
    if (state?.number?.paused === true && key === 'number' && status !== 'done') status = 'paused';
    // Steps 4 and 5 open when Step 3 is done (spec 0b); earlier steps are never locked.
    const lockedByConnect = (key === 'approvals' || key === 'promotion') && !doneOf('connect');
    if (lockedByConnect && status !== 'done') status = 'locked';
    if (status === 'todo' && key === currentKey) status = 'current';
    return { key, n: i + 1, status, url: ONB_STEP_URLS[key], reachable: status !== 'locked', current: key === currentKey };
  });
}

/** Step number shown in "Step n of 5" (1 to 5; 5 when everything is done). */
export function currentStepNumber(rows: OnbChecklistRow[]): number {
  const cur = rows.find((r) => r.current) ?? rows.find((r) => r.status !== 'done');
  return cur ? cur.n : rows.length;
}

const GLYPH: Record<OnbRowStatus, string> = {
  done: '&#10003;', current: '&#9654;', waiting: '&#8987;', needsYou: '!', paused: '&#10074;&#10074;', checking: '&#8635;', locked: '&#128274;', todo: '&#9675;',
};
const STATUS_KEY: Record<OnbRowStatus, string> = {
  done: 'onboarding.stepstatus.done', current: 'onboarding.stepstatus.current', waiting: 'onboarding.stepstatus.waiting',
  needsYou: 'onboarding.stepstatus.needsYou', paused: 'onboarding.stepstatus.paused', checking: 'onboarding.stepstatus.checking',
  locked: 'onboarding.stepstatus.locked', todo: 'onboarding.stepstatus.todo',
};

// The five-step list (setup shell side panel / sheet and the dashboard home). Status = glyph + word, never colour alone.
@Component({
  selector: 'app-onb-checklist',
  imports: [RouterLink, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="onb-steps" [attr.aria-label]="'onboarding.title' | t">
      @for (r of rows(); track r.key) {
        <li class="onb-step" [attr.aria-current]="r.current ? 'step' : null" [attr.data-status]="r.status">
          <span class="onb-step-glyph" aria-hidden="true" [innerHTML]="glyph(r.status)"></span>
          <div class="onb-step-body">
            @if (r.reachable) {
              <a class="onb-step-name onb-link" [routerLink]="r.url">{{ r.n }}. {{ 'onboarding.step.' + r.key | t }}</a>
            } @else {
              <span class="onb-step-name">{{ r.n }}. {{ 'onboarding.step.' + r.key | t }}</span>
            }
            <div class="onb-step-status">{{ statusKey(r.status) | t }}</div>
          </div>
          @if (showAction() && r.current && r.reachable) {
            <a class="onb-btn onb-btn-primary onb-step-cta" [routerLink]="r.url">{{ 'onboarding.common.continue' | t }}</a>
          }
        </li>
      }
    </ol>
  `,
  styles: [`.onb-step-cta { inline-size: auto; min-block-size: 48px; font-size: 16px; }`],
})
export class OnbChecklist {
  private readonly state = inject(OnbStateService);
  /** Show the [Continue] button on the current row (dashboard home). */
  readonly showAction = input(false);
  readonly rows = computed(() => checklistRows(this.state.state()));

  glyph(s: OnbRowStatus): string {
    return GLYPH[s];
  }
  statusKey(s: OnbRowStatus): string {
    return STATUS_KEY[s];
  }
}
