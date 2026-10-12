import { Component, computed, input } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, Lang } from '../../../i18n';
import type { BilingualOrder, MessageLanguage, TemplateButton } from '../localization.types';

// WhatsApp-style preview of ONE message as the CUSTOMER receives it. The phone
// frame takes the customer's language direction, so an Arabic message sits on
// the right with the tail on the right, exactly like WhatsApp on an Arabic
// phone; each paragraph additionally gets dir="auto" so mixed Arabic/English
// (and bilingual messages) read correctly. All geometry is logical.
@Component({
  selector: 'app-wa-preview',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './wa-preview.html',
  styleUrl: './wa-preview.css',
})
export class WaPreview {
  readonly language = input<MessageLanguage>('en');
  readonly bilingualOrder = input<BilingualOrder | null>(null);
  readonly header = input<string>('');
  readonly body = input<string>('');
  readonly footer = input<string>('');
  readonly buttons = input<TemplateButton[]>([]);
  readonly senderName = input<string>('');
  readonly time = input<string>('');
  // Override the phone direction (e.g. "preview as an English customer").
  readonly phoneLanguage = input<Lang | null>(null);
  // Force the language of the UI labels ("nothing to preview"); undefined = the active UI language.
  readonly uiLang = input<Lang | undefined>(undefined);

  readonly frameLang = computed<Lang>(() => {
    const forced = this.phoneLanguage();
    if (forced) return forced;
    const lang = this.language();
    if (lang === 'ar') return 'ar';
    if (lang === 'bilingual') return this.bilingualOrder() === 'en_first' ? 'en' : 'ar';
    return 'en';
  });

  readonly paragraphs = computed<string[]>(() => this.body().split(/\n{2,}/).filter((p) => p.trim().length > 0));
  readonly hasContent = computed(() => !!(this.header() || this.body() || this.footer()));
}
