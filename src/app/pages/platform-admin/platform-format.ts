import { Tenant, WhatsAppStatus } from '../../shared/platform-api.service';

// Small shared display helpers for the platform pages.

export function whatsappLabel(w: WhatsAppStatus | null | undefined): string {
  if (!w || w.mode !== 'own') return 'Platform number';
  if (w.displayPhoneNumber) return `${w.displayPhoneNumber} (own)`;
  return w.phoneIdLast4 ? `Own number ending ${w.phoneIdLast4}` : 'Own number';
}

// The shared WaFlow number, named the same way on the list banner and in the customer card:
// "+1 555-643-3808 (Test Number)", with whichever parts Meta gave.
export function platformNumberLabel(n: { displayPhoneNumber: string | null; verifiedName: string | null; phoneIdLast4: string }): string {
  const shown = n.displayPhoneNumber || `Phone number id ending ${n.phoneIdLast4}`;
  return n.verifiedName ? `${shown} (${n.verifiedName})` : shown;
}

export function ownerLabel(t: Pick<Tenant, 'owners'>): string {
  const first = t.owners?.[0];
  if (!first) return 'No owner yet';
  const extra = t.owners.length - 1;
  return `${first.name || 'Owner'} (${first.contactMasked})${extra > 0 ? ` +${extra}` : ''}`;
}

export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    create_tenant: 'Created the customer',
    enter: 'Entered the customer',
    exit: 'Went back to the platform',
    rename: 'Renamed the customer',
    add_member: 'Added a person',
    set_whatsapp: 'Saved the WhatsApp number',
    clear_whatsapp: 'Switched back to the platform number',
    verify_whatsapp: 'Tested the WhatsApp connection',
    act_as_write: 'Made a change inside the customer',
  };
  return map[action] || action;
}

// Phone: digits only (Arabic-Indic digits converted), 8 to 15 digits. Email: one @ and a dot in the domain.
export function normalisePhoneDigits(x: string): string {
  return (x || '')
    .replace(/[\u{0660}-\u{0669}]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u{06F0}-\u{06F9}]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

export function validOwnerContact(type: 'phone' | 'email', value: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const digits = normalisePhoneDigits(v);
  return digits.length >= 8 && digits.length <= 15;
}
