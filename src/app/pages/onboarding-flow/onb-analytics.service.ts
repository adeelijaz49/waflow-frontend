import { Injectable, inject } from '@angular/core';
import { OnbApiService } from './onb-api.service';
import { OnbStateService } from './onb-state.service';
import {
  ONB_EVENT_STEPS, ONB_EVENT_TYPES, ONB_STEP_FAIL_CODES, ONB_STEP_SKIP_CODES,
  type OnbEventBody, type OnbEventStep, type OnbEventType,
} from './onb.types';

// Fire-and-forget funnel events (spec section 6; DF 7.1). Never carries a phone number, e-mail, name, token,
// authorization code, CSV content or free text: only the fixed whitelist below, so the body cannot hold PII.
@Injectable({ providedIn: 'root' })
export class OnbAnalyticsService {
  private readonly api = inject(OnbApiService);
  private readonly state = inject(OnbStateService);
  private readonly sent = new Set<string>();
  private readonly enteredAt = new Map<string, number>();

  constructor() {
    // Another login in the same tab is another funnel: its events must not be swallowed as duplicates of the previous merchant's (R6-13).
    this.state.onSessionEnd(() => {
      this.sent.clear();
      this.enteredAt.clear();
    });
  }

  /** Returns true when a request was started. Never throws, never awaits, never blocks a navigation. */
  track(type: OnbEventType, step: OnbEventStep, code?: string, durationMs?: number): boolean {
    try {
      if (!ONB_EVENT_TYPES.includes(type) || !ONB_EVENT_STEPS.includes(step)) return false;
      // gate A: the server only accepts events from an active subscription
      if (!this.state.enrolled() || this.state.subState() !== 'active') return false;

      let cleanCode: string | undefined;
      if (type === 'step_fail') {
        if (!code || !ONB_STEP_FAIL_CODES.includes(code)) return false;
        cleanCode = code;
      } else if (type === 'step_skip') {
        if (code && ONB_STEP_SKIP_CODES.includes(code)) cleanCode = code;
      } else if (type === 'help_opened' && code && /^[A-Z][A-Z0-9_]{2,60}$/.test(code)) {
        cleanCode = code; // the last error code of the screen (backend catalogue shape only)
      }

      // one per (type, step) per page session; failures and help openings are distinguished by their code
      const key = type === 'step_fail' || type === 'help_opened' ? `${type}:${step}:${cleanCode ?? ''}` : `${type}:${step}`;
      if (this.sent.has(key)) return false;
      this.sent.add(key);

      if (type === 'step_enter') this.enteredAt.set(step, Date.now());
      let duration = durationMs;
      if (duration === undefined && type === 'step_complete') {
        const t0 = this.enteredAt.get(step);
        if (t0 !== undefined) duration = Date.now() - t0;
      }

      const body: OnbEventBody = { type, step };
      if (cleanCode) body.code = cleanCode;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
        body.durationMs = Math.min(Math.round(duration), 86_400_000);
      }
      this.api.event(body).subscribe({ error: () => undefined });
      return true;
    } catch {
      return false;
    }
  }
}
