// The constants of onb-links.ts that must agree with the backend (one URL for both sides) and the shape of the URL lists.
import { LOCK_ALLOW, ONB_EXTERNAL_LINKS, SAUDI_TELECOM_GUIDANCE_URL, SEND_ROUTES, isLockAllowed, isSendRoute, pathOf } from './onb-links';

// Backend defaults (waflow-backend shared/onboarding/metaConfig.js): META_WHATSAPP_MANAGER_URL() is a fixed URL, and
// META_SECURITY_CENTER_URL() defaults to the same security page as the frontend fallback. The approvals rows carry the backend's own
// links and the screen prefers them; these constants only answer where a row has none, so the two sides must never disagree.
const BACKEND_WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const BACKEND_SECURITY_CENTER_URL = 'https://business.facebook.com/settings/security';

describe('external links', () => {
  it('the WhatsApp Manager fallback is the backend default (one URL for both sides)', () => {
    expect(ONB_EXTERNAL_LINKS.whatsappManager).toBe(BACKEND_WHATSAPP_MANAGER_URL);
  });

  it('the security centre fallback is the backend default', () => {
    expect(ONB_EXTERNAL_LINKS.metaSecurityCenter).toBe(BACKEND_SECURITY_CENTER_URL);
  });

  it('every link is an absolute https URL without credentials', () => {
    for (const url of [...Object.values(ONB_EXTERNAL_LINKS), SAUDI_TELECOM_GUIDANCE_URL]) {
      const u = new URL(url);
      expect(u.protocol, url).toBe('https:');
      expect(u.username, url).toBe('');
      expect(u.password, url).toBe('');
    }
  });
});

describe('URL lists', () => {
  it('SEND_ROUTES: the five pages of the first build plus AI Mode, the Arabic hub and Customers (the server refuses their send actions)', () => {
    expect([...SEND_ROUTES]).toEqual([
      '/promotions', '/flows', '/referrals', '/inbox', '/instagram-promotions', '/ai-mode', '/arabic', '/customers',
    ]);
  });

  it('the two lists never overlap: a send route is never lock-allowed (the veil still applies to it)', () => {
    for (const p of SEND_ROUTES) expect(LOCK_ALLOW.includes(p), p).toBe(false);
    for (const p of LOCK_ALLOW) expect(isSendRoute(p), p).toBe(false);
  });

  it('isSendRoute and isLockAllowed ignore the query string and fragment and match whole segments only', () => {
    expect(pathOf('/customers?q=sara#top')).toBe('/customers');
    expect(isSendRoute('/customers?q=sara#top')).toBe(true);
    expect(isSendRoute('/customers/42')).toBe(true); // a deeper path under a send route is still that page
    expect(isLockAllowed('/customers?q=sara')).toBe(false);
    expect(isSendRoute('/customers-archive')).toBe(false);
  });
});
