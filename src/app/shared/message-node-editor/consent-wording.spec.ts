import type { MessageNodeDraft } from './message-node-editor';
import {
  CONSENT_BODY_SUGGESTIONS, CONSENT_LABEL_PAIRS, CONSENT_WRITING_GUIDANCE, DEFAULT_CONFIRMATIONS, ENTRY_LABEL_LIMIT, FOLLOW_UP_LABEL_LIMIT, OPT_IN_PRESET,
  checkConsentWording, consentWordingHash, consentWordingSignature, labelLimitFor,
} from './consent-wording';

// The owner's wording, the label pairs and the deterministic checks behind the consent-wording guard.

const GOOD: MessageNodeDraft = {
  bodyText: "Hi {{1}}, it's Acme. This Eid, enjoy 10% off. Want first access to offers like this on WhatsApp? Tap below. We'll only message you with offers we think you'll like, and you can stop any time.",
  buttons: [{ position: 0, label: 'Yes, send me offers', nextAction: 'opt_in' }, { position: 1, label: 'No thanks', nextAction: 'opt_out' }],
};
const codes = (d: MessageNodeDraft) => checkConsentWording(d).map((i) => i.code);
const withBody = (bodyText: string, buttons = GOOD.buttons): MessageNodeDraft => ({ bodyText, buttons });

describe('consent wording', () => {
  describe('the owner\'s material', () => {
    it('has the three suggested bodies, each starting with a greeting and ending with text (never a variable)', () => {
      expect(CONSENT_BODY_SUGGESTIONS.map((s) => s.key)).toEqual(['benefit_first', 'exclusive_access', 'short_simple']);
      expect(CONSENT_BODY_SUGGESTIONS[0].title).toContain('Benefit first');
      for (const s of CONSENT_BODY_SUGGESTIONS) {
        expect(s.body.startsWith('Hi {{1}}, ')).toBe(true);
        expect(/\{\{\d+\}\}\s*$/.test(s.body)).toBe(false);
        expect(/^\{\{/.test(s.body)).toBe(false);
        expect(s.body.length).toBeLessThan(1024);
      }
      expect(CONSENT_BODY_SUGGESTIONS[1].body).toContain('Tap "Yes, include me" to join and claim it.');
      expect(CONSENT_BODY_SUGGESTIONS[2].body).toContain("Tap \"Yes, I'm in\" to get it");
    });

    it('the suggested bodies pass every check once the [brackets] are replaced and the matching labels are used', () => {
      const fill = (b: string) => b.replace('[Business name]', 'Acme').replace('[offer in one line]', '10% off all hats').replace('[occasion]', 'Eid');
      const labels: Record<string, [string, string]> = { benefit_first: ['Yes, send me offers', 'No thanks'], exclusive_access: ['Yes, include me', 'No thanks'], short_simple: ["Yes, I'm in", 'No thanks'] };
      for (const s of CONSENT_BODY_SUGGESTIONS) {
        const [yes, no] = labels[s.key];
        const issues = checkConsentWording({ bodyText: fill(s.body), buttons: [{ position: 0, label: yes, nextAction: 'opt_in' }, { position: 1, label: no, nextAction: 'opt_out' }] });
        expect(issues, s.key).toEqual([]);
      }
    });

    it('offers the four label pairs, the first being the one-click preset', () => {
      expect(CONSENT_LABEL_PAIRS.map((p) => [p.yes, p.no])).toEqual([
        ['Yes, send me offers', 'No thanks'], ["Yes, I'm in", 'No thanks'], ['Yes, include me', 'No thanks'], ['OPT IN', 'OPT OUT'],
      ]);
      expect(OPT_IN_PRESET).toBe(CONSENT_LABEL_PAIRS[0]);
      for (const p of CONSENT_LABEL_PAIRS) {
        expect(p.yes.length).toBeLessThanOrEqual(ENTRY_LABEL_LIMIT);
        expect(p.no.length).toBeLessThanOrEqual(ENTRY_LABEL_LIMIT);
      }
    });

    it('the hints about the standard confirmation texts are descriptions, never something that looks like a placeholder (the server sends a text exactly as written, so "{name}" or "[brackets]" would reach a customer as they stand)', () => {
      expect(Object.keys(DEFAULT_CONFIRMATIONS).sort()).toEqual(['interested', 'opt_in', 'opt_out']);
      for (const [action, hint] of Object.entries(DEFAULT_CONFIRMATIONS)) {
        expect(hint, action).not.toMatch(/[{}[\]<>]/);
        expect(hint.trim().length, action).toBeGreaterThan(10);
      }
    });

    it('carries the six pieces of writing guidance', () => {
      expect(CONSENT_WRITING_GUIDANCE).toHaveLength(6);
      expect(CONSENT_WRITING_GUIDANCE.join(' ')).toMatch(/benefit/i);
      expect(CONSENT_WRITING_GUIDANCE.join(' ')).toMatch(/50 words/);
      expect(CONSENT_WRITING_GUIDANCE.join(' ')).toMatch(/urgency/);
    });

    it('label limits: 25 on the entry step, 20 below it', () => {
      expect(ENTRY_LABEL_LIMIT).toBe(25);
      expect(FOLLOW_UP_LABEL_LIMIT).toBe(20);
      expect(labelLimitFor(0)).toBe(25);
      expect(labelLimitFor(1)).toBe(20);
      expect(labelLimitFor(3)).toBe(20);
    });
  });

  describe('checkConsentWording', () => {
    it('finds nothing wrong with good wording', () => {
      expect(checkConsentWording(GOOD)).toEqual([]);
    });

    it('an empty message is an error', () => {
      expect(checkConsentWording({ bodyText: '   ', buttons: GOOD.buttons }).map((i) => [i.level, i.code])).toEqual([['error', 'empty_body']]);
      expect(codes({ bodyText: '', buttons: [] })).toContain('empty_body');
    });

    it('square-bracket placeholders left in are an error naming them', () => {
      const issues = checkConsentWording(withBody("Hi {{1}}, it's [Business name]. Offers on WhatsApp, stop any time. [offer in one line]"));
      const p = issues.find((i) => i.code === 'placeholder')!;
      expect(p.level).toBe('error');
      expect(p.message).toContain('[Business name]');
      expect(p.message).toContain('[offer in one line]');
    });

    it('a body starting or ending with a variable is an error (Meta refuses it)', () => {
      expect(codes(withBody('{{1}}, want offers on WhatsApp? Stop any time.'))).toContain('starts_with_variable');
      expect(codes(withBody('Want offers on WhatsApp? You can stop any time. Thanks {{1}}'))).toContain('ends_with_variable');
      expect(codes(withBody('Hi {{1}}, want offers on WhatsApp? You can stop any time.'))).not.toContain('starts_with_variable');
      expect(codes(withBody('Hi {{1}}, want offers on WhatsApp? You can stop any time {{1}}.'))).not.toContain('ends_with_variable'); // a full stop follows it
    });

    it('over 1024 characters is an error; over about 50 words is only advice', () => {
      const long = 'Offers on WhatsApp, stop any time. ' + 'x'.repeat(1100);
      expect(checkConsentWording(withBody(long)).find((i) => i.code === 'too_long')!.level).toBe('error');
      const wordy = 'Hi {{1}}, ' + 'we have offers on WhatsApp and you can stop any time '.repeat(2) + 'word '.repeat(45);
      const w = checkConsentWording(withBody(wordy)).find((i) => i.code === 'long')!;
      expect(w.level).toBe('warning');
      expect(w.message).toMatch(/words/);
    });

    it('asks for what the customer agrees to (offers on WhatsApp) and for "stop any time"', () => {
      expect(codes(withBody('Hi {{1}}, thanks for visiting. Tap yes to continue.'))).toEqual(expect.arrayContaining(['agreement', 'stop_any_time']));
      expect(codes(withBody('Hi {{1}}, we have offers on WhatsApp. Tap yes.'))).toEqual(['stop_any_time']);
      expect(codes(withBody('Hi {{1}}, we have offers. Reply STOP any time.'))).toEqual(['agreement']); // WhatsApp not mentioned
      expect(codes(withBody('Hi {{1}}, offers on WhatsApp. You can opt out whenever you like.'))).toEqual([]);
      for (const c of ['agreement', 'stop_any_time']) {
        expect(checkConsentWording(withBody('Hi {{1}}, hello.')).find((i) => i.code === c)!.level).toBe('warning');
      }
    });

    it('flags pressure and false urgency (advice, not a block)', () => {
      for (const phrase of ['Hurry!', 'Last chance to join', 'Act now', "Don't miss out", 'Limited time only', 'This expires tonight']) {
        const issues = checkConsentWording(withBody(`Hi {{1}}, ${phrase} Offers on WhatsApp, stop any time.`));
        expect(issues.find((i) => i.code === 'pressure'), phrase).toMatchObject({ level: 'warning' });
      }
      expect(codes(GOOD)).not.toContain('pressure');
    });

    it('warns when the message tells customers to tap a label that no button has', () => {
      const body = 'Hi {{1}}, offers on WhatsApp. Tap "Yes, include me" to join. Stop any time.';
      const issue = checkConsentWording(withBody(body)).find((i) => i.code === 'label_mismatch')!;
      expect(issue.level).toBe('warning');
      expect(issue.message).toContain('Yes, include me');
      const ok = withBody(body, [{ position: 0, label: 'yes, include me', nextAction: 'opt_in' }, { position: 1, label: 'No thanks', nextAction: 'opt_out' }]);
      expect(codes(ok)).not.toContain('label_mismatch'); // case does not matter
      expect(codes(withBody('Hi {{1}}, offers on WhatsApp. Tap \u{201C}Yes, include me\u{201D} to join. Stop any time.'))).toContain('label_mismatch'); // curly quotes too
    });

    it('needs an Opt in button (error) and recommends an Opt out button (warning)', () => {
      const onlyNo = checkConsentWording(withBody(GOOD.bodyText, [{ position: 0, label: 'No thanks', nextAction: 'opt_out' }]));
      expect(onlyNo.find((i) => i.code === 'no_opt_in_button')!.level).toBe('error');
      const onlyYes = checkConsentWording(withBody(GOOD.bodyText, [{ position: 0, label: 'Yes', nextAction: 'opt_in' }]));
      expect(onlyYes.find((i) => i.code === 'no_opt_out_button')!.level).toBe('warning');
      expect(onlyYes.find((i) => i.code === 'no_opt_in_button')).toBeUndefined();
      expect(codes(withBody(GOOD.bodyText, []))).toContain('no_opt_in_button');
    });

    it('button labels: empty, too long and duplicated are errors', () => {
      const btn = (label: string, nextAction: any = 'end_flow', position = 0) => ({ position, label, nextAction });
      expect(codes(withBody(GOOD.bodyText, [btn('Yes', 'opt_in'), btn('  ', 'opt_out', 1)]))).toContain('empty_label');
      expect(codes(withBody(GOOD.bodyText, [btn('A'.repeat(26), 'opt_in')]))).toContain('label_too_long');
      expect(codes(withBody(GOOD.bodyText, [btn('A'.repeat(25), 'opt_in'), btn('No thanks', 'opt_out', 1)]))).not.toContain('label_too_long');
      expect(codes(withBody(GOOD.bodyText, [btn('Yes', 'opt_in'), btn('yes ', 'opt_out', 1)]))).toContain('duplicate_label');
    });

    it('tolerates a missing draft', () => {
      expect(() => checkConsentWording(null)).not.toThrow();
      expect(codes(null as any)).toContain('empty_body');
    });
  });

  describe('consentWordingSignature', () => {
    it('is the same for the same wording and changes with the body, a label, an action or a confirmation text', () => {
      const clone = () => JSON.parse(JSON.stringify(GOOD)) as MessageNodeDraft;
      const base = consentWordingSignature(GOOD);
      expect(consentWordingSignature(clone())).toBe(base);
      expect(consentWordingSignature({ ...clone(), bodyText: GOOD.bodyText + '!' })).not.toBe(base);
      const l = clone(); l.buttons[1].label = 'Not now';
      expect(consentWordingSignature(l)).not.toBe(base);
      const a = clone(); a.buttons[1].nextAction = 'interested';
      expect(consentWordingSignature(a)).not.toBe(base);
      const r = clone(); r.buttons[0].replyText = 'Welcome!';
      expect(consentWordingSignature(r)).not.toBe(base);
    });

    it('ignores surrounding whitespace and a confirmation text on a button that has no consent action', () => {
      const base = consentWordingSignature(GOOD);
      expect(consentWordingSignature({ ...GOOD, bodyText: `  ${GOOD.bodyText}  ` })).toBe(base);
      const d = JSON.parse(JSON.stringify(GOOD)) as MessageNodeDraft;
      d.buttons.push({ position: 2, label: 'More', nextAction: 'end_flow', replyText: 'ignored' });
      const d2 = JSON.parse(JSON.stringify(d)) as MessageNodeDraft;
      d2.buttons[2].replyText = 'also ignored';
      expect(consentWordingSignature(d2)).toBe(consentWordingSignature(d));
    });
  });

  describe('consentWordingSignature and follow-up messages', () => {
    const withFollowUp = (text: string, deeper?: string): MessageNodeDraft => ({
      ...GOOD,
      buttons: [
        ...GOOD.buttons,
        {
          position: 2, label: 'Tell me more', nextAction: 'send_message',
          followUp: {
            bodyText: text,
            buttons: [{ position: 0, label: 'Great', nextAction: 'send_message', followUp: deeper === undefined ? undefined : { bodyText: deeper, buttons: [] } }],
          },
        },
      ],
    });

    it('a message without follow-ups keeps exactly the fingerprint it always had (earlier acknowledgements stay valid)', () => {
      // the shape of the signature before follow-ups were part of it: [body, [[label, action, confirmation text], ...]]
      expect(consentWordingSignature(GOOD)).toBe(JSON.stringify([GOOD.bodyText.trim(), [['Yes, send me offers', 'opt_in', ''], ['No thanks', 'opt_out', '']]]));
      expect(consentWordingHash(GOOD)).toMatch(/^[0-9a-f]{14}$/);
    });

    it('changes when a follow-up message is written, edited, or one is nested deeper - so an earlier acknowledgement does not cover it', () => {
      const base = consentWordingSignature(GOOD);
      const one = consentWordingSignature(withFollowUp('Our spring offers: 30% off.'));
      expect(one).not.toBe(base);
      expect(consentWordingSignature(withFollowUp('Our spring offers: 30% off!'))).not.toBe(one);
      expect(consentWordingSignature(withFollowUp('Our spring offers: 30% off.', 'Even more offers'))).not.toBe(one);
      expect(consentWordingSignature(withFollowUp('Our spring offers: 30% off.', 'Even more offers!'))).not.toBe(consentWordingSignature(withFollowUp('Our spring offers: 30% off.', 'Even more offers')));
      expect(consentWordingHash(withFollowUp('a'))).not.toBe(consentWordingHash(withFollowUp('b')));
      expect(consentWordingSignature(withFollowUp('same'))).toBe(consentWordingSignature(withFollowUp(' same ')));
    });

    it('a follow-up that is left over on a button that no longer sends a message is not part of what is shown', () => {
      const d = withFollowUp('Our spring offers: 30% off.');
      const gone = JSON.parse(JSON.stringify(d)) as MessageNodeDraft;
      gone.buttons[2].nextAction = 'end_flow'; // the draft still carries the old followUp object; saving ignores it, so does the fingerprint
      const clean = JSON.parse(JSON.stringify(gone)) as MessageNodeDraft;
      delete clean.buttons[2].followUp;
      expect(consentWordingSignature(gone)).toBe(consentWordingSignature(clean));
    });
  });

  describe('consentWordingHash (what the server keeps with the acknowledgement)', () => {
    it('is 14 hex digits, the same for the same wording and different for any change of it', () => {
      const clone = () => JSON.parse(JSON.stringify(GOOD)) as MessageNodeDraft;
      const base = consentWordingHash(GOOD);
      expect(base).toMatch(/^[0-9a-f]{14}$/);
      expect(consentWordingHash(clone())).toBe(base);
      expect(consentWordingHash({ ...GOOD, bodyText: `  ${GOOD.bodyText}  ` })).toBe(base); // same wording: whitespace around it is not a change
      const hashes = new Set([base]);
      hashes.add(consentWordingHash({ ...clone(), bodyText: GOOD.bodyText + '!' }));
      const l = clone(); l.buttons[1].label = 'Not now'; hashes.add(consentWordingHash(l));
      const a = clone(); a.buttons[1].nextAction = 'interested'; hashes.add(consentWordingHash(a));
      const r = clone(); r.buttons[0].replyText = 'Welcome!'; hashes.add(consentWordingHash(r));
      expect(hashes.size).toBe(5);
    });

    it('never throws on an empty draft', () => {
      expect(consentWordingHash(null)).toMatch(/^[0-9a-f]{14}$/);
      expect(consentWordingHash(undefined)).toMatch(/^[0-9a-f]{14}$/);
    });
  });
});
