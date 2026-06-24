import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-orders',
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
})
export class Orders implements OnInit {
  orders: any[] = [];
  total = 0;
  page = 1;
  pages = 1;
  loading = false;
  filterStatus = '';

  readonly statuses = ['', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params: any = { page: this.page, limit: 50 };
    if (this.filterStatus) params.status = this.filterStatus;
    this.api.getOrders(params).subscribe({
      next: (res) => { this.orders = res.orders; this.total = res.total; this.pages = res.pages; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  onFilter() { this.page = 1; this.load(); }

  updateStatus(order: any, status: string) {
    this.api.updateOrderStatus(order._id, status).subscribe(() => {
      order.status = status;
    });
  }

  statusBadge(status: string): string {
    const map: any = { delivered: 'badge-success', shipped: 'badge-primary', confirmed: 'badge-info', pending: 'badge-warning', cancelled: 'badge-danger' };
    return map[status] ?? 'badge-neutral';
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
