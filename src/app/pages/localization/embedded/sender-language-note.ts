import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { SendLanguageCounts, SenderKind, SenderSendPlan } from '../localization.types';
import { errorCode, errorStatus } from '../shared/loc-errors';
import { EmbeddedText } from './embedded-text';
import { LanguagePlanSummary } from './language-plan-summary';
import { planCounts, splitReason } from './plan-summary.util';

// Informational "who gets which language" note shown next to the legacy Loyalty Points Reminder and
// consent request senders (flagged merchants only; the host page wraps it in an @if). One read-only plan
// request when it appears; it never blocks or changes the send, hides itself on 402/404/failure, and
// stays hidden when nobody in the audience speaks Arabic (nothing would differ from today).
@Component({
  selector: 'app-sender-language-note',
  imports: [RouterLink, LanguagePlanSummary],
  templateUrl: './sender-language-note.html',
  styleUrl: './sender-language-note.css',
})
export class SenderLanguageNote extends EmbeddedText implements OnInit {
  private readonly api = inject(LocalizationApiService);

  readonly sender = input.required<SenderKind>();
  readonly result = input<any>(null);

  readonly state = signal<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  readonly plan = signal<SenderSendPlan | null>(null);
  private started = false;

  readonly hasArabic = computed(() => {
    const p = this.plan();
    if (!p) return false;
    const c = planCounts(p);
    return c.ar + c.fallback > 0;
  });

  readonly sendSummary = computed(() => {
    const r = this.result() as (SendLanguageCounts & { error?: boolean }) | null;
    if (!r || r.error || (!r.languageCounts && !r.localization)) return null;
    const loc = r.localization;
    return {
      counts: r.languageCounts ?? null,
      fallbacks: (loc?.fallbackToEnglish ?? []).filter((f) => f.count > 0),
      stopped: loc?.stopped ? splitReason(loc.stopped).field || loc.stopped : null,
    };
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.started && this.state() !== 'error') return;
    this.started = true;
    this.state.set('loading');
    this.api.getSenderPlan(this.sender()).subscribe({
      next: (p) => { this.plan.set(p); this.state.set('ready'); },
      error: (err: unknown) => {
        const s = errorStatus(err);
        this.state.set(s === 402 || s === 404 || errorCode(err) === 'ARABIC_NOT_ENABLED' ? 'hidden' : 'error');
      },
    });
  }

  reasonText(reason: string): string {
    const { code, field } = splitReason(reason || 'unknown');
    if (this.sender() === 'consent_request' && code === 'no_arabic_version') return this.t('promolang.reason.no_arabic_version.consent');
    return this.has(`promolang.reason.${code}`) ? this.t(`promolang.reason.${code}`, { field }) : this.t('promolang.reason.unknown');
  }
  fallbackLine(f: { reason: string; count: number }): string {
    return this.tp('promolang.sent.fallback', f.count, { reason: this.reasonText(f.reason) });
  }
}
