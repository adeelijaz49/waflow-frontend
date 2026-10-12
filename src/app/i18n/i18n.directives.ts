import { Directive, HostBinding, Input } from '@angular/core';
import { Lang, dirOf } from './i18n.types';

// Marks an element as showing USER-ENTERED text (customer names, product
// names, messages): the browser picks the direction from the text itself, so
// an Arabic name aligns right and an English one left, even in the same list.
@Directive({ selector: '[appUserText]', standalone: true })
export class UserTextDirective {
  @HostBinding('attr.dir') readonly dir = 'auto';
  @HostBinding('class.loc-user-text') readonly cls = true;
}

// Phone numbers always render left-to-right, isolated from surrounding RTL text.
@Directive({ selector: '[appPhone]', standalone: true })
export class PhoneDirective {
  @HostBinding('attr.dir') readonly dir = 'ltr';
  @HostBinding('class.loc-phone') readonly cls = true;
}

// Sets lang + dir on an element from a language code — used on every page
// root and on every preview that shows text in a specific language.
@Directive({ selector: '[appLangDir]', standalone: true })
export class LangDirDirective {
  private current: Lang = 'en';
  @Input('appLangDir') set lang(value: Lang | null | undefined) {
    this.current = value === 'ar' ? 'ar' : 'en';
  }
  @HostBinding('attr.lang') get langAttr(): Lang { return this.current; }
  @HostBinding('attr.dir') get dirAttr(): 'ltr' | 'rtl' { return dirOf(this.current); }
}

export const I18N_DIRECTIVES = [UserTextDirective, PhoneDirective, LangDirDirective] as const;
