import { Component, computed, inject, input } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import type { CampaignPlan } from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { LangPill } from '../shared/lang-pill';
import { WaPreview } from '../shared/wa-preview';
import { blockedLine, fallbackLine, reasonText, skippedTotal, warningLine } from './campaign-text';

const SKIP_KEYS = ['noConsent', 'optedOut', 'demo', 'invalidPhone'] as const;

// Read-only rendering of a campaign plan: recipients per language, who is skipped, the variants
// table (approval + whether each can be sent), fallback / blocked callouts, warnings and up to three
// sample messages. Used by the composer (live plan) and the detail page (stored / fresh plan).
@Component({
  selector: 'app-campaign-plan',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, ApprovalBadge, LangPill, WaPreview],
  templateUrl: './plan-view.html',
  styleUrl: './plan-view.css',
})
export class PlanView {
  private readonly i18n = inject(I18nService);

  readonly plan = input.required<CampaignPlan>();
  readonly showSamples = input(true);

  readonly skipKeys = SKIP_KEYS;
  readonly skippedTotal = computed(() => skippedTotal(this.plan()));
  readonly fallbackLines = computed(() => this.plan().fallbacks.map((f) => fallbackLine(this.i18n, f)));
  readonly blockedLines = computed(() => this.plan().blocked.map((b) => blockedLine(this.i18n, b)));
  readonly warningLines = computed(() => this.plan().warnings.map((w) => warningLine(this.i18n, w)));
  readonly samples = computed(() => this.plan().sampleRecipients.slice(0, 3));
  readonly showBilingual = computed(() => this.plan().languageMode === 'bilingual' || this.plan().byLanguage.bilingual > 0);

  reason(code: string | null, language: string): string {
    return reasonText(this.i18n, code, language);
  }
}
