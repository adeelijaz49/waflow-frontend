import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';

// The "WhatsApp Token" and "WhatsApp Message Templates" cards are for the people who may manage that WhatsApp account: platform staff
// for the shared number, the owner of a customer for its own number. The server names them (canManageWhatsApp on /auth/me: the rule it
// enforces on those calls); only they see the cards and trigger the two calls behind them.
vi.setConfig({ testTimeout: 30000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = {
  user: { id: 'u1', name: 'A', phone: '', email: 'a@example.com' },
  workspace: { id: 'w1', name: 'Home', onboarding: { completed: true, currentStep: 5 } },
  role: 'owner',
};

async function boot(session: Record<string, unknown>) {
  localStorage.clear();
  localStorage.setItem('waflow_auth_token', 'token-A');
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const seen: string[] = [];
  const answer = () => {
    for (const req of http.match(() => true)) {
      const key = `${req.request.method} ${req.request.urlWithParams}`.replace(/^(GET|POST|PUT) .*?(\/api\/)/, '$1 $2');
      seen.push(key);
      if (/auth\/me/.test(key)) req.flush(session);
      else if (/localization\/settings/.test(key)) req.flush({ arabicEnabled: false, defaultCustomerLanguage: 'en', bilingualOrder: 'ar_first' });
      else if (/consent-stats/.test(key)) req.flush({ eligibleForConsentRequest: 0, consented: 0, notYetConsented: 0, optedOut: 0, total: 0, recentEvents: [] });
      else if (/whatsapp\/templates/.test(key)) req.flush({ templates: [{ name: 'waflow_promo', status: 'APPROVED', category: 'MARKETING', language: 'en' }] });
      else if (/token-status/.test(key)) req.flush({ isValid: true, neverExpires: true, checkedAt: null, hasAppCredentials: true });
      else if (/settings\/loyalty/.test(key)) req.flush({});
      else req.flush([]);
    }
  };
  const fixture: ComponentFixture<Settings> = TestBed.createComponent(Settings);
  fixture.detectChanges();
  for (let i = 0; i < 4; i++) {
    answer();
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    await sleep(0);
  }
  return { el: fixture.nativeElement as HTMLElement, seen };
}

const titles = (el: HTMLElement) => Array.from(el.querySelectorAll('.card-title')).map((t) => (t.textContent || '').trim());

describe('Settings page: the WhatsApp cards are for the people the server says may manage that account', () => {
  afterEach(() => localStorage.clear());

  it('hides both cards from an ordinary owner and makes no token-status / templates call', async () => {
    const { el, seen } = await boot(base);
    const t = titles(el);
    expect(t.some((x) => x.includes('WhatsApp Token'))).toBe(false);
    expect(t.some((x) => x.includes('WhatsApp Message Templates'))).toBe(false);
    expect(seen.some((s) => /token-status|whatsapp\/templates/.test(s))).toBe(false);
    expect(el.textContent).not.toContain('Refresh Token Now');
    // the merchant's own cards are untouched
    expect(t.some((x) => x.includes('Team'))).toBe(true);
  });

  it('hides them when canManageWhatsApp is false', async () => {
    const { el } = await boot({ ...base, superAdmin: false, canManageWhatsApp: false });
    expect(titles(el).some((x) => x.includes('WhatsApp Token'))).toBe(false);
  });

  it('hides them from a super admin who is working INSIDE a customer on the shared number (the server refuses those calls there): no token-status / templates call either', async () => {
    const { el, seen } = await boot({ ...base, superAdmin: true, canManageWhatsApp: false, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    expect(titles(el).some((x) => x.includes('WhatsApp Token'))).toBe(false);
    expect(titles(el).some((x) => x.includes('WhatsApp Message Templates'))).toBe(false);
    expect(seen.some((s) => /token-status|whatsapp\/templates/.test(s))).toBe(false);
  });

  it('shows them to the people the server names even when no super admin is configured yet (superAdmin false): the platform owner keeps the cards until the setting is made', async () => {
    const { el, seen } = await boot({ ...base, superAdmin: false, canManageWhatsApp: true });
    expect(titles(el).some((x) => x.includes('WhatsApp Token'))).toBe(true);
    expect(seen.filter((s) => /token-status/.test(s)).length).toBe(1);
  });

  it('shows them to the owner of a customer with a WhatsApp number of its own (that is its own account to manage), also to staff working inside that customer', async () => {
    const { el, seen } = await boot({ ...base, superAdmin: true, canManageWhatsApp: true, actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    expect(titles(el).some((x) => x.includes('WhatsApp Token'))).toBe(true);
    expect(titles(el).some((x) => x.includes('WhatsApp Message Templates'))).toBe(true);
    expect(seen.filter((s) => /token-status/.test(s)).length).toBe(1);
  });

  it('does not show them when the server does not say (an older server that does not send the field)', async () => {
    const { el } = await boot({ ...base, superAdmin: true });
    expect(titles(el).some((x) => x.includes('WhatsApp Token'))).toBe(false);
  });

  it('shows both cards to a super admin and loads their data once', async () => {
    const { el, seen } = await boot({ ...base, superAdmin: true, canManageWhatsApp: true });
    const t = titles(el);
    expect(t.some((x) => x.includes('WhatsApp Token'))).toBe(true);
    expect(t.some((x) => x.includes('WhatsApp Message Templates'))).toBe(true);
    expect(el.textContent).toContain('waflow_promo');
    expect(seen.filter((s) => /token-status/.test(s)).length).toBe(1);
    expect(seen.filter((s) => /whatsapp\/templates/.test(s)).length).toBe(1);
  });
});
