import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api/inbox`;

export interface ConversationRow {
  customerId: string;
  name: string;
  phone: string;
  optedOut: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  tags: string[];
}

export type InboxFilter = 'all' | 'unread' | 'high-value' | 'inactive' | 'recent' | 'booking';

// Dedicated client for the WhatsApp Inbox feature — kept separate from
// ApiService so the Inbox stays entirely in its own set of files (see the
// feature's routes/inbox.js and shared/inbox.js on the backend).
@Injectable({ providedIn: 'root' })
export class InboxApiService {
  constructor(private http: HttpClient) {}

  getConversations(params: { filter?: InboxFilter; search?: string } = {}): Observable<{ conversations: ConversationRow[] }> {
    const query: any = {};
    if (params.filter && params.filter !== 'all') query.filter = params.filter;
    if (params.search) query.search = params.search;
    return this.http.get<{ conversations: ConversationRow[] }>(`${API}/conversations`, { params: query });
  }

  getThread(customerId: string): Observable<any> {
    return this.http.get(`${API}/conversations/${customerId}/thread`);
  }

  getSnapshot(customerId: string): Observable<any> {
    return this.http.get(`${API}/conversations/${customerId}/snapshot`);
  }

  sendMessage(customerId: string, body: string): Observable<any> {
    return this.http.post(`${API}/conversations/${customerId}/messages`, { body });
  }

  sendPaymentLink(customerId: string, amount: number): Observable<any> {
    return this.http.post(`${API}/conversations/${customerId}/payment-link`, { amount });
  }

  sendLoyaltyReminder(customerId: string): Observable<any> {
    return this.http.post(`${API}/conversations/${customerId}/loyalty-reminder`, {});
  }
}
