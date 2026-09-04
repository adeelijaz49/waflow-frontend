import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AppCurrencyPipe } from '../../shared/app-currency.pipe';
import { SettingsService } from '../../shared/settings.service';
import { ImageCarousel } from '../../shared/image-carousel/image-carousel';
import { DialogService } from '../../shared/dialog.service';

@Component({
  selector: 'app-products',
  imports: [CommonModule, FormsModule, RouterLink, AppCurrencyPipe, ImageCarousel],
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

  constructor(private api: ApiService, private settings: SettingsService, private dialog: DialogService) {}

  get currencyCode(): string {
    return this.settings.currencySnapshot;
  }

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
      variants: (p.variants || []).map((v: any) => ({ size: v.size || '', color: v.color || '', stock: v.stock || 0, sku: v.sku || '' })),
    };
    this.showModal = true;
  }

  addVariant() {
    this.form.variants.push({ size: '', color: '', stock: 0, sku: '' });
  }

  removeVariant(i: number) {
    this.form.variants.splice(i, 1);
  }

  // The comma-separated string is the single source of truth for form.images
  // (matches the existing manual-paste field) — uploads and removals both
  // just rewrite that string, so the two entry methods never fight each other.
  get formImagesList(): string[] {
    return this.form.images ? this.form.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  }

  uploadingImage = false;
  uploadImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploadingImage = true;
    this.api.uploadImage(file).subscribe({
      next: (res) => {
        const list = this.formImagesList;
        list.push(res.url);
        this.form.images = list.join(', ');
        this.uploadingImage = false;
      },
      error: (err) => {
        this.uploadingImage = false;
        this.dialog.error(err.error?.error || 'Image upload failed — please try again.');
      },
    });
    (event.target as HTMLInputElement).value = ''; // allow re-selecting the same file
  }

  removeImage(index: number) {
    const list = this.formImagesList;
    list.splice(index, 1);
    this.form.images = list.join(', ');
  }

  save() {
    // A variant row needs both Size and Color together (backend requires
    // both). Rows nobody touched at all (blank size, blank color, no stock)
    // are just an unused "+ Add Size" click — drop them silently rather than
    // making the user delete their own accidental blank row. A row with
    // *some* data but not both required fields is a real mistake — stop and
    // tell the user exactly which row, instead of letting it hit the backend
    // as an invisible HTTP 400.
    const variants = (this.form.variants || []).filter(
      (v: any) => v.size?.trim() || v.color?.trim() || v.stock
    );
    const incomplete = variants
      .map((v: any, i: number) => ({ v, row: i + 1 }))
      .filter(({ v }: any) => !v.size?.trim() || !v.color?.trim());
    if (incomplete.length) {
      const rows = incomplete.map(({ row }: any) => row).join(', ');
      this.dialog.warn(
        `Size and Color are both required for a variant. Please fill in the missing field${incomplete.length > 1 ? 's' : ''} on row ${incomplete.length > 1 ? 's' : ''} ${rows}, or remove ${incomplete.length > 1 ? 'those rows' : 'that row'}.`,
        'Missing variant details'
      );
      return;
    }

    this.saving = true;
    const payload = {
      ...this.form,
      variants,
      basePrice: +this.form.basePrice,
      images: this.form.images ? this.form.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    };
    const req = this.editingId
      ? this.api.updateProduct(this.editingId, payload)
      : this.api.createProduct(payload);
    req.subscribe({
      next: () => { this.showModal = false; this.saving = false; this.load(); },
      error: (err) => {
        this.saving = false;
        this.dialog.error(err.error?.error || 'Could not save this product — please try again.');
      },
    });
  }

  async remove(id: string) {
    const ok = await this.dialog.confirm('Remove this product? This cannot be undone.', {
      title: 'Remove product', confirmLabel: 'Remove', type: 'warning',
    });
    if (!ok) return;
    this.api.deleteProduct(id).subscribe({
      next: () => this.load(),
      error: (err) => this.dialog.error(err.error?.error || 'Could not remove this product — please try again.'),
    });
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
