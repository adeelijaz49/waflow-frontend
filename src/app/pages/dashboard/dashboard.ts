import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { InsightCardComponent, Insight } from '../../shared/insight-card/insight-card';
import { InsightActionsService } from '../../shared/insight-actions.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, AppCurrencyPipe, DatePipe, StatusBadgePipe, InsightCardComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  stats: any = null;
  loading = true;
  insights: Insight[] = [];

  constructor(private api: ApiService, public auth: AuthService, private insightActions: InsightActionsService) {}

  ngOnInit() {
    this.api.getOrderStats().subscribe({
      next: (data) => { this.stats = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
    this.api.getInsights('dashboard').subscribe({
      next: (data) => { this.insights = data; },
      error: () => {},
    });
  }

  dismissInsight(insight: Insight)       { this.insightActions.dismiss(insight, this.insights); }
  insightPrimary(insight: Insight)       { this.insightActions.primaryAction(insight, this.insights); }
  insightSecondary(insight: Insight)     { this.insightActions.secondaryAction(insight); }

  get onboarding() {
    return this.auth.sessionSnapshot?.workspace?.onboarding;
  }
}
