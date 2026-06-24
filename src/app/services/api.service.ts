import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api`;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // ── Products ──────────────────────────────────────────────────────────────
  getProducts(params: any = {}): Observable<any> {
    return this.http.get(`${API}/products`, { params });
  }
  getProductCategories(): Observable<string[]> {
    return this.http.get<string[]>(`${API}/products/categories`);
  }
  getProduct(id: string): Observable<any> {
    return this.http.get(`${API}/products/${id}`);
  }
  createProduct(data: any): Observable<any> {
    return this.http.post(`${API}/products`, data);
  }
  updateProduct(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/products/${id}`, data);
  }
  deleteProduct(id: string): Observable<any> {
    return this.http.delete(`${API}/products/${id}`);
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  getCustomers(params: any = {}): Observable<any> {
    return this.http.get(`${API}/customers`, { params });
  }
  getCustomer(id: string): Observable<any> {
    return this.http.get(`${API}/customers/${id}`);
  }
  createCustomer(data: any): Observable<any> {
    return this.http.post(`${API}/customers`, data);
  }
  updateCustomer(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/customers/${id}`, data);
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  getOrders(params: any = {}): Observable<any> {
    return this.http.get(`${API}/orders`, { params });
  }
  getOrderStats(): Observable<any> {
    return this.http.get(`${API}/orders/stats`);
  }
  getOrder(id: string): Observable<any> {
    return this.http.get(`${API}/orders/${id}`);
  }
  updateOrderStatus(id: string, status: string): Observable<any> {
    return this.http.put(`${API}/orders/${id}/status`, { status });
  }

  // ── Promotions ────────────────────────────────────────────────────────────
  getPromotions(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions`);
  }
  getPromotion(id: string): Observable<any> {
    return this.http.get(`${API}/promotions/${id}`);
  }
  createPromotion(data: any): Observable<any> {
    return this.http.post(`${API}/promotions`, data);
  }
  updatePromotion(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/promotions/${id}`, data);
  }
  deletePromotion(id: string): Observable<any> {
    return this.http.delete(`${API}/promotions/${id}`);
  }
  getRecommendedCustomers(promotionId: string, limit = 100): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions/${promotionId}/recommended-customers`, { params: { limit } });
  }
  sendPromotion(promotionId: string, customerIds: string[]): Observable<any> {
    return this.http.post(`${API}/promotions/${promotionId}/send`, { customerIds });
  }
  sendLoyaltyReminders(customerIds?: string[]): Observable<any> {
    return this.http.post(`${API}/promotions/loyalty/remind`, { customerIds: customerIds || [] });
  }
}
