import { Directive, effect, inject, input, signal, untracked } from '@angular/core';
import { I18nService, Lang } from '../../../i18n';

// Base class of every component that is embedded in an EXISTING (English, left-to-right) screen.
//  * All text comes from the i18n catalogues, rendered in `uiLang` (default 'en'), NEVER in the active
//    UI language: an owner whose stored language is Arabic must not see Arabic labels leak into the
//    English dashboard. Arabic MESSAGE text (what the customer receives) is separate and always shown
//    with lang="ar" dir="rtl".
//  * Only the languages in use are downloaded (never the Arabic catalogue on an English screen).
//  * `ready` flips true once the catalogue really contains our keys; until then the component renders
//    nothing, so a raw key can never flash.
@Directive()
export abstract class EmbeddedText {
  protected readonly i18n = inject(I18nService);
  readonly uiLang = input<Lang>('en');
  readonly ready = signal(false);

  constructor() {
    effect(() => {
      const lang = this.uiLang();
      untracked(() => this.loadCatalogues(lang));
    });
  }

  private loadCatalogues(lang: Lang): void {
    const jobs: Promise<void>[] = [this.i18n.ensureLoaded('en')];
    if (lang !== 'en') jobs.push(this.i18n.ensureLoaded(lang));
    Promise.all(jobs).then(
      () => this.ready.set(this.i18n.has('promolang.title', 'en') && this.i18n.has('flowlang.title', 'en')),
      () => this.ready.set(false),
    );
  }

  t(key: string, params?: Record<string, string | number | null | undefined>): string {
    return this.i18n.t(key, params, this.uiLang());
  }

  tp(key: string, count: number, params?: Record<string, string | number | null | undefined>): string {
    return this.i18n.tp(key, count, params, this.uiLang());
  }

  has(key: string): boolean {
    return this.i18n.has(key, 'en') || this.i18n.has(key, this.uiLang());
  }
}
