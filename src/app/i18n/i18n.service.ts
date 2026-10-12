import { Injectable, computed, signal } from '@angular/core';
import { loadCatalog } from './catalogs';
import { isolateLtr, needsLtrProtection } from './bidi';
import { CatalogMap, Dir, Lang, TranslateParams, dirOf, isLang } from './i18n.types';

const STORAGE_KEY = 'waflow_ui_language';
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// Translation service for the Arabic localisation feature (Phase 0).
//  * English is the default and the fallback for any missing Arabic string.
//  * Pages that use it scope `lang`/`dir` to their own root element — the
//    existing dashboard stays English/LTR until the (gated) Phase 5.
//  * Latin / number parameters placed inside Arabic text are wrapped in a
//    directional isolate so "50 SAR" and names never reorder.
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>('en');
  readonly dir = computed<Dir>(() => dirOf(this.lang()));
  readonly isArabic = computed(() => this.lang() === 'ar');
  // True once the English fallback and the active catalogue are loaded; shells
  // gate their first paint on it so no raw key flashes.
  readonly ready = signal(false);

  private readonly tables = signal<Record<Lang, CatalogMap>>({ en: {}, ar: {} });
  private readonly loading = new Map<Lang, Promise<void>>();
  private initPromise?: Promise<void>;
  private readonly warned = new Set<string>();

  constructor() {
    this.lang.set(this.readStored());
  }

  // Idempotent: loads English (the fallback) and the active language.
  init(): Promise<void> {
    this.initPromise ??= this.ensureLoaded('en')
      .then(() => this.ensureLoaded(this.lang()))
      .then(() => this.ready.set(true))
      .catch((err: unknown) => {
        this.initPromise = undefined; // a failed download (offline, stale deploy) can be retried
        throw err;
      });
    return this.initPromise;
  }

  // Switch the UI language of the localisation pages.
  async use(lang: Lang, persist = true): Promise<void> {
    await this.ensureLoaded('en');
    await this.ensureLoaded(lang);
    this.lang.set(lang);
    if (persist) this.store(lang);
  }

  ensureLoaded(lang: Lang): Promise<void> {
    let p = this.loading.get(lang);
    if (!p) {
      p = this.fetchCatalog(lang)
        .then((table) => {
          this.tables.update((t) => ({ ...t, [lang]: table }));
        })
        .catch((err: unknown) => {
          this.loading.delete(lang); // never cache a failure: the next call downloads again
          throw err;
        });
      this.loading.set(lang, p);
    }
    return p;
  }

  protected fetchCatalog(lang: Lang): Promise<CatalogMap> {
    return loadCatalog(lang);
  }

  has(key: string, lang: Lang = this.lang()): boolean {
    return Object.prototype.hasOwnProperty.call(this.tables()[lang], key);
  }

  // Translate a key: active language -> English -> the key itself.
  t(key: string, params?: TranslateParams, lang: Lang = this.lang()): string {
    const tables = this.tables();
    const inLang = tables[lang][key];
    const raw = inLang ?? tables['en'][key];
    if (raw === undefined) {
      this.warnMissing(key);
      return key;
    }
    const usedLang: Lang = inLang !== undefined ? lang : 'en';
    return params ? this.interpolate(raw, params, usedLang) : raw;
  }

  // Plural-aware: picks "<key>_zero|one|two|few|many|other" using the CLDR
  // plural rules of the active language (Arabic has six categories).
  tp(key: string, count: number, params?: TranslateParams, lang: Lang = this.lang()): string {
    const category = new Intl.PluralRules(lang === 'ar' ? 'ar' : 'en').select(count);
    const candidates = [`${key}_${category}`, `${key}_other`, key];
    const found = candidates.find((k) => this.has(k, lang) || this.has(k, 'en')) ?? key;
    return this.t(found, { count, ...(params ?? {}) }, lang);
  }

  private interpolate(template: string, params: TranslateParams, lang: Lang): string {
    return template.replace(PLACEHOLDER, (match, name: string) => {
      const value = params[name];
      if (value === undefined || value === null) return match;
      const text = String(value);
      return lang === 'ar' && needsLtrProtection(text) ? isolateLtr(text) : text;
    });
  }

  private warnMissing(key: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    // Visible in the console during development; never throws in production.
    console.warn(`[i18n] missing translation key: ${key}`);
  }

  private readStored(): Lang {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return isLang(v) ? v : 'en';
    } catch {
      return 'en';
    }
  }

  private store(lang: Lang): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable (private mode) — the language simply isn't remembered */
    }
  }
}
