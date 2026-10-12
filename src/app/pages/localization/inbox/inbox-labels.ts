import { Injectable, inject } from '@angular/core';
import { I18nService, LocaleFormatService } from '../../../i18n';

// Display-time localisation of everything the existing inbox backend stores or
// computes in ENGLISH (audit R6 §1.4 / §1.7). It is a closed set, so each value
// is mapped by exact match or a documented pattern and anything unrecognised
// falls back to the raw text — never to a raw database value where a key exists.

export interface StatusView {
  kind: 'none' | 'tick' | 'label';
  icon: string;
  label: string;
  read: boolean;
  failed: boolean;
}

const NONE: StatusView = { kind: 'none', icon: '', label: '', read: false, failed: false };

const TAG_KEYS: Record<string, string> = {
  'High-value': 'high_value',
  Inactive: 'inactive',
  'Loyalty member': 'loyalty_member',
  'Recent buyer': 'recent_buyer',
  'Booking customer': 'booking_customer',
};
const TAG_CLASS: Record<string, string> = {
  'High-value': 'badge-warning',
  Inactive: 'badge-neutral',
  'Loyalty member': 'badge-info',
  'Recent buyer': 'badge-success',
  'Booking customer': 'badge-primary',
};

// English text (after the leading emoji) -> catalogue key.
const EXACT: Record<string, string> = {
  'Promotion sent': 'line.promotionSent',
  'Loyalty reminder sent': 'line.loyaltySent',
  'Booking update sent': 'line.bookingUpdateSent',
  'Automated message sent': 'line.flowSent',
  'Consent request sent': 'line.consentSent',
  'Campaign message sent': 'line.campaignSent',
  Promotion: 'line.promotion',
  'Loyalty reminder': 'line.loyaltyReminder',
  'Booking update': 'line.bookingUpdate',
  'Automated message': 'line.flow',
  'Consent request': 'line.consent',
  'Campaign message': 'line.campaign',
  Photo: 'line.photo',
  Video: 'line.video',
  Document: 'line.document',
  'Voice message': 'line.voice',
  Sticker: 'line.sticker',
  'Location shared': 'line.location',
};
const NAMED_LABEL: Record<string, string> = {
  Promotion: 'line.promotion',
  'Loyalty reminder': 'line.loyaltyReminder',
  'Booking update': 'line.bookingUpdate',
  'Automated message': 'line.flow',
  'Consent request': 'line.consent',
  'Campaign message': 'line.campaign',
};

const DOMAINS: Record<string, string[]> = {
  order: ['order', 'delivery'],
  payment: ['payment', 'delivery'],
  booking: ['booking', 'delivery'],
};
const TICKS: Record<string, string> = { read: '✓✓', delivered: '✓✓', sent: '✓', failed: '⚠', queued: '○' };

const NO_VS16 = /\u{FE0F}/gu;
const PICTO = /^\p{Extended_Pictographic}+\s*/u;
const ORDER = /^Order (placed|confirmed) — (\d+) item\(s\)(?: · (.+))?$/u;
const PAYMENT = /^Payment (\S+) — (.+)$/u;
const BOOKING_WHEN = /^Booking (\S+) — (.+?) on (\S+) at (\S+)$/u;
const BOOKING = /^Booking (\S+) — (.+)$/u;
const BOOKING_PLAIN = /^Booking (\S+)$/u;
const NAMED = /^(Promotion|Loyalty reminder|Booking update|Automated message|Consent request|Campaign message) — (.+)$/u;
const NO_ORDER = /^This customer has not ordered in (\d+) days?\.$/u;
const POINTS = /^This customer has (\d+) unused loyalty points?\.$/u;
const MONEY = /^(\d[\d,]*\.\d{2}) ([A-Z]{3})$/u;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const REPLY_ARROW = 0x21a9;

// 'no-show' (booking) and 'no_show' (catalogue) are the same status.
export function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}

// Western digits, Arabic-Indic digits (U+0660-0669), Persian digits (U+06F0-06F9) and Arabic
// decimal/thousands separators -> a plain number. Returns null when it isn't a positive amount.
export function parseAmount(text: string): number | null {
  const ascii = text
    .replace(/[\u{0660}-\u{0669}]/gu, (c) => String((c.codePointAt(0) ?? 0x660) - 0x660))
    .replace(/[\u{06F0}-\u{06F9}]/gu, (c) => String((c.codePointAt(0) ?? 0x6f0) - 0x6f0))
    .replace(/[\u{066B}\u{060C}]/gu, '.')
    .replace(/[\u{066C},\s]/gu, '');
  if (!/^\d+(\.\d{1,2})?$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Injectable({ providedIn: 'root' })
export class InboxLabels {
  private readonly i18n = inject(I18nService);
  private readonly fmt = inject(LocaleFormatService);

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(`inbox.${key}`, params);
  }

  tag(tag: string): string {
    const key = TAG_KEYS[tag];
    return key ? this.t(`tag.${key}`) : tag;
  }

  tagClass(tag: string): string {
    return TAG_CLASS[tag] ?? 'badge-neutral';
  }

  messageType(type: string | null | undefined): string {
    if (!type || type === 'manual') return '';
    const key = `inbox.type.${type}`;
    return this.i18n.has(key) ? this.i18n.t(key) : type;
  }

  campaignKind(kind: string, promotionName?: string | null): string {
    if (promotionName) return promotionName;
    const key = `inbox.campaign.kind.${kind}`;
    return this.i18n.has(key) ? this.i18n.t(key) : kind.replace(/_/g, ' ');
  }

  // A status word for one domain (order | payment | booking | delivery); raw text when unknown.
  statusText(domain: string, status: string): string {
    const key = `status.${domain}.${normalizeStatus(status)}`;
    return this.i18n.has(key) ? this.i18n.t(key) : status;
  }

  // Keyed by (messageType, status): "delivered" means a delivery tick for a WhatsApp
  // message but an order state for an order row, and "cancelled" is never a tick.
  status(messageType: string | null | undefined, status: string | null | undefined): StatusView {
    if (!status) return NONE;
    const n = normalizeStatus(status);
    for (const domain of DOMAINS[messageType ?? ''] ?? ['delivery']) {
      const key = `status.${domain}.${n}`;
      if (!this.i18n.has(key)) continue;
      const label = this.i18n.t(key);
      const failed = n === 'failed';
      if (domain === 'delivery') return { kind: 'tick', icon: TICKS[n] ?? '', label, read: n === 'read', failed };
      return { kind: 'label', icon: '', label, read: false, failed };
    }
    return { kind: 'label', icon: '', label: status, read: false, failed: false };
  }

  // Backend-built English one-liners (list previews, thread system rows, inbound placeholders).
  line(raw: string | null | undefined): string {
    if (!raw) return '';
    const s = raw.replace(NO_VS16, '');
    if (s === '[Button tap]') return this.t('line.buttonTap');
    if (s === '[Interactive reply]') return this.t('line.interactive');
    const prefix = PICTO.exec(s);
    if (!prefix) return raw;
    const core = s.slice(prefix[0].length);

    if (raw.codePointAt(0) === REPLY_ARROW) {
      const text = core === 'Button tap' ? this.t('line.buttonTap') : core === 'Selection' ? this.t('line.selection') : core;
      return `${String.fromCodePoint(REPLY_ARROW, 0xfe0f)} ${text}`;
    }
    const exact = EXACT[core];
    if (exact) return this.t(exact);

    const named = NAMED.exec(core);
    if (named) return this.t('line.withName', { label: this.t(NAMED_LABEL[named[1]]), name: named[2] });

    const order = ORDER.exec(core);
    if (order) {
      const items = this.i18n.tp('inbox.line.items', Number(order[2]));
      const state = this.t(`line.orderState.${order[1]}`);
      return order[3] ? this.t('line.orderMoney', { state, items, money: this.money(order[3]) }) : this.t('line.order', { state, items });
    }
    const payment = PAYMENT.exec(core);
    if (payment) return this.t('line.payment', { status: this.statusText('payment', payment[1]), money: this.money(payment[2]) });

    const when = BOOKING_WHEN.exec(core);
    if (when) {
      return this.t('line.bookingWhen', {
        status: this.statusText('booking', when[1]), service: this.service(when[2]), date: this.day(when[3]), time: when[4],
      });
    }
    const booking = BOOKING.exec(core);
    if (booking) return this.t('line.booking', { status: this.statusText('booking', booking[1]), service: this.service(booking[2]) });
    const plain = BOOKING_PLAIN.exec(core);
    if (plain) return this.t('line.bookingStatus', { status: this.statusText('booking', plain[1]) });
    return raw;
  }

  // The four closed-set "suggested next step" sentences from the snapshot.
  prompt(raw: string): string {
    const days = NO_ORDER.exec(raw);
    if (days) return this.i18n.tp('inbox.prompt.noOrder', Number(days[1]));
    const points = POINTS.exec(raw);
    if (points) return this.i18n.tp('inbox.prompt.points', Number(points[1]));
    if (raw === 'This customer responded to the last campaign.') return this.t('prompt.responded');
    if (raw === 'This customer is high-value.') return this.t('prompt.highValue');
    return raw;
  }

  private service(name: string): string {
    return name === 'Service' ? this.t('line.serviceFallback') : name;
  }

  private money(token: string): string {
    const m = MONEY.exec(token);
    return m ? this.fmt.currency(Number(m[1].replace(/,/g, '')), m[2]) : token;
  }

  private day(token: string): string {
    const m = ISO_DAY.exec(token);
    return m ? this.fmt.date(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : token;
  }
}
