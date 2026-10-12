import { Component, computed, input } from '@angular/core';
import type { PlanWarning, PromotionSendPlan, SenderKind, SenderSendPlan } from '../localization.types';
import { EmbeddedText } from './embedded-text';
import { KNOWN_BLOCKED_REASONS, KNOWN_FALLBACK_REASONS, knownWarnings, planCounts, samePhoneNotInBlocked, splitReason } from './plan-summary.util';

export interface CountRow { key: 'ar' | 'fallback' | 'en' | 'notMessaged'; count: number; label: string }

// Presentational "who gets which language" block shared by the promotion composer panel and the loyalty
// reminder / consent request notes: one stacked bar, the non-zero counts, one sentence per fallback
// reason, what is not messaged at all, and the plan warnings. English labels on the existing screens.
@Component({
  selector: 'app-language-plan-summary',
  templateUrl: './language-plan-summary.html',
  styleUrl: './language-plan-summary.css',
})
export class LanguagePlanSummary extends EmbeddedText {
  readonly plan = input.required<PromotionSendPlan | SenderSendPlan>();
  readonly kind = input<'promotion' | SenderKind>('promotion');

  readonly counts = computed(() => planCounts(this.plan()));

  readonly rows = computed<CountRow[]>(() => {
    if (!this.ready()) return [];
    const c = this.counts();
    const all: CountRow[] = [
      { key: 'ar', count: c.ar, label: this.t('promolang.count.ar') },
      { key: 'en', count: c.en, label: this.t('promolang.count.en') },
      { key: 'fallback', count: c.fallback, label: this.t('promolang.count.fallback') },
      { key: 'notMessaged', count: c.notMessaged, label: this.t('promolang.count.notMessaged') },
    ];
    return all.filter((r) => r.count > 0);
  });

  readonly barLabel = computed(() => this.rows().map((r) => `${r.label} ${r.count}`).join(', '));

  readonly fallbackLines = computed<string[]>(() => {
    if (!this.ready()) return [];
    return (this.plan().fallbacks ?? [])
      .filter((f) => f.count > 0)
      .map((f) => this.tp('promolang.fallbackLine', f.count, { reason: this.reasonClause(f.reason, KNOWN_FALLBACK_REASONS, 'reason') }));
  });

  readonly notMessagedLine = computed<string>(() => {
    if (!this.ready()) return '';
    const plan = this.plan();
    const s = plan.skipped;
    const parts: string[] = [];
    const add = (count: number | undefined, key: string): void => {
      if (count && count > 0) parts.push(this.t(key, { count }));
    };
    add(s?.noConsent, 'promolang.skipped.noConsent');
    add(s?.optedOut, 'promolang.skipped.optedOut');
    add(s?.demoSimulated, 'promolang.skipped.demoSimulated');
    add(samePhoneNotInBlocked(plan), 'promolang.skipped.optedOutSamePhone'); // the blocked rows below cover the rest
    for (const b of plan.blocked ?? []) {
      if (b.count > 0) add(b.count, KNOWN_BLOCKED_REASONS.includes(b.reason) ? `promolang.blocked.${b.reason}` : 'promolang.blocked.unknown');
    }
    return parts.length ? this.t('promolang.notMessaged', { list: parts.join(', ') }) : '';
  });

  readonly warningLines = computed<string[]>(() => {
    if (!this.ready()) return [];
    return knownWarnings(this.plan().warnings).map((w) => this.warningText(w));
  });

  // A reason clause: the known codes have a catalogue sentence, anything else a generic one. The text after
  // ':' (field_values_missing:date) fills {field}. For the consent ask the missing Arabic version means
  // the opt-in message itself is not set up.
  private reasonClause(reason: string, known: readonly string[], ns: 'reason'): string {
    const { code, field } = splitReason(reason);
    if (this.kind() === 'consent_request' && code === 'no_arabic_version') return this.t('promolang.reason.no_arabic_version.consent');
    if (known.includes(code)) return this.t(`promolang.${ns}.${code}`, { field });
    return this.t('promolang.reason.unknown');
  }

  private warningText(w: PlanWarning): string {
    const d = w.detail as { count?: number } | null | undefined;
    const count = d && typeof d === 'object' && typeof d.count === 'number' ? d.count : '';
    return this.t(`promolang.warn.${w.code}`, { count });
  }
}
