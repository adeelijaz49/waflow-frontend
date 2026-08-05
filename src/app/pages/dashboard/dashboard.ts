import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../shared/auth.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, AppCurrencyPipe, DatePipe, StatusBadgePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  stats: any = null;
  loading = true;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit() {
    this.api.getOrderStats().subscribe({
      next: (data) => { this.stats = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  get onboarding() {
    return this.auth.sessionSnapshot?.workspace?.onboarding;
  }
}
