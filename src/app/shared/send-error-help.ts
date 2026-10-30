// Plain-English help for the words Meta uses when it refuses a message straight away (the "failed to send" list after pressing
// send on Promotions). The wording of 133010 mirrors LABELS in waflow-backend/shared/promoDelivery.js, which words the same codes
// for messages WhatsApp accepted and refused later; this is the matching help for the immediate refusals, kept in the frontend
// because the send answer carries Meta's raw message only.
const HELP: Record<string, string> = {
  '133010': "WhatsApp refused this because the sending WhatsApp number is not registered with the WhatsApp Business Platform (error 133010). Nothing is wrong with your customer or your message. Ask the WaFlow team to check the number's status in Meta.",
  '131030': "WhatsApp only lets the test number message people on its allowed-recipient list, and the recipient's phone number is not on it yet. Add it in Meta (WhatsApp > API Setup), or ask the WaFlow team to.",
  '131042': 'WhatsApp could not charge for this message: the payment method on the WhatsApp Business Account needs attention. Ask the WaFlow team.',
  '131031': 'WhatsApp has locked or restricted the WhatsApp Business Account this number belongs to. Ask the WaFlow team to check it in Meta.',
  '131037': 'The display name of the sending number has not been approved by WhatsApp yet. Ask the WaFlow team to check it in Meta.',
  '190': 'WhatsApp does not accept the access token of the sending number any more (it has probably expired). Ask the WaFlow team to reconnect it.',
};

// Meta writes the code as "(#133010) ..." - 3 to 6 digits, and not when it is only the tail of a longer number.
const CODE = /\(#(\d{3,6})\)/;

export function sendErrorHelp(message: unknown): string | null {
  if (typeof message !== 'string' || !message) return null;
  // An expired token is worded "Error validating access token: ..." with no (#code) in front of it.
  if (/Error validating access token/i.test(message)) return HELP['190'];
  const code = CODE.exec(message)?.[1];
  return code && Object.prototype.hasOwnProperty.call(HELP, code) ? HELP[code] : null;
}

// The distinct help sentences for a list of failed sends, in order of first appearance.
export function sendErrorHelps(errors: ReadonlyArray<{ error?: unknown }> | null | undefined): string[] {
  const out: string[] = [];
  for (const e of errors || []) {
    const help = sendErrorHelp(e?.error);
    if (help && !out.includes(help)) out.push(help);
  }
  return out;
}
