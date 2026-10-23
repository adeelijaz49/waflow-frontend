import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  OnbApprovalsResponse, OnbBillingRefreshResponse, OnbBusiness, OnbConnectCompleteBody, OnbConnectConfig,
  OnbConnectEventBody, OnbConnectEventResponse, OnbConnectResult, OnbConnectionSnapshot, OnbEventBody, OnbFirstPromotion,
  OnbDisconnectResponse, OnbDisplayNameResponse, OnbFirstPromotionStateResponse, OnbHelpContext, OnbNotification,
  OnbNotificationsReadResponse, OnbNotificationsResponse, OnbNumberPathBody, OnbNumberPathResponse, OnbNumberReadyResponse, OnbPaymentConfirmedResponse,
  OnbPreferencesResponse, OnbPromptKind, OnbPromptResponse, OnbState, OnbSupportRequestResponse, OnbTemplateResubmitResponse,
  OnbTemplatesResponse, OnbUrlResponse,
} from './onb.types';

const API = `${environment.apiBaseUrl}/api/onboarding`;
const seg = (v: string): string => encodeURIComponent(v);

// Thin typed wrappers over /api/onboarding/* (DB section 5). No catchError here: callers map errors with
// onbErrorText(). The auth interceptor attaches the bearer token; no request ever carries a workspaceId.
@Injectable({ providedIn: 'root' })
export class OnbApiService {
  private readonly http = inject(HttpClient);

  getState(): Observable<OnbState> {
    return this.http.get<OnbState>(`${API}/state`);
  }

  // Billing
  checkout(planCode?: string): Observable<OnbUrlResponse> {
    return this.http.post<OnbUrlResponse>(`${API}/checkout`, planCode ? { planCode } : {});
  }
  billingPortal(): Observable<OnbUrlResponse> {
    return this.http.post<OnbUrlResponse>(`${API}/billing-portal`, {});
  }
  billingRefresh(): Observable<OnbBillingRefreshResponse> {
    return this.http.post<OnbBillingRefreshResponse>(`${API}/billing/refresh`, {});
  }

  helpContext(): Observable<OnbHelpContext> {
    return this.http.get<OnbHelpContext>(`${API}/help-context`);
  }

  // Step 1
  putBusiness(partial: Partial<OnbBusiness> & Record<string, unknown>): Observable<OnbState> {
    return this.http.put<OnbState>(`${API}/business`, partial);
  }
  preferences(body: { uiLanguage: 'en' | 'ar'; languages?: string[] }): Observable<OnbPreferencesResponse> {
    return this.http.post<OnbPreferencesResponse>(`${API}/preferences`, body);
  }

  // Step 2
  numberPath(body: OnbNumberPathBody): Observable<OnbNumberPathResponse> {
    return this.http.post<OnbNumberPathResponse>(`${API}/number/path`, body);
  }
  numberReady(): Observable<OnbNumberReadyResponse> {
    return this.http.post<OnbNumberReadyResponse>(`${API}/number/ready`, {});
  }
  numberSupportRequest(message?: string): Observable<OnbSupportRequestResponse> {
    return this.http.post<OnbSupportRequestResponse>(`${API}/number/support-request`, message ? { message } : {});
  }

  // Step 3
  connectConfig(): Observable<OnbConnectConfig> {
    return this.http.get<OnbConnectConfig>(`${API}/connect/config`);
  }
  connectEvent(body: OnbConnectEventBody): Observable<OnbConnectEventResponse> {
    return this.http.post<OnbConnectEventResponse>(`${API}/connect/event`, body);
  }
  connectComplete(body: OnbConnectCompleteBody): Observable<OnbConnectResult> {
    return this.http.post<OnbConnectResult>(`${API}/connect/complete`, body);
  }
  connectResume(): Observable<OnbConnectResult> {
    return this.http.post<OnbConnectResult>(`${API}/connect/resume`, {});
  }
  connection(): Observable<OnbConnectionSnapshot> {
    return this.http.get<OnbConnectionSnapshot>(`${API}/connection`);
  }
  connectionRefresh(): Observable<OnbConnectionSnapshot> {
    return this.http.post<OnbConnectionSnapshot>(`${API}/connection/refresh`, {});
  }
  reconnect(): Observable<OnbConnectConfig> {
    return this.http.post<OnbConnectConfig>(`${API}/connection/reconnect`, {});
  }
  disconnectRequest(): Observable<{ confirmationToken: string; expiresInSec: number; impactKeys?: string[] }> {
    return this.http.post<{ confirmationToken: string; expiresInSec: number; impactKeys?: string[] }>(`${API}/connection/disconnect/request`, {});
  }
  disconnect(confirmationToken: string): Observable<OnbDisconnectResponse> {
    return this.http.post<OnbDisconnectResponse>(`${API}/connection/disconnect`, { confirmationToken, confirmText: 'DISCONNECT' });
  }

  // Step 4
  approvals(): Observable<OnbApprovalsResponse> {
    return this.http.get<OnbApprovalsResponse>(`${API}/approvals`);
  }
  paymentConfirmed(): Observable<OnbPaymentConfirmedResponse> {
    return this.http.post<OnbPaymentConfirmedResponse>(`${API}/approvals/payment-confirmed`, { confirmed: true });
  }
  displayName(newName: string): Observable<OnbDisplayNameResponse> {
    return this.http.post<OnbDisplayNameResponse>(`${API}/display-name`, { newName });
  }
  templates(): Observable<OnbTemplatesResponse> {
    return this.http.get<OnbTemplatesResponse>(`${API}/templates`);
  }
  templatesSubmit(): Observable<OnbTemplatesResponse> {
    return this.http.post<OnbTemplatesResponse>(`${API}/templates/submit`, {});
  }
  templateResubmit(key: string, language: string, body: Record<string, unknown> = {}): Observable<OnbTemplateResubmitResponse> {
    return this.http.post<OnbTemplateResubmitResponse>(`${API}/templates/${seg(key)}/${seg(language)}/resubmit`, body);
  }

  // Customers / products prompts, Step 5
  promptDone(kind: OnbPromptKind, state: 'done' | 'skipped'): Observable<OnbPromptResponse> {
    return this.http.post<OnbPromptResponse>(`${API}/prompts/${kind}`, { state });
  }
  testMessage(phone?: string): Observable<{ sent: boolean; to?: string; templateKey?: string }> {
    return this.http.post<{ sent: boolean; to?: string; templateKey?: string }>(`${API}/test-message`, phone ? { phone } : {});
  }
  firstPromotion(): Observable<OnbFirstPromotion> {
    return this.http.get<OnbFirstPromotion>(`${API}/first-promotion`);
  }
  firstPromotionState(state: 'started' | 'done' | 'skipped'): Observable<OnbFirstPromotionStateResponse> {
    return this.http.post<OnbFirstPromotionStateResponse>(`${API}/first-promotion/state`, { state });
  }

  // Analytics + notifications
  event(body: OnbEventBody): Observable<unknown> {
    return this.http.post(`${API}/events`, body);
  }
  notifications(unread = false, limit = 30): Observable<OnbNotificationsResponse | OnbNotification[]> {
    let params = new HttpParams().set('limit', String(Math.min(30, Math.max(1, Math.floor(limit)))));
    if (unread) params = params.set('unread', '1');
    return this.http.get<OnbNotificationsResponse | OnbNotification[]>(`${API}/notifications`, { params });
  }
  notificationsRead(body: { ids: string[] } | { all: true }): Observable<OnbNotificationsReadResponse> {
    return this.http.post<OnbNotificationsReadResponse>(`${API}/notifications/read`, body);
  }
}
