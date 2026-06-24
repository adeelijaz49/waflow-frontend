import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-customers',
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
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
    this.detailLoading = true;
    this.api.getCustomer(c._id).subscribe({
      next: (data) => { this.selectedCustomer = data; this.detailLoading = false; },
      error: () => { this.detailLoading = false; },
    });
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

  statusBadge(status: string): string {
    const map: any = { delivered: 'badge-success', shipped: 'badge-primary', confirmed: 'badge-info', pending: 'badge-warning', cancelled: 'badge-danger' };
    return map[status] ?? 'badge-neutral';
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
