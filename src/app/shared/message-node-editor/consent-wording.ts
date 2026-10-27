import type { MessageNodeAction, MessageNodeDraft } from './message-node-editor';

// Everything the merchant sees when writing a "Consent request" (a promotion whose only job is to ask
// customers for permission to send them offers on WhatsApp): the owner's suggested wording, the label
// pairs, the writing guidance and the deterministic checks behind the wording guard. Pure functions and
// constants, no Angular, so the rules can be tested on their own.

// WhatsApp limits: a template quick-reply label (the entry step) is 25 characters, an interactive reply
// button (every follow-up step) is 20. Mirrors shared/operations.js on the backend.
export const ENTRY_LABEL_LIMIT = 25;
export const FOLLOW_UP_LABEL_LIMIT = 20;
export const MAX_BODY_CHARS = 1024; // Meta's template body limit
export const ADVISED_MAX_WORDS = 50;

export const labelLimitFor = (depth: number): number => (depth <= 0 ? ENTRY_LABEL_LIMIT : FOLLOW_UP_LABEL_LIMIT);

export const CONSENT_ACTIONS: MessageNodeAction[] = ['opt_in', 'opt_out', 'interested'];
export const isConsentAction = (a: string | undefined | null): boolean => a === 'opt_in' || a === 'opt_out' || a === 'interested';

export const ACTION_NAMES: Record<string, string> = {
  opt_in: 'Opt in', opt_out: 'Opt out', interested: 'Interested', end_flow: 'None',
};
export const actionName = (a: string | undefined | null): string => (a ? ACTION_NAMES[a] ?? '' : '');

// What the customer is sent when no confirmation text is written (the backend's standard replies), shown as the hint. Described in
// words, not shown as a sentence with blanks to fill: the server sends a text the merchant writes exactly as written, so anything
// that looks like a placeholder would reach the customer as it stands.
export const DEFAULT_CONFIRMATIONS: Record<string, string> = {
  opt_in: "Leave blank to send our standard thank-you: it greets the customer by first name, names your business, says they will now get offers here on WhatsApp and how to opt out. Or write your own.",
  opt_out: "Leave blank to send our standard reply: it greets the customer by first name, says we won't send any more offers and how to opt back in. Or write your own.",
  interested: 'Leave blank to send nothing extra, or write a short thank-you.',
};

export interface ConsentBodySuggestion { key: string; title: string; body: string }

// The owner's own wording. {{1}} is the customer's first name (slot 1 of the promotion variables). Square
// brackets are the parts the merchant must replace - the guard refuses to save while any are left.
export const CONSENT_BODY_SUGGESTIONS: ConsentBodySuggestion[] = [
  {
    key: 'benefit_first', title: 'Benefit first (recommended)',
    body: "Hi {{1}}, it's [Business name]. This [occasion], [offer in one line]. Want first access to offers like this on WhatsApp? Tap below. We'll only message you with offers we think you'll like, and you can stop any time.",
  },
  {
    key: 'exclusive_access', title: 'Exclusive access',
    body: "Hi {{1}}, [Business name] here. We're opening [offer in one line] to customers on our WhatsApp offers list first. Tap \"Yes, include me\" to join and claim it. Tap \"No thanks\" and we won't message you again. Reply STOP any time to leave the list.",
  },
  {
    key: 'short_simple', title: 'Short and simple',
    body: "Hi {{1}}, [Business name] has [offer in one line]. Tap \"Yes, I'm in\" to get it, and to hear about future offers here on WhatsApp. Reply STOP any time to opt out.",
  },
];

export interface ConsentLabelPair { key: string; yes: string; no: string; text: string }

const pair = (key: string, yes: string, no: string): ConsentLabelPair => ({ key, yes, no, text: `"${yes}" / "${no}"` });
// First pair is the one-click "Opt-in request" preset.
export const CONSENT_LABEL_PAIRS: ConsentLabelPair[] = [
  pair('send_offers', 'Yes, send me offers', 'No thanks'),
  pair('im_in', "Yes, I'm in", 'No thanks'),
  pair('include_me', 'Yes, include me', 'No thanks'),
  pair('opt_in_out', 'OPT IN', 'OPT OUT'),
];
export const OPT_IN_PRESET = CONSENT_LABEL_PAIRS[0];

export const CONSENT_WRITING_GUIDANCE: string[] = [
  'Lead with the benefit to the customer.',
  'Say plainly that this is offers on WhatsApp from your business.',
  'Keep it under about 50 words.',
  'Make the yes button positive and the no button polite.',
  'Only promise what you will actually do (for example how often you will message).',
  'Never use pressure, false urgency or misleading claims - Meta can flag these.',
];

export interface ConsentWordingIssue { level: 'error' | 'warning'; code: string; message: string }

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// Deterministic checks of the wording. Errors stop the message being saved (it would be wrong, or Meta/the
// server would refuse it); warnings are advice. Neither replaces the merchant's own acknowledgement.
export function checkConsentWording(draft: MessageNodeDraft | null | undefined): ConsentWordingIssue[] {
  const issues: ConsentWordingIssue[] = [];
  const body = (draft?.bodyText ?? '').trim();
  const buttons = draft?.buttons ?? [];
  const add = (level: ConsentWordingIssue['level'], code: string, message: string) => issues.push({ level, code, message });

  if (!body) {
    add('error', 'empty_body', 'Write the message customers will see.');
  } else {
    const placeholders = body.match(/\[[^\]\n]{1,80}\]/g);
    if (placeholders) add('error', 'placeholder', `Replace ${placeholders.join(', ')} with your own words before saving.`);
    if (body.length > MAX_BODY_CHARS) add('error', 'too_long', `The message is ${body.length} characters; WhatsApp allows ${MAX_BODY_CHARS}.`);
    if (/^\{\{\d+\}\}/.test(body)) add('error', 'starts_with_variable', 'WhatsApp does not accept a message that starts with a variable. Begin with a word, for example "Hi {{1}},".');
    if (/\{\{\d+\}\}$/.test(body)) add('error', 'ends_with_variable', 'WhatsApp does not accept a message that ends with a variable. Finish with a word or a full stop.');

    if (!(/\b(offers?|deals?|promotions?|promos?|discounts?|news|updates?)\b/i.test(body) && /whatsapp/i.test(body))) {
      add('warning', 'agreement', 'Say plainly what the customer is agreeing to: offers from your business on WhatsApp.');
    }
    if (!(/\b(stop|opt[ -]?out|unsubscribe|leave|cancel)\b/i.test(body) && /\b(any ?time|whenever|at any point)\b/i.test(body))) {
      add('warning', 'stop_any_time', 'Tell customers they can stop any time, for example "Reply STOP any time to opt out."');
    }
    if (wordCount(body) > ADVISED_MAX_WORDS) add('warning', 'long', `The message is ${wordCount(body)} words. Under about ${ADVISED_MAX_WORDS} is easier to read and approve.`);
    if (/\b(hurry|last chance|act now|don'?t miss out|urgent|final warning|only today|ends tonight|limited time|expires?)\b/i.test(body)) {
      add('warning', 'pressure', "Avoid pressure or false urgency. Meta can flag it and it weakens the customer's consent.");
    }
    // Tap "Yes, include me" must match a real button, or the customer is told to tap something that is not there.
    const labels = buttons.map((b) => (b.label ?? '').trim().toLowerCase());
    for (const m of body.matchAll(/\btap\s+["\u{201C}]([^"\u{201D}]{1,40})["\u{201D}]/giu)) {
      if (!labels.includes(m[1].trim().toLowerCase())) add('warning', 'label_mismatch', `The message tells customers to tap "${m[1]}" but no button has that label.`);
    }
  }

  if (!buttons.some((b) => b.nextAction === 'opt_in')) {
    add('error', 'no_opt_in_button', 'Add a button that opts the customer in (set "When tapped" to Opt in). A consent request cannot be sent without one.');
  }
  if (!buttons.some((b) => b.nextAction === 'opt_out')) {
    add('warning', 'no_opt_out_button', 'Add a polite "No thanks" button (set "When tapped" to Opt out) so saying no is as easy as saying yes.');
  }
  if (buttons.some((b) => !(b.label ?? '').trim())) add('error', 'empty_label', 'Every button needs a label.');
  if (buttons.some((b) => (b.label ?? '').length > ENTRY_LABEL_LIMIT)) add('error', 'label_too_long', `Button labels can be at most ${ENTRY_LABEL_LIMIT} characters.`);
  const seen = new Set<string>();
  for (const b of buttons) {
    const k = (b.label ?? '').trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) { add('error', 'duplicate_label', `Two buttons are both called "${b.label}". Give each button its own label.`); break; }
    seen.add(k);
  }
  return issues;
}

// What the customer would be shown: changing any of it after the merchant ticked the acknowledgement
// invalidates the tick (the acknowledgement is of THIS wording).
// A "Send a message" button's follow-up is shown after the tap, so it is part of the wording too, at any depth. It is added to a
// button's entry only when there is one: a message without follow-ups keeps exactly the fingerprint it always had.
function wordingOf(draft: MessageNodeDraft | null | undefined): unknown[] {
  return [
    (draft?.bodyText ?? '').trim(),
    (draft?.buttons ?? []).map((b) => {
      const row: unknown[] = [b.label ?? '', b.nextAction, isConsentAction(b.nextAction) ? (b.replyText ?? '').trim() : ''];
      if (b.nextAction === 'send_message' && b.followUp) row.push(wordingOf(b.followUp));
      return row;
    }),
  ];
}

export function consentWordingSignature(draft: MessageNodeDraft | null | undefined): string {
  return JSON.stringify(wordingOf(draft));
}

// A short, stable fingerprint of that wording (cyrb53, 53 bits, 14 hex digits). It is what the server keeps with the
// acknowledgement (Promotion.consentWordingAck.textHash), so a later change of wording is told apart from the one acknowledged.
export function consentWordingHash(draft: MessageNodeDraft | null | undefined): string {
  const text = consentWordingSignature(draft);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
