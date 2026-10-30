import { sendErrorHelp, sendErrorHelps } from './send-error-help';

describe('sendErrorHelp: plain words for Meta\'s immediate refusals', () => {
  it('words every known code', () => {
    expect(sendErrorHelp('(#133010) Account not registered')).toBe(
      "WhatsApp refused this because the sending WhatsApp number is not registered with the WhatsApp Business Platform (error 133010). Nothing is wrong with your customer or your message. Ask the WaFlow team to check the number's status in Meta.");
    expect(sendErrorHelp('(#131030) Recipient phone number not in allowed list')).toBe(
      "WhatsApp only lets the test number message people on its allowed-recipient list, and the recipient's phone number is not on it yet. Add it in Meta (WhatsApp > API Setup), or ask the WaFlow team to.");
    expect(sendErrorHelp('(#131042) Business eligibility payment issue')).toBe(
      'WhatsApp could not charge for this message: the payment method on the WhatsApp Business Account needs attention. Ask the WaFlow team.');
    expect(sendErrorHelp('(#131031) Account has been locked')).toBe(
      'WhatsApp has locked or restricted the WhatsApp Business Account this number belongs to. Ask the WaFlow team to check it in Meta.');
    expect(sendErrorHelp('(#131037) WhatsApp provided number needs display name approval')).toBe(
      'The display name of the sending number has not been approved by WhatsApp yet. Ask the WaFlow team to check it in Meta.');
  });

  const TOKEN = 'WhatsApp does not accept the access token of the sending number any more (it has probably expired). Ask the WaFlow team to reconnect it.';

  it('recognises an expired token by its phrase (no code in front) or by (#190)', () => {
    expect(sendErrorHelp('Error validating access token: Session has expired on Friday')).toBe(TOKEN);
    expect(sendErrorHelp('error VALIDATING ACCESS TOKEN: x')).toBe(TOKEN);
    expect(sendErrorHelp('(#190) Something about the token')).toBe(TOKEN);
  });

  it('finds the code anywhere in the message', () => {
    expect(sendErrorHelp('Request failed: (#131030) not allowed')).toContain('allowed-recipient list');
  });

  it('says nothing for a code that only sits inside a longer number', () => {
    expect(sendErrorHelp('(#1330100) Something else')).toBeNull();
    expect(sendErrorHelp('(#1311030) Something else')).toBeNull();
    expect(sendErrorHelp('133010 without the brackets')).toBeNull();
  });

  it('says nothing for an unknown code, an empty string or anything that is not a string', () => {
    expect(sendErrorHelp('(#131047) Re-engagement message')).toBeNull();
    expect(sendErrorHelp('')).toBeNull();
    expect(sendErrorHelp(undefined)).toBeNull();
    expect(sendErrorHelp(null)).toBeNull();
    expect(sendErrorHelp(133010)).toBeNull();
    expect(sendErrorHelp({ message: '(#133010) x' })).toBeNull();
  });
});

describe('sendErrorHelps: the distinct sentences for a list of failures', () => {
  it('gives each sentence once, in order of first appearance', () => {
    const helps = sendErrorHelps([
      { error: '(#131030) a' },
      { error: '(#133010) b' },
      { error: '(#131030) c' },
      { error: '(#133010) d' },
      { error: '(#131042) e' },
    ]);
    expect(helps).toEqual([sendErrorHelp('(#131030)'), sendErrorHelp('(#133010)'), sendErrorHelp('(#131042)')]);
    expect(helps).toHaveLength(3);
  });

  it('skips errors with no help and copes with missing input', () => {
    expect(sendErrorHelps([{ error: 'boom' }, {}, { error: 5 }])).toEqual([]);
    expect(sendErrorHelps([{ error: 'boom' }, { error: '(#131037) x' }])).toEqual([sendErrorHelp('(#131037)')]);
    expect(sendErrorHelps(null)).toEqual([]);
    expect(sendErrorHelps(undefined)).toEqual([]);
    expect(sendErrorHelps([])).toEqual([]);
  });

  it('treats the token phrase and (#190) as the same sentence', () => {
    expect(sendErrorHelps([{ error: 'Error validating access token: x' }, { error: '(#190) y' }])).toHaveLength(1);
  });
});
