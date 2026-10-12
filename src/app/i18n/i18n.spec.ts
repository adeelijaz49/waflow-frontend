import { Component, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { LocaleFormatService } from './locale-format.service';
import { CatalogMap, Lang } from './i18n.types';
import { containsArabic, detectDir, isolateLtr, needsLtrProtection, wrapLtr } from './bidi';
import { I18N_DIRECTIVES, I18N_PIPES } from './index';

const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const LRM = String.fromCodePoint(0x200e);

// Test-only access to the loaded tables, so a key can exist in English only.
function tablesOf(service: I18nService): WritableSignal<Record<Lang, CatalogMap>> {
  return (service as unknown as { tables: WritableSignal<Record<Lang, CatalogMap>> }).tables;
}

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(async () => {
    localStorage.clear();
    i18n = TestBed.inject(I18nService);
    await i18n.init();
  });

  it('defaults to English / left-to-right and loads the real catalogues', () => {
    expect(i18n.lang()).toBe('en');
    expect(i18n.dir()).toBe('ltr');
    expect(i18n.t('common.save')).toBe('Save');
  });

  it('switches to Arabic: text and direction change, nothing is a raw key', async () => {
    await i18n.use('ar', false);
    expect(i18n.lang()).toBe('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(i18n.isArabic()).toBe(true);
    expect(i18n.t('common.save')).toBe('حفظ');
    expect(i18n.t('hub.title')).not.toBe('hub.title');
  });

  it('every English key has an Arabic counterpart (Arabic never falls back silently)', async () => {
    await i18n.use('ar', false);
    const tables = tablesOf(i18n)();
    const missing = Object.keys(tables.en).filter((k) => tables.ar[k] === undefined);
    expect(missing).toEqual([]);
  });

  it('falls back to English for a key that only exists in English, and to the key itself when unknown', async () => {
    tablesOf(i18n).update((t) => ({ ...t, en: { ...t.en, 'test.englishOnly': 'English only' } }));
    await i18n.use('ar', false);
    expect(i18n.t('test.englishOnly')).toBe('English only');
    expect(i18n.t('test.nothingHere')).toBe('test.nothingHere');
  });

  it('uses the six CLDR plural categories in Arabic', async () => {
    await i18n.use('ar', false); // load first: loading replaces the table, so inject test keys afterwards
    tablesOf(i18n).update((t) => ({
      ...t,
      ar: {
        ...t.ar,
        'test.n_zero': 'zero',
        'test.n_one': 'one',
        'test.n_two': 'two',
        'test.n_few': 'few',
        'test.n_many': 'many',
        'test.n_other': 'other',
      },
    }));
    const pick = (n: number) => i18n.tp('test.n', n);
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102].map(pick)).toEqual(['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other']);
  });

  it('English plurals use one/other and pass the count as {count}', () => {
    tablesOf(i18n).update((t) => ({ ...t, en: { ...t.en, 'test.c_one': '{count} customer', 'test.c_other': '{count} customers' } }));
    expect(i18n.tp('test.c', 1)).toBe('1 customer');
    expect(i18n.tp('test.c', 5)).toBe('5 customers');
  });

  it('isolates Latin names and numbers placed inside Arabic text, but leaves English text alone', async () => {
    await i18n.use('ar', false); // load first: loading replaces the table, so inject test keys afterwards
    tablesOf(i18n).update((t) => ({
      ...t,
      en: { ...t.en, 'test.hello': 'Hello {name}' },
      ar: { ...t.ar, 'test.hello': 'مرحباً {name}' },
    }));
    expect(i18n.t('test.hello', { name: 'Sara' }, 'en')).toBe('Hello Sara');
    expect(i18n.t('test.hello', { name: 'Sara' })).toBe(`مرحباً ${LRI}Sara${PDI}`);
    expect(i18n.t('test.hello', { name: 'سارة' })).toBe('مرحباً سارة');
    expect(i18n.t('test.hello', { name: '50 SAR' })).toBe(`مرحباً ${LRI}50 SAR${PDI}`);
  });

  it('remembers the chosen language when persisting, and survives unavailable storage', async () => {
    await i18n.use('ar');
    expect(localStorage.getItem('waflow_ui_language')).toBe('ar');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    await expect(i18n.use('en')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('I18nService catalogue download failures', () => {
  it('does not cache a failed download: init can be retried and then succeeds', async () => {
    localStorage.clear();
    const service = TestBed.inject(I18nService);
    const spy = vi
      .spyOn(service as unknown as { fetchCatalog: (l: Lang) => Promise<CatalogMap> }, 'fetchCatalog')
      .mockRejectedValueOnce(new Error('chunk load failed'));
    await expect(service.init()).rejects.toThrow('chunk load failed');
    expect(service.ready()).toBe(false);
    await service.init(); // second attempt downloads again
    expect(service.ready()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(service.t('common.close')).not.toBe('common.close');
  });
});

describe('LocaleFormatService', () => {
  let i18n: I18nService;
  let fmt: LocaleFormatService;

  beforeEach(async () => {
    localStorage.clear();
    i18n = TestBed.inject(I18nService);
    fmt = TestBed.inject(LocaleFormatService);
    await i18n.init();
  });

  it('uses Western digits and Gregorian dates in Arabic', async () => {
    await i18n.use('ar', false);
    const number = fmt.number(1234.5);
    expect(number).not.toMatch(/[٠-٩]/);
    expect(number).toMatch(/1.?234/);
    const date = fmt.date(new Date('2026-10-11T12:00:00Z'), 'long');
    expect(date).toMatch(/2026/);
    expect(date).not.toMatch(/1448|١٤٤٨/); // never the Hijri year
    expect(date).not.toMatch(/[٠-٩]/);
  });

  it('emits dates without implicit direction marks so an LTR isolate cannot scramble them', async () => {
    await i18n.use('ar', false);
    const marks = new RegExp('[' + [0x200e, 0x200f, 0x61c].map((c) => String.fromCodePoint(c)).join('') + ']');
    const d = new Date(2026, 9, 12, 14, 5);
    for (const out of [fmt.date(d, 'short'), fmt.date(d, 'medium'), fmt.date(d, 'long'), fmt.time(d), fmt.dateTime(d)]) {
      expect(out).not.toMatch(marks);
    }
    expect(fmt.date(d, 'short')).toBe('12/10/2026');
    expect(fmt.date(d, 'medium')).toMatch(/^12 [^ 0-9]+ 2026$/);
    expect(fmt.dateTime(d)).toMatch(/2026/);
  });

  it('reports ready once the catalogues are loaded', async () => {
    expect(i18n.ready()).toBe(true);
  });

  it('formats SAR the way each language reads it', async () => {
    expect(fmt.currency(150)).toBe('SAR 150.00');
    await i18n.use('ar', false);
    expect(fmt.currency(150)).toBe('150.00 ر.س');
    expect(fmt.currency(null)).toBe('');
  });

  it('keeps phone numbers left-to-right', async () => {
    await i18n.use('ar', false);
    expect(fmt.phone('966 50 123 4567')).toBe(`${LRM}+966501234567${LRM}`);
    expect(fmt.phone('')).toBe('');
  });

  it('tolerates empty and invalid values', () => {
    expect(fmt.number(undefined)).toBe('');
    expect(fmt.number('abc')).toBe('');
    expect(fmt.date('not a date')).toBe('');
    expect(fmt.percent(15)).toBe('15%');
  });

  it('formats a date with time without throwing (no timeStyle + date-field mix)', () => {
    expect(fmt.dateTime('2026-10-12T09:05:00Z').length).toBeGreaterThan(8);
    expect(fmt.dateTime('2026-10-12T09:05:00Z', 'ar').length).toBeGreaterThan(8);
  });
});

describe('bidi helpers', () => {
  it('detects Arabic and decides when a value needs left-to-right protection', () => {
    expect(containsArabic('مرحبا')).toBe(true);
    expect(containsArabic('hello 123')).toBe(false);
    expect(needsLtrProtection('50 SAR')).toBe(true);
    expect(needsLtrProtection('سارة')).toBe(false);
    expect(needsLtrProtection('')).toBe(false);
    expect(isolateLtr('x')).toBe(`${LRI}x${PDI}`);
    expect(wrapLtr('x')).toBe(`${LRM}x${LRM}`);
  });

  it('guesses the base direction like dir="auto"', () => {
    expect(detectDir('مرحبا Sara')).toBe('rtl');
    expect(detectDir('Sara مرحبا')).toBe('ltr');
    expect(detectDir('123 !!')).toBe('ltr');
    expect(detectDir(null)).toBe('ltr');
  });
});

@Component({
  selector: 'app-i18n-host',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  template: `
    <span id="user" appUserText>name</span>
    <span id="phone" appPhone>+966</span>
    <div id="ar" [appLangDir]="'ar'"></div>
    <div id="en" [appLangDir]="'en'"></div>
    <div id="none" [appLangDir]="null"></div>
    <b id="piped">{{ 'common.save' | t }}</b>
  `,
})
class HostComponent {}

describe('directives and pipes', () => {
  it('apply dir/lang attributes and translate in templates', async () => {
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#user')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('#phone')?.getAttribute('dir')).toBe('ltr');
    expect(el.querySelector('#ar')?.getAttribute('dir')).toBe('rtl');
    expect(el.querySelector('#ar')?.getAttribute('lang')).toBe('ar');
    expect(el.querySelector('#en')?.getAttribute('dir')).toBe('ltr');
    expect(el.querySelector('#none')?.getAttribute('lang')).toBe('en');
    expect(el.querySelector('#piped')?.textContent).toBe('Save');

    await i18n.use('ar', false);
    fixture.detectChanges();
    expect(el.querySelector('#piped')?.textContent).toBe('حفظ'); // impure pipe follows the language
  });
});
