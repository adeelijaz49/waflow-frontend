import { I18nService } from '../../../i18n';
import type { AiModePendingAction } from '../localization.types';

export const MAX_MESSAGE_LENGTH = 2000;
export const COUNTER_FROM = 1800;
export const SESSION_KEY = 'waflow_ai_mode_ar_session_id';

// The five tools that change something outside the chat (the server's confirm gate).
export const ACTION_TOOLS = [
  'send_promotion', 'send_test_message', 'send_loyalty_reminders', 'activate_flow', 'refund_order',
] as const;
export const DANGER_TOOLS: readonly string[] = ['refund_order'];

// Prompt catalogue keys (aimode.prompt.*) for the strip and the three groups.
export const STRIP_PROMPTS = ['returned', 'topPoints', 'bestPromo', 'inactive', 'loyaltyReminder'] as const;
export const PROMPT_GROUPS: ReadonlyArray<{ title: string; icon: string; prompts: readonly string[] }> = [
  { title: 'group.customers', icon: '👥', prompts: ['returned', 'topPoints', 'inactive'] },
  { title: 'group.campaigns', icon: '📈', prompts: ['bestPromo', 'campaignRevenue', 'clickedNoBuy'] },
  { title: 'group.revenue', icon: '💰', prompts: ['loyaltyReminder', 'comeback', 'weekendPromo'] },
];
export const OWN_WORDS_KEYS = ['own.1', 'own.2', 'own.3'] as const;

export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function readStoredSession(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
  } catch { /* storage unavailable */ }
  return storeSession(newSessionId());
}

export function storeSession(id: string): string {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch { /* the conversation simply won't survive a reload */ }
  return id;
}

// "+966501234567" -> "+966•••••567": enough to recognise, not enough to leak.
export function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length <= 7) return p;
  return `${p.slice(0, 4)}${'•'.repeat(Math.max(3, p.length - 7))}${p.slice(-3)}`;
}

// Long ids (24-hex ObjectIds) are shortened to their last six characters.
export function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

export interface DetailRow { label: string; value: string; ltr: boolean }

const ID_LABELS: Record<string, string> = {
  promotionId: 'arg.promotionId',
  flowId: 'arg.flowId',
  orderId: 'arg.orderId',
};

// Human-readable key arguments of a pending action (the summary text itself is
// the server's deterministic sentence; this list is the "Details" disclosure).
export function detailRows(i18n: I18nService, action: AiModePendingAction): DetailRow[] {
  const rows: DetailRow[] = [];
  const args = action.args ?? {};
  const toolKey = `tool.${action.toolName}`;
  rows.push({
    label: i18n.t('aimode.arg.action'),
    value: i18n.has(`aimode.${toolKey}`) ? i18n.t(`aimode.${toolKey}`) : i18n.t('aimode.tool.unknown'),
    ltr: false,
  });
  for (const [key, raw] of Object.entries(args)) {
    if (key in ID_LABELS && typeof raw === 'string') {
      rows.push({ label: i18n.t(`aimode.${ID_LABELS[key]}`), value: shortId(raw), ltr: true });
    } else if (key === 'customerIds' && Array.isArray(raw)) {
      rows.push({ label: i18n.t('aimode.arg.recipients'), value: i18n.tp('aimode.arg.recipientCount', raw.length), ltr: false });
    } else if (key === 'phone' && typeof raw === 'string') {
      rows.push({ label: i18n.t('aimode.arg.phone'), value: maskPhone(raw), ltr: true });
    } else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      rows.push({ label: key, value: String(raw), ltr: true });
    }
  }
  if (action.toolName === 'send_loyalty_reminders' && !('customerIds' in args)) {
    rows.push({ label: i18n.t('aimode.arg.recipients'), value: i18n.t('aimode.arg.allWithPoints'), ltr: false });
  }
  return rows;
}
