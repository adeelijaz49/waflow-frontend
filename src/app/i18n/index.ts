// Public surface of the localisation foundation (Phase 0). Pages import from here.
export * from './i18n.types';
export * from './bidi';
export { I18nService } from './i18n.service';
export { LocaleFormatService } from './locale-format.service';
export type { DateStyle } from './locale-format.service';
export {
  TranslatePipe, PluralPipe, LocNumberPipe, LocCurrencyPipe, LocDatePipe, LocDateTimePipe, LocPhonePipe, I18N_PIPES,
} from './i18n.pipes';
export { UserTextDirective, PhoneDirective, LangDirDirective, I18N_DIRECTIVES } from './i18n.directives';
