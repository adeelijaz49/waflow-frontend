import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-products',
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './products.html',
  styleUrl: './products.css',
})
export class Products implements OnInit {
  products: any[] = [];
  categories: string[] = [];
  total = 0;
  page = 1;
  pages = 1;
  loading = false;
  search = '';
  filterCategory = '';

  showModal = false;
  saving = false;
  editingId: string | null = null;

  form: any = this.emptyForm();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.load();
    this.api.getProductCategories().subscribe(cats => this.categories = cats);
  }

  emptyForm() {
    return { name: '', description: '', category: '', basePrice: null, images: '', variants: [] };
  }

  load() {
    this.loading = true;
    const params: any = { page: this.page, limit: 50 };
    if (this.search) params.search = this.search;
    if (this.filterCategory) params.category = this.filterCategory;
    this.api.getProducts(params).subscribe({
      next: (res) => { this.products = res.products; this.total = res.total; this.pages = res.pages; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  onSearch() { this.page = 1; this.load(); }

  openAdd() {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showModal = true;
  }

  openEdit(p: any) {
    this.editingId = p._id;
    this.form = {
      name: p.name,
      description: p.description || '',
      category: p.category,
      basePrice: p.basePrice,
      images: p.images?.join(', ') || '',
      variants: [],
    };
    this.showModal = true;
  }

  save() {
    this.saving = true;
    const payload = {
      ...this.form,
      basePrice: +this.form.basePrice,
      images: this.form.images ? this.form.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    };
    const req = this.editingId
      ? this.api.updateProduct(this.editingId, payload)
      : this.api.createProduct(payload);
    req.subscribe({
      next: () => { this.showModal = false; this.saving = false; this.load(); },
      error: () => { this.saving = false; },
    });
  }

  remove(id: string) {
    if (!confirm('Remove this product?')) return;
    this.api.deleteProduct(id).subscribe(() => this.load());
  }

  totalStock(product: any): number {
    return (product.variants || []).reduce((s: number, v: any) => s + (v.stock || 0), 0);
  }

  uniqueColors(product: any): string[] {
    const colors: string[] = (product.variants || []).map((v: any) => v.color as string);
    return Array.from(new Set(colors));
  }

  uniqueSizes(product: any): string[] {
    const sizes: string[] = (product.variants || []).map((v: any) => v.size as string);
    return Array.from(new Set(sizes));
  }

  prevPage() { if (this.page > 1) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.pages) { this.page++; this.load(); } }
}
