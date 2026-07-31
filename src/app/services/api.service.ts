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
  getCustomerWhatsAppHistory(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/customers/${id}/whatsapp-history`);
  }
  getCustomerBookings(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/customers/${id}/bookings`);
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
  refundOrder(id: string): Observable<any> {
    return this.http.post(`${API}/orders/${id}/refund`, {});
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  getLoyaltySettings(): Observable<any> {
    return this.http.get(`${API}/settings/loyalty`);
  }
  saveLoyaltySettings(data: any): Observable<any> {
    return this.http.put(`${API}/settings/loyalty`, data);
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  getTokenStatus(): Observable<any> {
    return this.http.get(`${API}/whatsapp/token-status`);
  }
  refreshToken(): Observable<any> {
    return this.http.post(`${API}/whatsapp/refresh-token`, {});
  }
  // Read-only (DEFECT-05) — creating/editing a template happens inside the
  // Promotion or Flow it belongs to; the fixed fallback templates are created
  // automatically on first use if missing (see utils/whatsapp.js#ensureTemplateExists).
  getTemplates(): Observable<any> {
    return this.http.get(`${API}/whatsapp/templates`);
  }

  // ── Promotions ────────────────────────────────────────────────────────────
  getPromotions(params: any = {}): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions`, { params });
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
  // Dedicated /demo sales-presentation page only — real send to a real phone the
  // presenter controls. Do not call this from the regular Promotions screen.
  sendLiveDemoPromotion(promotionId: string, customerIds: string[]): Observable<any> {
    return this.http.post(`${API}/promotions/${promotionId}/send-live-demo`, { customerIds });
  }
  sendLoyaltyReminders(customerIds?: string[]): Observable<any> {
    return this.http.post(`${API}/promotions/loyalty/remind`, { customerIds: customerIds || [] });
  }
  getCampaignReport(promotionId: string): Observable<any> {
    return this.http.get(`${API}/promotions/${promotionId}/report`);
  }
  previewPromotionMessage(promotionId: string): Observable<any> {
    return this.http.get(`${API}/promotions/${promotionId}/preview`);
  }
  sendTestMessage(promotionId: string, phone: string): Observable<any> {
    return this.http.post(`${API}/promotions/${promotionId}/test-send`, { phone });
  }

  // ── Flows ─────────────────────────────────────────────────────────────────
  getFlows(params: any = {}): Observable<any[]> {
    return this.http.get<any[]>(`${API}/flows`, { params });
  }
  getFlow(id: string): Observable<any> {
    return this.http.get(`${API}/flows/${id}`);
  }
  createFlow(data: any): Observable<any> {
    return this.http.post(`${API}/flows`, data);
  }
  updateFlow(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/flows/${id}`, data);
  }
  deleteFlow(id: string): Observable<any> {
    return this.http.delete(`${API}/flows/${id}`);
  }
  activateFlow(id: string): Observable<any> {
    return this.http.post(`${API}/flows/${id}/activate`, {});
  }
  pauseFlow(id: string): Observable<any> {
    return this.http.post(`${API}/flows/${id}/pause`, {});
  }
  getFlowEnrollments(id: string, params: any = {}): Observable<any> {
    return this.http.get(`${API}/flows/${id}/enrollments`, { params });
  }
  getFlowReport(id: string): Observable<any> {
    return this.http.get(`${API}/flows/${id}/report`);
  }
  previewFlowMessage(triggerType: string): Observable<any> {
    return this.http.get(`${API}/flows/preview`, { params: { triggerType } });
  }
  getFlowMessageVariables(triggerType: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/flows/message-variables`, { params: { triggerType } });
  }
  getPromotionMessageVariables(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions/message-variables`);
  }
  getFlowPresets(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/flows/presets`);
  }

  // ── Message Nodes (branching — see models/MessageNode.js) ──────────────────
  createMessageNode(data: any): Observable<any> {
    return this.http.post(`${API}/message-nodes`, data);
  }
  getMessageNode(id: string): Observable<any> {
    return this.http.get(`${API}/message-nodes/${id}`);
  }
  updateMessageNode(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/message-nodes/${id}`, data);
  }
  deleteMessageNode(id: string): Observable<any> {
    return this.http.delete(`${API}/message-nodes/${id}`);
  }
  submitMessageNodeTemplate(id: string): Observable<any> {
    return this.http.post(`${API}/message-nodes/${id}/submit-template`, {});
  }
  refreshMessageNodeTemplateStatus(id: string): Observable<any> {
    return this.http.post(`${API}/message-nodes/${id}/refresh-status`, {});
  }

  // ── Services ──────────────────────────────────────────────────────────────
  getServices(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/services`);
  }
  getService(id: string): Observable<any> {
    return this.http.get(`${API}/services/${id}`);
  }
  createService(data: any): Observable<any> {
    return this.http.post(`${API}/services`, data);
  }
  updateService(id: string, data: any): Observable<any> {
    return this.http.put(`${API}/services/${id}`, data);
  }
  deleteService(id: string): Observable<any> {
    return this.http.delete(`${API}/services/${id}`);
  }

  // ── Time Slots ────────────────────────────────────────────────────────────
  getSlots(serviceId: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/services/${serviceId}/slots`);
  }
  createSlot(serviceId: string, data: any): Observable<any> {
    return this.http.post(`${API}/services/${serviceId}/slots`, data);
  }
  updateSlot(serviceId: string, slotId: string, data: any): Observable<any> {
    return this.http.put(`${API}/services/${serviceId}/slots/${slotId}`, data);
  }
  deleteSlot(serviceId: string, slotId: string): Observable<any> {
    return this.http.delete(`${API}/services/${serviceId}/slots/${slotId}`);
  }

  // ── Bookings ──────────────────────────────────────────────────────────────
  getBookings(serviceId: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/services/${serviceId}/bookings`);
  }
  cancelBooking(bookingId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/cancel`, {});
  }
  rescheduleBooking(bookingId: string, newSlotId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/reschedule`, { newSlotId });
  }
  completeBooking(bookingId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/complete`, {});
  }
  confirmBookingRequest(bookingId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/confirm`, {});
  }
  declineBookingRequest(bookingId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/decline`, {});
  }
  markNoShow(bookingId: string): Observable<any> {
    return this.http.post(`${API}/services/bookings/${bookingId}/no-show`, {});
  }

  // ── Uploads ───────────────────────────────────────────────────────────────
  uploadImage(file: File): Observable<{ url: string }> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ url: string }>(`${API}/uploads/image`, form);
  }
}
