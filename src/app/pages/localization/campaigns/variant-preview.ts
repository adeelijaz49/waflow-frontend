import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { LanguageMode, LocalizedTemplate, MessageLanguage, RenderedPreview } from '../localization.types';
import { errorText } from '../shared/loc-errors';
import { WaPreview } from '../shared/wa-preview';

export type PreviewAs = 'ar' | 'en' | 'both';
const DEBOUNCE_MS = 450;

interface PreviewCard { language: MessageLanguage; rendered: RenderedPreview | null; absent: boolean }

// "Preview as an Arabic / English customer": renders the template's own variants through the
// server (exactly what would be sent) with the field values typed in the composer.
@Component({
  selector: 'app-campaign-variant-preview',
  imports: [...I18N_PIPES, WaPreview],
  templateUrl: './variant-preview.html',
  styleUrl: './variant-preview.css',
})
export class VariantPreview {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);

  readonly template = input.required<LocalizedTemplate>();
  readonly mode = input.required<LanguageMode>();
  readonly fieldValues = input<Record<string, string>>({});

  readonly options: PreviewAs[] = ['ar', 'en', 'both'];
  readonly viewAs = signal<PreviewAs>('both');
  readonly cards = signal<PreviewCard[]>([]);
  readonly error = signal('');

  constructor() {
    effect((onCleanup) => {
      const template = this.template();
      const mode = this.mode();
      const values = this.fieldValues();
      const as = this.viewAs();
      let sub: Subscription | undefined;
      const timer = setTimeout(() => (sub = untracked(() => this.load(template, this.languages(mode, as), values))), DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(timer);
        sub?.unsubscribe();
      });
    });
  }

  private languages(mode: LanguageMode, as: PreviewAs): MessageLanguage[] {
    if (mode !== 'per_customer') return [mode];
    return as === 'both' ? ['ar', 'en'] : [as];
  }

  private load(template: LocalizedTemplate, languages: MessageLanguage[], values: Record<string, string>): Subscription {
    const cards: PreviewCard[] = languages.map((language) => ({ language, rendered: null, absent: !template.variants.some((v) => v.language === language) }));
    this.cards.set(cards);
    this.error.set('');
    const sub = new Subscription();
    for (const card of cards) {
      if (card.absent) continue;
      const v = template.variants.find((x) => x.language === card.language)!;
      sub.add(
        this.api.previewVariant({
          variant: { language: v.language, header: v.header, body: v.body, footer: v.footer, buttons: v.buttons, bilingualOrder: v.bilingualOrder ?? undefined },
          fieldValues: values,
        }).subscribe({
          next: (rendered) => this.cards.update((list) => list.map((c) => (c.language === card.language ? { ...c, rendered } : c))),
          error: (err) => this.error.set(errorText(this.i18n, err, 'campaigns.preview.failed')),
        }),
      );
    }
    return sub;
  }
}
