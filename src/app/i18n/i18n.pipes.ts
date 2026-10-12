import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';
import { DateStyle, LocaleFormatService } from './locale-format.service';
import { Lang, TranslateParams } from './i18n.types';

// Impure on purpose: the output depends on the active language (a signal), and
// a pure pipe would keep showing the old language after a switch.

@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(key: string, params?: TranslateParams, lang?: Lang): string {
    return this.i18n.t(key, params, lang);
  }
}

@Pipe({ name: 'tp', pure: false })
export class PluralPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);
  transform(key: string, count: number, params?: TranslateParams): string {
    return this.i18n.tp(key, count, params);
  }
}

@Pipe({ name: 'locNumber', pure: false })
export class LocNumberPipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);
  transform(value: number | string | null | undefined, options?: Intl.NumberFormatOptions): string {
    return this.fmt.number(value, options);
  }
}

@Pipe({ name: 'locCurrency', pure: false })
export class LocCurrencyPipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);
  transform(value: number | string | null | undefined, currency = 'SAR'): string {
    return this.fmt.currency(value, currency);
  }
}

@Pipe({ name: 'locDate', pure: false })
export class LocDatePipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);
  transform(value: Date | string | number | null | undefined, style: DateStyle = 'medium'): string {
    return this.fmt.date(value, style);
  }
}

@Pipe({ name: 'locDateTime', pure: false })
export class LocDateTimePipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);
  transform(value: Date | string | number | null | undefined): string {
    return this.fmt.dateTime(value);
  }
}

@Pipe({ name: 'locPhone', pure: false })
export class LocPhonePipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);
  transform(value: string | null | undefined): string {
    return this.fmt.phone(value);
  }
}

export const I18N_PIPES = [
  TranslatePipe, PluralPipe, LocNumberPipe, LocCurrencyPipe, LocDatePipe, LocDateTimePipe, LocPhonePipe,
] as const;
