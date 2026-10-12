import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CustomerLanguageRow } from '../localization.types';
import { CustomerLanguageField } from './customer-language-field';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const row = (over: Partial<CustomerLanguageRow> = {}): CustomerLanguageRow => ({
  id: 'c1', name: 'Aisha', phone: '+966500000001', language: 'unknown', languageSource: null, effectiveLanguage: 'ar',
  marketingConsent: true, optedOut: false, ...over,
});

@Component({
  imports: [CustomerLanguageField],
  template: `<app-customer-language-field [customerId]="id()" />`,
})
class Host {
  id = signal('c1');
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
}

async function setup(api: Record<string, unknown>, uiLang?: 'ar') {
  localStorage.clear();
  if (uiLang) localStorage.setItem('waflow_ui_language', uiLang);
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
  await TestBed.inject(I18nService).init();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, select: () => el.querySelector<HTMLSelectElement>('select') };
}

describe('CustomerLanguageField', () => {
  it('loads the customer language with one GET and renders the labelled select (English labels)', async () => {
    const getCustomerLanguage = vi.fn(() => of(row()));
    const { el, select } = await setup({ getCustomerLanguage });
    expect(getCustomerLanguage).toHaveBeenCalledTimes(1);
    expect(getCustomerLanguage).toHaveBeenCalledWith('c1');
    expect(text(el)).toContain('Message language');
    expect(Array.from(select()!.options).map((o) => o.textContent!.trim())).toEqual(['Not set', 'English', 'Arabic']);
    expect(select()!.value).toBe('unknown');
    expect(el.querySelector('label')!.getAttribute('for')).toBe(select()!.id);
    expect(text(el)).toContain('Will receive: Arabic (default)');
    expect(text(el)).not.toMatch(/customers\.|status\.|embedded\./);
    expect(Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/arabic/customers');
  });

  it('shows who set a known language instead of the default line', async () => {
    const { el, select } = await setup({ getCustomerLanguage: vi.fn(() => of(row({ language: 'ar', languageSource: 'customer_chose', effectiveLanguage: 'ar' }))) });
    expect(select()!.value).toBe('ar');
    expect(text(el)).toContain('Chosen by customer');
    expect(text(el)).not.toContain('(default)');
  });

  it('saves a change immediately with the existing PUT only and shows Saved plus the new source', async () => {
    const setCustomerLanguage = vi.fn((_id: string, language: 'en' | 'ar' | 'unknown') => of(row({ language, languageSource: 'merchant_set', effectiveLanguage: language === 'unknown' ? 'en' : language })));
    const { fixture, el, select } = await setup({ getCustomerLanguage: vi.fn(() => of(row())), setCustomerLanguage });
    select()!.value = 'ar';
    select()!.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(setCustomerLanguage).toHaveBeenCalledTimes(1);
    expect(setCustomerLanguage).toHaveBeenCalledWith('c1', 'ar');
    expect(text(el)).toContain('Saved');
    expect(text(el)).toContain('Set by you');
    expect(select()!.value).toBe('ar');
  });

  it('reverts the select and shows a plain English error when the save fails', async () => {
    const setCustomerLanguage = vi.fn(() => throwError(() => ({ status: 500, error: { error: 'boom' } })));
    const { fixture, el, select } = await setup({ getCustomerLanguage: vi.fn(() => of(row({ language: 'en', languageSource: 'inferred', effectiveLanguage: 'en' }))), setCustomerLanguage });
    select()!.value = 'ar';
    select()!.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(select()!.value).toBe('en');
    expect(text(el)).toContain('Something went wrong. Please try again.');
    expect(text(el)).not.toContain('boom');
  });

  it.each([[402], [404]])('renders nothing when the lookup answers %s (feature not available)', async (status) => {
    const { el, select } = await setup({ getCustomerLanguage: vi.fn(() => throwError(() => ({ status, error: { code: status === 402 ? 'ARABIC_NOT_ENABLED' : 'NOT_FOUND' } }))) });
    expect(select()).toBeNull();
    expect(text(el)).toBe('');
  });

  it('shows an inline retry on other errors and loads again on retry', async () => {
    const getCustomerLanguage = vi.fn().mockReturnValueOnce(throwError(() => ({ status: 500 }))).mockReturnValue(of(row({ language: 'en', languageSource: 'merchant_set', effectiveLanguage: 'en' })));
    const { fixture, el, select } = await setup({ getCustomerLanguage });
    expect(text(el)).toContain('Something went wrong. Please try again.');
    expect(select()).toBeNull();
    el.querySelector<HTMLButtonElement>('button')!.click();
    await settle(fixture);
    expect(getCustomerLanguage).toHaveBeenCalledTimes(2);
    expect(select()!.value).toBe('en');
  });

  it('reloads when another customer is selected and ignores a late answer for the previous one', async () => {
    const first = new Subject<CustomerLanguageRow>();
    const getCustomerLanguage = vi.fn((id: string) => (id === 'c1' ? first : of(row({ id: 'c2', language: 'en', languageSource: 'merchant_set', effectiveLanguage: 'en' }))));
    const { fixture, select } = await setup({ getCustomerLanguage });
    fixture.componentInstance.id.set('c2');
    await settle(fixture);
    expect(getCustomerLanguage).toHaveBeenCalledWith('c2');
    expect(select()!.value).toBe('en');
    first.next(row({ language: 'ar' }));
    await settle(fixture);
    expect(select()!.value).toBe('en');
  });

  it('stays English when the stored UI language is Arabic (no Arabic text leaks into the English profile)', async () => {
    const { el, select } = await setup({ getCustomerLanguage: vi.fn(() => of(row({ language: 'ar', languageSource: 'merchant_set' }))) }, 'ar');
    expect(select()).not.toBeNull();
    expect(text(el)).toContain('Message language');
    expect(text(el)).not.toMatch(/\p{Script=Arabic}/u);
  });
});
