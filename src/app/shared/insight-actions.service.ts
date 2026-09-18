import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../services/api.service';
import type { Insight } from './insight-card/insight-card';

// Shared by every page that renders <app-insight-card> (dashboard, promotions,
// customers) so "dismiss persists it, a CTA click marks it actioned and
// navigates" isn't reimplemented three times. AI Mode does NOT use this —
// its cards feed the chat input instead (see ai-mode.ts), reusing the
// existing confirm-gated send flow rather than a direct navigation.
@Injectable({ providedIn: 'root' })
export class InsightActionsService {
  constructor(private api: ApiService, private router: Router) {}

  dismiss(insight: Insight, list: Insight[]) {
    const idx = list.indexOf(insight);
    if (idx > -1) list.splice(idx, 1);
    this.api.updateInsightStatus(insight.insightKey, 'dismissed', insight.rawMetric).subscribe({ error: () => {} });
  }

  // Primary CTA click = "actioned" per spec; secondary CTA is just a
  // navigation shortcut (e.g. "View Campaign") and doesn't dismiss the card.
  primaryAction(insight: Insight, list: Insight[]) {
    const idx = list.indexOf(insight);
    if (idx > -1) list.splice(idx, 1);
    this.api.updateInsightStatus(insight.insightKey, 'actioned', insight.rawMetric).subscribe({ error: () => {} });
    this.navigate(insight.primaryCta.action);
  }

  secondaryAction(insight: Insight) {
    if (insight.secondaryCta) this.navigate(insight.secondaryCta.action);
  }

  private navigate(action: { type: 'navigate'; path: string; queryParams?: Record<string, any> }) {
    if (action.type !== 'navigate') return;
    this.router.navigate([action.path], { queryParams: action.queryParams || {} });
  }
}
