import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface InsightCta {
  label: string;
  action: { type: 'navigate'; path: string; queryParams?: Record<string, any> };
}

export interface Insight {
  insightKey: string;
  category: string;
  categoryLabel: string;
  icon: string;
  title: string;
  message: string;
  metricLabel: string;
  metricValue: string | number;
  rawMetric?: number;
  priorityTier: 'high' | 'medium' | 'low';
  priorityScore: number;
  primaryCta: InsightCta;
  secondaryCta: InsightCta | null;
  status: 'active' | 'dismissed';
  updatedAt: string;
}

// Purely presentational — this component doesn't know what a CTA *does* (the
// backend already encodes the navigation target on the insight itself, see
// shared/insights.js), it just reports which one was clicked. Each host page
// (dashboard/promotions/customers/ai-mode) owns the actual router.navigate()
// call and the "mark actioned" API call, since only the host knows its own
// routing context.
@Component({
  selector: 'app-insight-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './insight-card.html',
  styleUrl: './insight-card.css',
})
export class InsightCardComponent {
  @Input({ required: true }) insight!: Insight;
  @Output() dismiss = new EventEmitter<Insight>();
  @Output() primaryAction = new EventEmitter<Insight>();
  @Output() secondaryAction = new EventEmitter<Insight>();

  timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Updated just now';
    if (mins < 60) return `Updated ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Updated ${hours}h ago`;
    return `Updated ${Math.floor(hours / 24)}d ago`;
  }
}
