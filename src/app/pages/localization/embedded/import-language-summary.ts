import { Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { ImportLocalizationSummary } from '../localization.types';
import { EmbeddedText } from './embedded-text';

// One line under the existing "Import complete" box of the import wizard: what the Arabic side of the
// import did. A CUSTOMER import only ever sets languages (set / unchanged / protected / failed); a PRODUCT
// or SERVICE import only ever saves Arabic texts as drafts (saved / unchanged / failed), so each kind
// prints only its own counters. The backend adds `localization` to the run result ONLY for flagged
// workspaces, so the host renders this inside an @if on that field and unflagged merchants never get it.
// Text is English (EmbeddedText).
type Kind = 'customer' | 'item';

@Component({
  selector: 'app-import-language-summary',
  template: `
    @if (ready() && summary(); as s) {
      <div class="ils">
        @if (kind() === 'customer') {
          <p class="ils-line">{{ t('embedded.importSummary.customer.counts', { set: s.languagesSet ?? 0, unchanged: s.languagesUnchanged ?? 0 }) }}</p>
          @if (s.languagesProtected) {
            <p class="ils-line">{{ t('embedded.importSummary.protected', { count: s.languagesProtected }) }}</p>
          }
          @if (s.languagesFailed) {
            <p class="ils-line ils-bad" role="status">{{ t('embedded.importSummary.customer.failed', { count: s.languagesFailed }) }}</p>
          }
        } @else {
          <p class="ils-line">{{ t('embedded.importSummary.item.counts', { saved: s.translationsSaved ?? 0, unchanged: s.translationsUnchanged ?? 0 }) }}</p>
          @if (s.translationsFailed) {
            <p class="ils-line ils-bad" role="status">{{ t('embedded.importSummary.item.failed', { count: s.translationsFailed }) }}</p>
          }
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-inline-size: 0; }
    .ils { margin-block-start: 8px; text-align: start; }
    .ils-line { margin: 0 0 2px; font-size: 13px; line-height: 1.45; color: var(--text-muted, #64748b); overflow-wrap: anywhere; }
    .ils-bad { color: #92400e; }
  `],
})
export class ImportLanguageSummary extends EmbeddedText {
  readonly summary = input<ImportLocalizationSummary | null | undefined>(null);
  // 'customer' | 'product' | 'service'. Optional: the wizard is reached with ?entityType=..., which is
  // read when the host does not say; with neither, the shape of the summary decides (customers only
  // ever report languages, items only texts).
  readonly entity = input<string | null>(null);

  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly routeEntity: string | null = (() => {
    try { return this.route?.snapshot?.queryParamMap?.get('entityType') ?? null; } catch { return null; }
  })();

  readonly kind = computed<Kind>(() => {
    const e = this.entity() ?? this.routeEntity;
    if (e === 'product' || e === 'service') return 'item';
    if (e === 'customer') return 'customer';
    const s = this.summary();
    const languages = (s?.languagesSet ?? 0) + (s?.languagesUnchanged ?? 0) + (s?.languagesProtected ?? 0) + (s?.languagesFailed ?? 0);
    const texts = (s?.translationsSaved ?? 0) + (s?.translationsUnchanged ?? 0) + (s?.translationsFailed ?? 0);
    return languages === 0 && texts > 0 ? 'item' : 'customer';
  });
}
