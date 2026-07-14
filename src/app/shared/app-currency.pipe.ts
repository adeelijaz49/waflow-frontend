import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { SettingsService } from './settings.service';

// Wraps Angular's CurrencyPipe, reading the merchant's configured currency instead
// of a hardcoded code. impure (pure: false) so it re-renders once SettingsService's
// initial fetch resolves, rather than only formatting with the default before load.
@Pipe({ name: 'appCurrency', standalone: true, pure: false })
export class AppCurrencyPipe implements PipeTransform {
  private settings = inject(SettingsService);
  private currencyPipe = new CurrencyPipe('en-US');

  transform(value: number | string | null | undefined, display: 'symbol' | 'code' | 'symbol-narrow' = 'symbol', digitsInfo = '1.2-2'): string | null {
    return this.currencyPipe.transform(value, this.settings.currencySnapshot, display, digitsInfo);
  }
}
