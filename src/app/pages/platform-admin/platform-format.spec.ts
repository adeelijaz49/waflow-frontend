import { PLATFORM_ROUTES } from './platform.routes';
import { auditActionLabel, normalisePhoneDigits, ownerLabel, platformNumberLabel, validOwnerContact, whatsappLabel } from './platform-format';

const base = { mode: 'platform', phoneIdLast4: null, wabaId: null, displayPhoneNumber: null, verifiedName: null, tokenConfigured: false, tokenIsValid: null, checkedAt: null, enabled: true } as const;

describe('platform-format helpers', () => {
  it('whatsappLabel: platform number, display number, last four, plain own', () => {
    expect(whatsappLabel(null)).toBe('Platform number');
    expect(whatsappLabel({ ...base })).toBe('Platform number');
    expect(whatsappLabel({ ...base, mode: 'own', displayPhoneNumber: '+966 50 000 0000' })).toBe('+966 50 000 0000 (own)');
    expect(whatsappLabel({ ...base, mode: 'own', phoneIdLast4: '5678' })).toBe('Own number ending 5678');
    expect(whatsappLabel({ ...base, mode: 'own' })).toBe('Own number');
  });

  it('platformNumberLabel: display number, or the id tail, plus the verified name when there is one', () => {
    expect(platformNumberLabel({ displayPhoneNumber: '+1 555-643-3808', verifiedName: 'Test Number', phoneIdLast4: '1618' })).toBe('+1 555-643-3808 (Test Number)');
    expect(platformNumberLabel({ displayPhoneNumber: '+1 555-643-3808', verifiedName: null, phoneIdLast4: '1618' })).toBe('+1 555-643-3808');
    expect(platformNumberLabel({ displayPhoneNumber: null, verifiedName: 'Test Number', phoneIdLast4: '1618' })).toBe('Phone number id ending 1618 (Test Number)');
    expect(platformNumberLabel({ displayPhoneNumber: null, verifiedName: null, phoneIdLast4: '1618' })).toBe('Phone number id ending 1618');
    expect(platformNumberLabel({ displayPhoneNumber: '', verifiedName: '', phoneIdLast4: '1618' })).toBe('Phone number id ending 1618');
  });

  it('ownerLabel: none, one, several', () => {
    expect(ownerLabel({ owners: [] })).toBe('No owner yet');
    expect(ownerLabel({ owners: [{ userId: '1', name: '', contactMasked: '******1234' }] })).toBe('Owner (******1234)');
    expect(ownerLabel({ owners: [{ userId: '1', name: 'A', contactMasked: 'x' }, { userId: '2', name: 'B', contactMasked: 'y' }] })).toBe('A (x) +1');
  });

  it('auditActionLabel falls back to the raw action', () => {
    expect(auditActionLabel('enter')).toBe('Entered the customer');
    expect(auditActionLabel('act_as_write')).toBe('Made a change inside the customer');
    expect(auditActionLabel('something_new')).toBe('something_new');
  });

  it('normalisePhoneDigits keeps digits and converts Eastern Arabic digits', () => {
    expect(normalisePhoneDigits('+966 (50) 123-4567')).toBe('966501234567');
    expect(normalisePhoneDigits('\u{0669}\u{0666}\u{0666}\u{06F5}')).toBe('9665');
    expect(normalisePhoneDigits('')).toBe('');
  });

  it('validOwnerContact covers empty, short and long numbers and email shapes', () => {
    expect(validOwnerContact('phone', '')).toBe(false);
    expect(validOwnerContact('phone', '1234567')).toBe(false);
    expect(validOwnerContact('phone', '12345678')).toBe(true);
    expect(validOwnerContact('phone', '123456789012345')).toBe(true);
    expect(validOwnerContact('phone', '1234567890123456')).toBe(false);
    expect(validOwnerContact('email', 'a@b.co')).toBe(true);
    expect(validOwnerContact('email', 'a@b')).toBe(false);
    expect(validOwnerContact('email', 'a b@c.com')).toBe(false);
  });
});

describe('PLATFORM_ROUTES', () => {
  it('has the list at the root and the customer page at :id, both lazy', async () => {
    expect(PLATFORM_ROUTES.map((r) => r.path)).toEqual(['', ':id']);
    expect(typeof PLATFORM_ROUTES[0].loadComponent).toBe('function');
    expect(typeof PLATFORM_ROUTES[1].loadComponent).toBe('function');
  });
});
