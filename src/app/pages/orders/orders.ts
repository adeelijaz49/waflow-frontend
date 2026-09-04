import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';
import { DialogService } from '../../shared/dialog.service';

@Component({
  selector: 'app-orders',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, DatePipe, StatusBadgePipe],
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
  filterSource = '';

  selectedOrder: any = null;
  refunding = false;

  readonly statuses = ['', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  readonly sources  = ['', 'product', 'campaign', 'booking', 'manual'];

  constructor(private api: ApiService, private dialog: DialogService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params: any = { page: this.page, limit: 50 };
    if (this.filterStatus) params.status = this.filterStatus;
    if (this.filterSource) params.source = this.filterSource;
    this.api.getOrders(params).subscribe({
      next: (res) => { this.orders = res.orders; this.total = res.total; this.pages = res.pages; this.loading = false; },
      error: (err) => { this.loading = false; this.dialog.error(err.error?.error || 'Could not load orders — please try again.'); },
    });
  }

  onFilter() { this.page = 1; this.load(); }

  updateStatus(order: any, status: string) {
    this.api.updateOrderStatus(order._id, status).subscribe({
      next: () => { order.status = status; },
      error: (err) => this.dialog.error(err.error?.error || 'Could not update order status — please try again.'),
    });
  }

  paymentBadge(status: string): string {
    const map: any = { paid: 'badge-success', pending: 'badge-warning', failed: 'badge-danger', refunded: 'badge-neutral' };
    return map[status] ?? 'badge-neutral';
  }

  sourceLabel(source: string): string {
    const map: any = { campaign: '📣 Campaign', manual: '🤖 Manual', booking: '✂️ Booking', product: '🛍️ Product' };
    return map[source] ?? source;
  }

  openDetail(order: any) { this.selectedOrder = order; }
  closeDetail() { this.selectedOrder = null; }

  async refundOrder(order: any) {
    const ok = await this.dialog.confirm(
      `Refund this order's payment (${order.total})? This issues a real Stripe refund and cannot be undone.`,
      { title: 'Refund order', confirmLabel: 'Refund', type: 'error' }
    );
    if (!ok) return;
    this.refunding = true;
    this.api.refundOrder(order._id).subscribe({
      next: (updated) => {
        order.paymentStatus = updated.paymentStatus;
        if (this.selectedOrder?._id === order._id) this.selectedOrder = { ...this.selectedOrder, paymentStatus: updated.paymentStatus };
        this.refunding = false;
      },
      error: (err) => { this.refunding = false; this.dialog.error(err.error?.error || 'Refund failed. Check backend logs.'); },
    });
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
