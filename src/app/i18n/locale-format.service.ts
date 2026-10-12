import { Injectable } from '@angular/core';
import { I18nService } from './i18n.service';
import { isolateLtr, wrapLtr } from './bidi';
import { Lang } from './i18n.types';

// Locale-aware formatting (Phase 0): currency (SAR), numbers, dates, phone
// numbers. Decisions from the spec: WESTERN digits by default, GREGORIAN dates
// only, SAR currency, phone numbers always left-to-right.
const LOCALE: Record<Lang, string> = {
  en: 'en-GB',
  // -u-nu-latn = Western digits, -u-ca-gregory = Gregorian (ar-SA would
  // otherwise default to the Islamic Umm al-Qura calendar).
  ar: 'ar-SA-u-nu-latn-ca-gregory',
};

export type DateStyle = 'short' | 'medium' | 'long';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
};

// Implicit direction marks (LRM U+200E, RLM U+200F, ALM U+061C) that Intl puts
// around numerals; built from code points so the source stays plain ASCII.
const IMPLICIT_MARKS = new RegExp('[' + [0x200e, 0x200f, 0x61c].map((c) => String.fromCodePoint(c)).join('') + ']', 'g');

@Injectable({ providedIn: 'root' })
export class LocaleFormatService {
  constructor(private i18n: I18nService) {}

  locale(lang: Lang = this.i18n.lang()): string {
    return LOCALE[lang];
  }

  number(value: number | string | null | undefined, options?: Intl.NumberFormatOptions, lang: Lang = this.i18n.lang()): string {
    const n = this.toNumber(value);
    if (n === null) return '';
    return new Intl.NumberFormat(this.locale(lang), options).format(n);
  }

  percent(value: number | string | null | undefined, lang: Lang = this.i18n.lang()): string {
    const n = this.toNumber(value);
    if (n === null) return '';
    return `${this.number(n, { maximumFractionDigits: 1 }, lang)}%`;
  }

  // English: "SAR 50.00". Arabic: "50.00 ر.س" — the website's style (number, space,
  // ر.س, no trailing dot). Other currencies keep their ISO code, isolated
  // left-to-right so "50.00 AED" never reorders inside an Arabic sentence.
  currency(value: number | string | null | undefined, currency = 'SAR', lang: Lang = this.i18n.lang()): string {
    const n = this.toNumber(value);
    if (n === null) return '';
    const amount = this.number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, lang);
    if (lang !== 'ar') return `${currency} ${amount}`;
    return currency === 'SAR' ? `${amount} ر.س` : isolateLtr(`${amount} ${currency}`);
  }

  // Dates: 'short' is an explicit dd/MM/yyyy, 'medium' a day + month name
  // (12 Oct 2026 / the Arabic month name, unambiguous), 'long' the full month.
  // Intl's ar-SA output embeds RLM marks between the numeric parts, which
  // scramble the date once an LTR isolate wraps it, so they are stripped.
  date(value: Date | string | number | null | undefined, style: DateStyle = 'medium', lang: Lang = this.i18n.lang()): string {
    const d = this.toDate(value);
    if (!d) return '';
    return this.clean(new Intl.DateTimeFormat(this.locale(lang), DATE_OPTIONS[style]).format(d));
  }

  time(value: Date | string | number | null | undefined, lang: Lang = this.i18n.lang()): string {
    const d = this.toDate(value);
    if (!d) return '';
    return this.clean(new Intl.DateTimeFormat(this.locale(lang), { timeStyle: 'short' }).format(d));
  }

  dateTime(value: Date | string | number | null | undefined, lang: Lang = this.i18n.lang()): string {
    const d = this.toDate(value);
    if (!d) return '';
    return this.clean(new Intl.DateTimeFormat(this.locale(lang), { ...DATE_OPTIONS.medium, hour: 'numeric', minute: '2-digit' }).format(d));
  }

  // Phone numbers ALWAYS read left-to-right, even inside Arabic text.
  phone(value: string | null | undefined): string {
    if (!value) return '';
    const digits = String(value).replace(/[^\d+]/g, '');
    const text = digits ? (digits.startsWith('+') ? digits : `+${digits}`) : String(value);
    return wrapLtr(text);
  }

  private clean(text: string): string {
    return text.replace(IMPLICIT_MARKS, '');
  }

  private toNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  private toDate(value: Date | string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
