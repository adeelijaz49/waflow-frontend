// Shapes returned by the EXISTING inbox endpoints (InboxApiService returns `any`);
// typed here once so the Arabic inbox components don't use `any`.
export type InboxFilterKey = 'all' | 'unread' | 'high-value' | 'inactive' | 'recent' | 'booking';

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string;
  mediaUrl?: string;
  status?: string;
  timestamp: string;
}

export interface ThreadResponse {
  customer: { _id: string; name: string; phone: string; optedOut: boolean; conversationStatus?: string };
  messages: ThreadMessage[];
}

export interface SnapshotResponse {
  customer: {
    _id: string; name: string; phone: string; optedOut: boolean; optedOutAt?: string | null;
    marketingConsent: boolean; marketingConsentAt?: string | null; loyaltyPoints: number; createdAt: string;
  };
  totalOrders: number;
  totalSpent: number;
  lastOrder: { _id: string; total: number; status: string; paymentStatus: string; createdAt: string } | null;
  lastCampaign: { kind: string; promotionName?: string | null; status?: string; sentAt?: string } | null;
  productsPurchased: Array<{ name: string; quantity: number; orders?: number }>;
  servicesBooked: Array<{ name: string; status: string; date?: string | null; startTime?: string | null }>;
  tags: string[];
  prompts: string[];
}

export interface LoyaltyFallbackResult {
  skippedOptedOut?: boolean;
  skippedNoConsent?: boolean;
}
