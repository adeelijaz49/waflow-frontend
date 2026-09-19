import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api/entitlements`;

export type UsageType =
  | 'locations'
  | 'whatsappAccounts'
  | 'users'
  | 'customerProfiles'
  | 'aiPromptsPerCycle'
  | 'whatsappCreditPerCycle';

// The usage *ledger*'s own event-type codes (models/UsageEvent.js's
// usageType enum on the backend) — a DIFFERENT, smaller vocabulary from
// UsageType above (which names the 6 entitlement/limit dimensions, used for
// summary.usage rows and add-on types). A ledger row's usageType is always
// one of these 6 values, never one of the UsageType codes.
export type LedgerUsageType = 'ai_prompt' | 'whatsapp_message' | 'customer_profile' | 'user' | 'location' | 'whatsapp_account';

export type UsageKind = 'durable' | 'cycle' | 'cycle_currency';
export type UsageWarningLevel = 'warn75' | 'warn90' | 'exceeded' | null;
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';
export type AddOnStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled' | 'failed';

export interface EntitlementsPlan {
  code: string;
  name: string;
  isCustom: boolean;
}

export interface EntitlementsSubscription {
  status: SubscriptionStatus;
  billingProvider: string;
  overageBillingEnabled: boolean;
  cycleAnchorDate: string;
}

export interface EntitlementsBillingPeriod {
  start: string;
  end: string;
  daysRemaining: number;
}

export interface UsageRow {
  type: UsageType;
  label: string;
  kind: UsageKind;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  warningLevel: UsageWarningLevel;
  currency: string | null;
}

export interface EntitlementsAddOn {
  _id: string;
  type: UsageType;
  quantity: number;
  status: AddOnStatus;
  activatedAt: string | null;
  expiresAt: string | null;
}

export interface EntitlementsSummary {
  plan: EntitlementsPlan;
  subscription: EntitlementsSubscription;
  billingPeriod: EntitlementsBillingPeriod;
  currency: string;
  usage: UsageRow[];
  addOns: EntitlementsAddOn[];
}

export interface UsageEvent {
  _id: string;
  usageType: LedgerUsageType;
  quantity: number;
  providerCost: number | null;
  customerCharge: number | null;
  currency: string | null;
  createdAt: string;
  metadata?: any;
}

export interface UsageEventsResponse {
  events: UsageEvent[];
  total: number;
  page: number;
  pages: number;
}

// Friendly labels for the 6 usage-type codes — shared by the Usage & Limits
// page (usage bars, add-ons list, usage-history filter/table).
export const USAGE_TYPE_LABELS: Record<UsageType, string> = {
  locations: 'Locations',
  whatsappAccounts: 'WhatsApp Business Accounts',
  users: 'Platform Users',
  customerProfiles: 'Customer Profiles',
  aiPromptsPerCycle: 'AI Mode Prompts',
  whatsappCreditPerCycle: 'WhatsApp Messaging Credit',
};

// Friendly labels for the ledger's own event-type codes — used by the usage
// history table/filter (GET /usage-events?type=), never for summary.usage
// rows or add-on types (those use USAGE_TYPE_LABELS above).
export const LEDGER_USAGE_TYPE_LABELS: Record<LedgerUsageType, string> = {
  ai_prompt: 'AI Prompt',
  whatsapp_message: 'WhatsApp Message',
  customer_profile: 'Customer Profile Added',
  user: 'User Added',
  location: 'Location Added',
  whatsapp_account: 'WhatsApp Account Added',
};

// Dedicated client for the Entitlements & Billing feature — kept separate
// from ApiService so it stays entirely in its own set of files, same as
// InboxApiService does for the Inbox feature.
@Injectable({ providedIn: 'root' })
export class EntitlementsApiService {
  constructor(private http: HttpClient) {}

  getSummary(): Observable<EntitlementsSummary> {
    return this.http.get<EntitlementsSummary>(`${API}/summary`);
  }

  getUsageEvents(params: { type?: LedgerUsageType; page?: number; limit?: number } = {}): Observable<UsageEventsResponse> {
    const query: any = {};
    if (params.type) query.type = params.type;
    if (params.page) query.page = params.page;
    if (params.limit) query.limit = params.limit;
    return this.http.get<UsageEventsResponse>(`${API}/usage-events`, { params: query });
  }
}
