import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import type { CatalogMap } from '../../i18n/i18n.types';
import { AuthService } from '../../shared/auth.service';
import { OnbAnalyticsService } from './onb-analytics.service';
import { OnbApiService } from './onb-api.service';
import {
  OnbHelp, OnbHelpService, OnbHelpSheet, buildHelpText, buildMailtoUrl, buildWaMeUrl, digitsOnly, eventStepOf, stepNumberOf,
} from './onb-help';
import { OnbStateService } from './onb-state.service';
import type { OnbHelpContext, OnbState } from './onb.types';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
}

const base = { businessName: 'Sara Bakery', userName: 'Sara', stepNumber: 3, stepKey: 'connect', lastError: 'CONNECT_PARTIAL', lang: 'en' as const, path: '/setup/connect' };

describe('buildHelpText', () => {
  it('carries business name, name, step, last problem, language and page (path only)', () => {
    const text = buildHelpText({ ...base, path: '/setup/connect?token=abc#x' });
    expect(text.split('\n')).toEqual([
      'Hi WaFlow, I need help with my setup.',
      'Business: Sara Bakery',
      'Name: Sara',
      'Step: 3 of 5 (connect)',
      'Last problem: CONNECT_PARTIAL',
      'Language: en',
      'Page: /setup/connect',
    ]);
    expect(text).not.toContain('token=abc');
  });

  it('uses dashes and "none" when data is missing or invalid', () => {
    const text = buildHelpText({ ...base, businessName: null, userName: undefined, lastError: 'not a code!', stepKey: 'Bad Key', lang: 'ar' });
    expect(text).toContain('Business: -');
    expect(text).toContain('Name: -');
    expect(text).toContain('Last problem: none');
    expect(text).toContain('(-)');
    expect(text).toContain('Language: ar');
  });

  it('never carries a phone number or an e-mail address, even when a name field contains one', () => {
    const text = buildHelpText({ ...base, businessName: '+966 50 123 4567', userName: 'sara@example.com' });
    expect(text).toContain('Business: -');
    expect(text).toContain('Name: -');
    expect(text).not.toMatch(/@|966|\d{7}/);
  });

  it('flattens control characters, bidi marks and line breaks, and limits the length', () => {
    const evil = 'Line1\nLine2\r\nPage: /admin' + String.fromCodePoint(0x202e) + 'x'.repeat(200);
    const lines = buildHelpText({ ...base, businessName: evil }).split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[1].length).toBeLessThanOrEqual('Business: '.length + 80);
    expect(lines[1]).not.toContain(String.fromCodePoint(0x202e));
  });

  it('clamps the step number to 1..5', () => {
    expect(buildHelpText({ ...base, stepNumber: 0 })).toContain('Step: 1 of 5');
    expect(buildHelpText({ ...base, stepNumber: 99 })).toContain('Step: 5 of 5');
    expect(buildHelpText({ ...base, stepNumber: Number.NaN })).toContain('Step: 1 of 5');
  });
});

describe('contact link builders', () => {
  it('digitsOnly', () => {
    expect(digitsOnly('+966 (50) 123-4567')).toBe('966501234567');
    expect(digitsOnly(null)).toBe('');
  });

  it('wa.me uses digits only and an encoded text; unusable numbers give null', () => {
    const url = buildWaMeUrl('+966 50 123 4567', 'Hi & bye\nline 2');
    expect(url).toBe('https://wa.me/966501234567?text=' + encodeURIComponent('Hi & bye\nline 2'));
    expect(buildWaMeUrl(null, 'x')).toBeNull();
    expect(buildWaMeUrl('12345', 'x')).toBeNull();
    expect(buildWaMeUrl('1'.repeat(16), 'x')).toBeNull();
    expect(buildWaMeUrl('javascript:alert(1)', 'x')).toBeNull();
  });

  it('mailto encodes subject and body; invalid addresses give null', () => {
    const url = buildMailtoUrl('help@waflow.example', 'WaFlow setup help', 'a&b=c\nd');
    expect(url).toBe('mailto:help@waflow.example?subject=WaFlow%20setup%20help&body=' + encodeURIComponent('a&b=c\nd'));
    for (const bad of [null, '', 'no-at-sign', 'a b@c.d', 'a@b', 'x@y.z,evil@z.z', '<x@y.z>']) expect(buildMailtoUrl(bad, 's', 'b')).toBeNull();
  });

  it('step helpers', () => {
    expect(stepNumberOf('business')).toBe(1);
    expect(stepNumberOf('connect')).toBe(3);
    expect(stepNumberOf('customers')).toBe(3);
    expect(stepNumberOf('approvals')).toBe(4);
    expect(stepNumberOf(null)).toBe(5);
    expect(eventStepOf(true, 'connect')).toBe('billing');
    expect(eventStepOf(false, 'products')).toBe('products');
    expect(eventStepOf(false, null)).toBe('promotion');
    expect(eventStepOf(false, 'zzz')).toBe('promotion');
  });
});

@Component({ imports: [OnbHelp, OnbHelpSheet], template: `<app-onb-help /><app-onb-help-sheet />` })
class Host {}

interface Rig { el: HTMLElement; help: OnbHelpService; track: ReturnType<typeof vi.fn>; fixture: ReturnType<typeof TestBed.createComponent<Host>> }

async function rig(ctx: OnbHelpContext | 'error', state: OnbState = { enrolled: true, nextStep: 'connect', subscription: { state: 'active' }, business: { name: 'Sara Bakery' } }): Promise<Rig> {
  const helpContext = vi.fn(() => (ctx === 'error' ? throwError(() => ({ status: 500 })) : of(ctx)));
  const track = vi.fn(() => true);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: I18nService, useClass: FakeI18n },
      { provide: OnbApiService, useValue: { helpContext, getState: () => new Subject() } },
      { provide: OnbAnalyticsService, useValue: { track } },
      {
        provide: AuthService,
        useValue: { session: of(null), sessionSnapshot: { user: { name: 'Sara', phone: '+966501234567', email: 'sara@example.com' }, workspace: { name: '+966501234567 Workspace' }, role: 'owner' } },
      },
    ],
  });
  await TestBed.inject(I18nService).init();
  TestBed.inject(OnbStateService).state.set(state);
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, help: TestBed.inject(OnbHelpService), track, fixture };
}

describe('OnbHelp sheet', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('opens a dialog on click, fires help_opened with the step and last error, and offers WhatsApp and e-mail when known', async () => {
    const r = await rig({ businessName: 'Sara Bakery', supportWhatsapp: '+966 50 000 0000', supportEmail: 'help@waflow.example' });
    r.help.setLastError('META_ERROR');
    (r.el.querySelector('button.onb-help-btn') as HTMLButtonElement).click();
    r.fixture.detectChanges();
    expect(r.el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(r.track).toHaveBeenCalledWith('help_opened', 'connect', 'META_ERROR');
    const links = Array.from(r.el.querySelectorAll('a.onb-btn')) as HTMLAnchorElement[];
    const wa = links.find((a) => a.href.startsWith('https://wa.me/'))!;
    const mail = links.find((a) => a.href.startsWith('mailto:'))!;
    expect(wa.getAttribute('href')).toContain('https://wa.me/966500000000?text=');
    expect(wa.getAttribute('rel')).toContain('noopener');
    const body = decodeURIComponent(mail.getAttribute('href')!.split('body=')[1]);
    expect(body).toContain('Business: Sara Bakery');
    expect(body).toContain('Name: Sara');
    expect(body).toContain('Step: 3 of 5 (connect)');
    expect(body).toContain('Last problem: META_ERROR');
    expect(body).not.toMatch(/966501234567|sara@example\.com|Workspace/); // never the phone, e-mail or workspace name
    expect(r.el.querySelector('a[href="/support"]')).toBeNull();
  });

  it('with no support contacts it links to the existing support page', async () => {
    const r = await rig({ supportEmail: null, supportWhatsapp: null });
    r.help.openSheet();
    r.fixture.detectChanges();
    const page = r.el.querySelector('a.onb-btn') as HTMLAnchorElement;
    expect(page.getAttribute('href')).toBe('/support');
  });

  it('a failed help-context request falls back to the support page (never an error)', async () => {
    const r = await rig('error');
    r.help.openSheet();
    r.fixture.detectChanges();
    expect(r.help.contextFailed()).toBe(true);
    expect((r.el.querySelector('a.onb-btn') as HTMLAnchorElement).getAttribute('href')).toBe('/support');
  });

  it('falls back to the state lastError when no screen set one, and ignores a malformed last error', async () => {
    const r = await rig({}, { enrolled: true, nextStep: 'approvals', subscription: { state: 'active' }, lastError: { code: 'TEMPLATE_REJECTED' } });
    r.help.openSheet();
    expect(r.track).toHaveBeenCalledWith('help_opened', 'approvals', 'TEMPLATE_REJECTED');
    r.help.setLastError('has spaces and 12345');
    expect(r.help.lastError()).toBeNull();
  });

  it('billing takeover reports the billing step', async () => {
    const r = await rig({}, { enrolled: true, subscription: { state: 'none' } });
    r.help.openSheet();
    expect(r.track).toHaveBeenCalledWith('help_opened', 'billing', undefined);
  });

  describe('the previous merchant is forgotten when the session ends (R6-13)', () => {
    const TOKEN = 'waflow_auth_token';
    afterEach(() => localStorage.clear());

    it('another login token in the same tab clears the support contacts, the business name, the last problem and an open sheet', async () => {
      localStorage.setItem(TOKEN, 'token-A');
      const r = await rig({ businessName: 'Old Shop', supportWhatsapp: '+966 50 000 0000', supportEmail: 'old@waflow.example' });
      const state = TestBed.inject(OnbStateService);
      state.load(); // loaded for token-A (the answer never arrives in this spec)
      r.help.setLastError('META_ERROR');
      r.help.openSheet();
      r.fixture.detectChanges();
      expect(r.help.context()?.businessName).toBe('Old Shop');
      expect(r.help.open()).toBe(true);
      localStorage.setItem(TOKEN, 'token-B');
      state.ensureLoaded();
      r.fixture.detectChanges();
      expect(r.help.context()).toBeNull();
      expect(r.help.contextFailed()).toBe(false);
      expect(r.help.lastError()).toBeNull();
      expect(r.help.open()).toBe(false);
      expect(r.el.querySelector('[role="dialog"]')).toBeNull();
      localStorage.clear();
    });

    it('a logout clears them too, and the next help text carries nothing of the old merchant', async () => {
      localStorage.setItem(TOKEN, 'token-A');
      const r = await rig({ businessName: 'Old Shop' }, { enrolled: true, nextStep: 'connect', subscription: { state: 'active' } });
      const state = TestBed.inject(OnbStateService);
      state.load();
      r.help.openSheet();
      r.help.close();
      localStorage.removeItem(TOKEN);
      state.ensureLoaded();
      expect(r.help.context()).toBeNull();
      r.help.openSheet(); // the next merchant opens the sheet: it asks for ITS context
      r.fixture.detectChanges();
      expect(r.el.querySelector('[role="dialog"]')).toBeTruthy();
      expect(r.el.textContent).not.toContain('Old Shop');
    });

    it('the same token keeps the context (an ordinary reload of the state is not the end of a session)', async () => {
      localStorage.setItem(TOKEN, 'token-A');
      const r = await rig({ businessName: 'Shop' });
      const state = TestBed.inject(OnbStateService);
      state.load();
      r.help.openSheet();
      state.ensureLoaded();
      state.load(true);
      expect(r.help.context()?.businessName).toBe('Shop');
      localStorage.clear();
    });

    it('clear() resets the four fields and is safe to call twice', async () => {
      const r = await rig({ businessName: 'Shop' });
      r.help.setLastError('META_ERROR');
      r.help.openSheet();
      r.help.clear();
      r.help.clear();
      expect([r.help.open(), r.help.context(), r.help.contextFailed(), r.help.lastError()]).toEqual([false, null, false, null]);
    });
  });

  it('Escape and the close button close it', async () => {
    const r = await rig({});
    r.help.openSheet();
    r.fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    r.fixture.detectChanges();
    expect(r.help.open()).toBe(false);
    expect(r.el.querySelector('[role="dialog"]')).toBeNull();
    r.help.openSheet();
    r.fixture.detectChanges();
    const buttons = Array.from(r.el.querySelectorAll('.onb-sheet button.onb-link')) as HTMLButtonElement[];
    buttons[buttons.length - 1].click();
    r.fixture.detectChanges();
    expect(r.help.open()).toBe(false);
  });
});
