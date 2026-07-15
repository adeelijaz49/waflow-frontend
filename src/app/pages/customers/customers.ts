import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { StatusBadgePipe } from '../../shared/status-badge.pipe';

@Component({
  selector: 'app-customers',
  imports: [CommonModule, FormsModule, AppCurrencyPipe, DatePipe, StatusBadgePipe],
  templateUrl: './customers.html',
  styleUrl: './customers.css',
})
export class Customers implements OnInit {
  customers: any[] = [];
  total = 0;
  page = 1;
  pages = 1;
  loading = false;
  search = '';

  selectedCustomer: any = null;
  detailLoading = false;
  detailTab: 'orders' | 'whatsapp' | 'products' | 'campaigns' | 'services' = 'orders';

  whatsappHistory: any[] = [];
  loadingHistory = false;
  bookings: any[] = [];
  loadingBookings = false;

  showAddModal = false;
  saving = false;
  form = { firstname: '', lastname: '', phone: '', email: '' };

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params: any = { page: this.page, limit: 50 };
    if (this.search) params.search = this.search;
    this.api.getCustomers(params).subscribe({
      next: (res) => { this.customers = res.customers; this.total = res.total; this.pages = res.pages; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  onSearch() { this.page = 1; this.load(); }

  viewDetail(c: any) {
    this.selectedCustomer = null;
    this.detailTab = 'orders';
    this.whatsappHistory = [];
    this.bookings = [];
    this.detailLoading = true;
    this.api.getCustomer(c._id).subscribe({
      next: (data) => { this.selectedCustomer = data; this.detailLoading = false; },
      error: () => { this.detailLoading = false; },
    });
  }

  openDetailTab(tab: typeof this.detailTab) {
    this.detailTab = tab;
    if (tab === 'whatsapp' || tab === 'campaigns') this.loadWhatsAppHistory();
    if (tab === 'services') this.loadBookings();
  }

  private loadWhatsAppHistory() {
    if (this.whatsappHistory.length || this.loadingHistory) return;
    this.loadingHistory = true;
    this.api.getCustomerWhatsAppHistory(this.selectedCustomer._id).subscribe({
      next: (data) => { this.whatsappHistory = data; this.loadingHistory = false; },
      error: () => { this.loadingHistory = false; },
    });
  }

  private loadBookings() {
    if (this.bookings.length || this.loadingBookings) return;
    this.loadingBookings = true;
    this.api.getCustomerBookings(this.selectedCustomer._id).subscribe({
      next: (data) => { this.bookings = data; this.loadingBookings = false; },
      error: () => { this.loadingBookings = false; },
    });
  }

  get campaignsReceived(): any[] {
    return this.whatsappHistory.filter(h => h.kind === 'promotion');
  }

  get productsPurchased(): { name: string; quantity: number; orders: number }[] {
    const byName = new Map<string, { name: string; quantity: number; orders: number }>();
    for (const o of this.selectedCustomer?.orders || []) {
      const seenInThisOrder = new Set<string>();
      for (const item of o.items || []) {
        const name = item.productName || 'Unknown item';
        const entry = byName.get(name) || { name, quantity: 0, orders: 0 };
        entry.quantity += item.quantity || 1;
        if (!seenInThisOrder.has(name)) { entry.orders += 1; seenInThisOrder.add(name); }
        byName.set(name, entry);
      }
    }
    return [...byName.values()].sort((a, b) => b.quantity - a.quantity);
  }

  waKindLabel(kind: string): string {
    const map: any = { promotion: '📣 Promotion', loyalty_reminder: '💎 Loyalty Reminder', booking_notification: '📋 Booking Update' };
    return map[kind] ?? kind;
  }

  openAdd() {
    this.form = { firstname: '', lastname: '', phone: '', email: '' };
    this.showAddModal = true;
  }

  saveCustomer() {
    this.saving = true;
    this.api.createCustomer(this.form).subscribe({
      next: () => { this.showAddModal = false; this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
