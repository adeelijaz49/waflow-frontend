import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { SenderSendPlan } from '../localization.types';
import { SenderLanguageNote } from './sender-language-note';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const plan = (over: Partial<SenderSendPlan> = {}): SenderSendPlan => ({
  selected: 30, eligible: 30, skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 0 },
  byLanguage: { ar: 8, en: 22 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'no_arabic_version', count: 8 }], blocked: [],
  warnings: [], canSend: true, needsAcknowledgement: true, ...over,
});

@Component({
  imports: [SenderLanguageNote],
  template: `<app-sender-language-note [sender]="sender()" [result]="result()" />`,
})
class Host {
  sender = signal<'loyalty_reminder' | 'consent_request'>('loyalty_reminder');
  result = signal<unknown>(null);
}

async function setup(getSenderPlan: unknown, uiLang: 'en' | 'ar' = 'en') {
  localStorage.clear();
  const api = { getSenderPlan };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  if (uiLang === 'ar') await i18n.use('ar', false);
  const fixture = TestBed.createComponent(Host);
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, api };
}
async function settleFixture(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
}
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SenderLanguageNote', () => {
  it('makes one plan request for its sender and shows who gets which language', async () => {
    const getSenderPlan = vi.fn(() => of(plan()));
    const { el } = await setup(getSenderPlan);
    expect(getSenderPlan).toHaveBeenCalledTimes(1);
    expect(getSenderPlan).toHaveBeenCalledWith('loyalty_reminder');
    expect(text(el)).toContain('Each customer gets the reminder in their own language.');
    expect(text(el)).toContain('Arabic 8');
    expect(text(el)).toContain('English 14'); // 22 English minus the 8 who get English instead of Arabic
    expect(text(el)).toContain('there is no Arabic version of this message yet');
    expect(Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/arabic/templates');
  });

  it('uses the consent wording for the consent request', async () => {
    const getSenderPlan = vi.fn(() => of(plan()));
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: { getSenderPlan } }] });
    await TestBed.inject(I18nService).init();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.sender.set('consent_request');
    await settleFixture(fixture);
    expect(getSenderPlan).toHaveBeenCalledWith('consent_request');
    expect(text(fixture.nativeElement)).toContain('the Arabic opt-in message is not set up yet');
  });

  it('stays hidden when nobody in the audience speaks Arabic (nothing differs from today)', async () => {
    const { el } = await setup(vi.fn(() => of(plan({ byLanguage: { ar: 0, en: 30 }, fallbacks: [] }))));
    expect(el.querySelector('.sln')).toBeNull();
  });

  it.each([[402], [404]])('hides itself on %s', async (status) => {
    const { el } = await setup(vi.fn(() => throwError(() => ({ status }))));
    expect(text(el)).toBe('');
  });

  it('shows a retry note on a server error', async () => {
    const getSenderPlan = vi.fn().mockReturnValueOnce(throwError(() => ({ status: 500 }))).mockReturnValue(of(plan()));
    const { fixture, el } = await setup(getSenderPlan);
    expect(text(el)).toContain('Could not check the languages for this selection. Sending is not affected.');
    el.querySelector<HTMLButtonElement>('button')!.click();
    await settleFixture(fixture);
    expect(getSenderPlan).toHaveBeenCalledTimes(2);
    expect(text(el)).toContain('Arabic 8');
  });

  it('shows the language breakdown of the send that just happened', async () => {
    const { fixture, el } = await setup(vi.fn(() => of(plan())));
    fixture.componentInstance.result.set({
      sentCount: 30, languageCounts: { ar: 5, en: 25 },
      localization: { arabicCustomers: 8, arabicSent: 5, arabicFailed: 0, fallbackToEnglish: [{ reason: 'not_reviewed', count: 3 }], excludedOptedOutPhone: 0 },
    });
    await settleFixture(fixture);
    expect(text(el)).toContain('Last send: 5 in Arabic, 25 in English.');
    expect(text(el)).toContain('3 fell back to English because the Arabic version has not been reviewed');
  });

  it('keeps every label English when the stored UI language is Arabic', async () => {
    const { el } = await setup(vi.fn(() => of(plan())), 'ar');
    expect(text(el)).not.toMatch(/\p{Script=Arabic}/u);
    expect(text(el)).not.toMatch(/(promolang|flowlang)\./);
    expect(text(el)).toContain('Language');
  });
});
