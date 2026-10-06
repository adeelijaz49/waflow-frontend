import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api/referrals`;

// Dedicated client for the Referral Promotions feature — kept separate from
// ApiService so the feature stays entirely in its own set of files, same
// pattern as InboxApiService / EntitlementsApiService.
@Injectable({ providedIn: 'root' })
export class ReferralsApiService {
  constructor(private http: HttpClient) {}

  // ── Promotions ────────────────────────────────────────────────────────────
  getPromotions(status?: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions`, { params: status ? { status } : {} });
  }
  createPromotion(data: any): Observable<any> {
    return this.http.post(`${API}/promotions`, data);
  }
  getPromotion(id: string): Observable<any> {
    return this.http.get(`${API}/promotions/${id}`);
  }
  updatePromotion(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/promotions/${id}`, data);
  }
  setStatus(id: string, status: string): Observable<any> {
    return this.http.post(`${API}/promotions/${id}/status`, { status });
  }
  getReport(id: string): Observable<any> {
    return this.http.get(`${API}/promotions/${id}/report`);
  }

  // ── Links ─────────────────────────────────────────────────────────────────
  getGenericLink(id: string): Observable<any> {
    return this.http.get(`${API}/promotions/${id}/generic-link`);
  }
  generateCustomerLinks(id: string, customerIds: string[]): Observable<any[]> {
    return this.http.post<any[]>(`${API}/promotions/${id}/customer-links`, { customerIds });
  }
  sendLinks(id: string, customerIds: string[]): Observable<{ sentCount: number; skipped: any[]; total: number }> {
    return this.http.post<{ sentCount: number; skipped: any[]; total: number }>(`${API}/promotions/${id}/send`, { customerIds });
  }
  getQrCode(codeId: string): Observable<{ qrCodeDataUrl: string }> {
    return this.http.get<{ qrCodeDataUrl: string }>(`${API}/codes/${codeId}/qr`);
  }

  // ── Referrals / rewards ──────────────────────────────────────────────────
  voidReferral(id: string, reason?: string): Observable<any> {
    return this.http.post(`${API}/referrals/${id}/void`, { reason });
  }
  getPendingApprovals(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/pending-approvals`);
  }
  approveReward(id: string, approve: boolean): Observable<any> {
    return this.http.post(`${API}/referrals/${id}/approve`, { approve });
  }
  getCustomerSummary(customerId: string): Observable<any> {
    return this.http.get(`${API}/customers/${customerId}/summary`);
  }
  redeemVoucher(id: string): Observable<any> {
    return this.http.post(`${API}/vouchers/${id}/redeem`, {});
  }
}
