import { Component, input } from '@angular/core';
import { I18N_PIPES } from '../../../i18n';
import type { CustomerLang, MessageLanguage } from '../localization.types';

// Small language chip: "English" / "Arabic" / "Bilingual" / "Unknown",
// localised, with the global .loc-lang-pill styling from loc-shared.css.
// An optional count renders inside the chip ("Arabic · 9") so the number
// can never wrap away from its language.
@Component({
  selector: 'app-lang-pill',
  imports: [...I18N_PIPES],
  template: `<span class="loc-lang-pill" [class.ar]="lang() === 'ar'">{{ ('status.language.' + lang()) | t }}@if (count() !== null) { <span aria-hidden="true">{{ "·" }}</span> <span>{{ count() | locNumber }}</span> }</span>`,
})
export class LangPill {
  readonly lang = input<MessageLanguage | CustomerLang>('en');
  readonly count = input<number | null>(null);
}
