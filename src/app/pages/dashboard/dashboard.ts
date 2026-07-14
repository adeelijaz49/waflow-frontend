import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, AppCurrencyPipe, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  stats: any = null;
  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getOrderStats().subscribe({
      next: (data) => { this.stats = data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  statusBadge(status: string): string {
    const map: any = { delivered: 'badge-success', shipped: 'badge-primary', confirmed: 'badge-info', pending: 'badge-warning', cancelled: 'badge-danger' };
    return map[status] ?? 'badge-neutral';
  }
}
