// Shared types for the Arabic localisation feature (see src/app/i18n/*).
export type Lang = 'en' | 'ar';
export type Dir = 'ltr' | 'rtl';
export type CatalogMap = Record<string, string>;
export type TranslateParams = Record<string, string | number | null | undefined>;

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'ar'] as const;

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ar';
}

export function dirOf(lang: Lang): Dir {
  return lang === 'ar' ? 'rtl' : 'ltr';
}
