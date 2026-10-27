import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api`;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // ── Auth (passwordless login) ────────────────────────────────────────────
  requestOtp(phone: string): Observable<any> {
    return this.http.post(`${API}/auth/otp/request`, { phone });
  }
  verifyOtp(phone: string, code: string): Observable<any> {
    return this.http.post(`${API}/auth/otp/verify`, { phone, code });
  }
  requestMagicLink(email: string): Observable<any> {
    return this.http.post(`${API}/auth/magic-link/request`, { email });
  }
  verifyMagicLink(token: string): Observable<any> {
    return this.http.post(`${API}/auth/magic-link/verify`, { token });
  }
  selectWorkspace(preAuthToken: string, workspaceId: string): Observable<any> {
    return this.http.post(`${API}/auth/select-workspace`, { preAuthToken, workspaceId });
  }
  getMe(): Observable<any> {
    return this.http.get(`${API}/auth/me`);
  }
  // Temporary — 404s unless the backend has DEV_LOGIN_SECRET set. Remove once
  // WhatsApp OTP / email magic link are both configured for real.
  devLogin(secret: string): Observable<any> {
    return this.http.post(`${API}/auth/dev-login`, { secret });
  }

  // ── Team (workspace members + invites) ───────────────────────────────────
  getMembers(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/workspaces/me/members`);
  }
  removeMember(userId: string): Observable<any> {
    return this.http.delete(`${API}/workspaces/me/members/${userId}`);
  }
  getInvites(): Observable<any[]> {
    return this.http.get<any[]>(`${API}/workspaces/me/invites`);
  }
  createInvite(contactType: 'phone' | 'email', contact: string, role: 'owner' | 'member'): Observable<any> {
    return this.http.post(`${API}/workspaces/me/invites`, { contactType, contact, role });
  }
  revokeInvite(id: string): Observable<any> {
    return this.http.delete(`${API}/workspaces/me/invites/${id}`);
  }

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
  markCustomerConsented(id: string): Observable<any> {
    return this.http.post(`${API}/customers/${id}/consent`, {});
  }
  getCustomerWhatsAppHistory(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/customers/${id}/whatsapp-history`);
  }
  getCustomerBookings(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/customers/${id}/bookings`);
  }
  getConsentStats(): Observable<any> {
    return this.http.get(`${API}/customers/consent-stats`);
  }
  sendConsentRequests(): Observable<any> {
    return this.http.post(`${API}/customers/consent-requests`, {});
  }
  // Consent log (who opted in / out, when, through which message). Filters: status (opted_in | opted_out |
  // not_responded), promotionId, page, limit. Empty filter values are left out of the request.
  getConsentLog(filter: any = {}): Observable<any> {
    return this.http.get(`${API}/customers/consent-log`, { params: ApiService.cleanParams(filter) });
  }
  // The same log as a spreadsheet. A Bearer-auth export cannot be a plain link, so it is fetched as a blob.
  downloadConsentLogCsv(filter: { status?: string; promotionId?: string } = {}): Observable<Blob> {
    return this.http.get(`${API}/customers/consent-log.csv`, { params: ApiService.cleanParams(filter), responseType: 'blob' });
  }
  getCustomerConsentEvents(customerId: string): Observable<any[]> {
    return this.http.get<any>(`${API}/customers/${customerId}/consent-events`).pipe(
      map((res) => (Array.isArray(res) ? res : (res?.events ?? []))),
    );
  }

  // Drops undefined / null / empty-string values so an unset filter never reaches the URL.
  private static cleanParams(filter: Record<string, any> = {}): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(filter || {})) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
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

  // ── Onboarding ───────────────────────────────────────────────────────────
  updateOnboarding(data: { completed?: boolean; currentStep?: number }): Observable<any> {
    return this.http.patch(`${API}/workspaces/me/onboarding`, data);
  }

  // ── Bulk Import (customers/products/services) ──────────────────────────────
  uploadImport(entityType: string, file: File, marketingConsentAttested = false): Observable<any> {
    const form = new FormData();
    form.append('entityType', entityType);
    form.append('file', file);
    form.append('marketingConsentAttested', String(marketingConsentAttested));
    return this.http.post(`${API}/imports`, form);
  }
  updateImportMapping(id: string, columnMapping: Record<string, string>): Observable<any> {
    return this.http.patch(`${API}/imports/${id}/mapping`, { columnMapping });
  }
  runImport(id: string, discrepancyResolutions: { rowIndex: number; action: 'apply' | 'skip' }[]): Observable<any> {
    return this.http.post(`${API}/imports/${id}/run`, { discrepancyResolutions });
  }
  getImportJob(id: string): Observable<any> {
    return this.http.get(`${API}/imports/${id}`);
  }
  // Every /api/imports/* route sits behind requireAuth, so these two can't be
  // a plain <a href> — the Authorization header only gets attached to actual
  // HttpClient requests (via the auth interceptor), not a browser navigation.
  downloadImportErrorReport(id: string): Observable<Blob> {
    return this.http.get(`${API}/imports/${id}/error-report`, { responseType: 'blob' });
  }
  downloadImportSampleTemplate(entityType: string): Observable<Blob> {
    return this.http.get(`${API}/imports/sample-template`, { params: { entityType }, responseType: 'blob' });
  }

  // ── Support ──────────────────────────────────────────────────────────────
  submitSupportTicket(message: string, contactEmail: string): Observable<any> {
    return this.http.post(`${API}/support`, { message, contactEmail });
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
  createFixedTemplate(route: string): Observable<any> {
    return this.http.post(`${API}/whatsapp/${route}`, {});
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
  // `audience` (opted_in | not_responded | opted_out) narrows the list by consent; omitted = exactly the legacy request.
  getRecommendedCustomers(promotionId: string, limit = 100, audience?: string): Observable<any[]> {
    return this.http.get<any[]>(`${API}/promotions/${promotionId}/recommended-customers`, { params: audience ? { limit, audience } : { limit } });
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
  // What WhatsApp did with a send: accepted / delivered / refused, with the reasons. `sinceSeconds` limits it to one send
  // (seconds elapsed since the merchant pressed Send, so the browser's clock never matters); omit it for the whole promotion.
  getPromotionDelivery(promotionId: string, sinceSeconds?: number): Observable<any> {
    return this.http.get(`${API}/promotions/${promotionId}/delivery`, { params: sinceSeconds ? { sinceSeconds } : {} });
  }
  previewPromotionMessage(promotionId: string): Observable<any> {
    return this.http.get(`${API}/promotions/${promotionId}/preview`);
  }
  sendTestMessage(promotionId: string, phone: string): Observable<any> {
    return this.http.post(`${API}/promotions/${promotionId}/test-send`, { phone });
  }
  // The merchant closed the "your message was approved - you can now send" notice (Promotion.sendRequest.dismissedAt).
  dismissSendRequest(promotionId: string): Observable<any> {
    return this.http.post(`${API}/promotions/${promotionId}/dismiss-send-request`, {});
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

  // ── AI Mode ───────────────────────────────────────────────────────────────
  getAiChatSession(sessionId: string): Observable<any> {
    return this.http.get(`${API}/ai-chat/session/${sessionId}`);
  }
  sendAiChatMessage(sessionId: string, message: string): Observable<any> {
    return this.http.post(`${API}/ai-chat/message`, { sessionId, message });
  }
  confirmAiAction(sessionId: string, actionId: string, confirm: boolean): Observable<any> {
    return this.http.post(`${API}/ai-chat/confirm-action`, { sessionId, actionId, confirm });
  }

  // ── Smart Insights ───────────────────────────────────────────────────────
  getInsights(surface: 'dashboard' | 'campaigns' | 'customers' | 'aimode'): Observable<any[]> {
    return this.http.get<any[]>(`${API}/insights`, { params: { surface } });
  }
  updateInsightStatus(insightKey: string, status: 'dismissed' | 'actioned', rawMetric?: number): Observable<any> {
    return this.http.post(`${API}/insights/status`, { insightKey, status, rawMetric });
  }
}
