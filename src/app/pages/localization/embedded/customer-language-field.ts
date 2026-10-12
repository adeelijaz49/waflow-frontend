import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CustomerLang, CustomerLanguageRow } from '../localization.types';
import { errorCode, errorStatus, errorText } from '../shared/loc-errors';
import { EmbeddedText } from './embedded-text';

type LoadState = 'loading' | 'ready' | 'hidden' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// "Message language" row inside the existing customer profile (Customers page), shown to FLAGGED merchants
// only (the host page wraps it in an @if). It reads the customer's language with one GET and saves a change
// with the hub's existing PUT: nothing else about the profile is read or written. A 402/404 hides the row;
// any other load error shows an inline retry. Text is English (EmbeddedText), the profile is not translated.
@Component({
  selector: 'app-customer-language-field',
  imports: [RouterLink],
  templateUrl: './customer-language-field.html',
  styleUrl: './customer-language-field.css',
})
export class CustomerLanguageField extends EmbeddedText {
  private readonly api = inject(LocalizationApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerId = input.required<string>();

  readonly languages: CustomerLang[] = ['unknown', 'en', 'ar'];
  readonly row = signal<CustomerLanguageRow | null>(null);
  readonly state = signal<LoadState>('loading');
  readonly saveState = signal<SaveState>('idle');
  readonly errorMessage = signal('');
  // Unique per customer so the visible label stays tied to its select when the panel switches customer.
  readonly selectId = computed(() => `cust-lang-${this.customerId()}`);

  readonly sourceText = computed(() => {
    const r = this.row();
    return r && r.language !== 'unknown' && r.languageSource ? this.t(`status.source.${r.languageSource}`) : '';
  });
  readonly effectiveText = computed(() => {
    const r = this.row();
    return r && r.language === 'unknown' ? this.t('customers.effective', { language: this.t(`status.language.${r.effectiveLanguage}`) }) : '';
  });

  private seq = 0;

  constructor() {
    super();
    effect(() => {
      const id = this.customerId();
      untracked(() => this.load(id));
    });
  }

  optionLabel(lang: CustomerLang): string {
    return lang === 'unknown' ? this.t('embedded.customerLanguage.notSet') : this.t(`status.language.${lang}`);
  }

  retry(): void {
    this.load(this.customerId());
  }

  private load(id: string): void {
    const seq = ++this.seq;
    this.row.set(null);
    this.state.set('loading');
    this.saveState.set('idle');
    this.errorMessage.set('');
    this.api.getCustomerLanguage(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        if (seq !== this.seq) return;
        this.row.set(r);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        if (seq !== this.seq) return;
        const status = errorStatus(err);
        const hide = status === 402 || status === 404 || errorCode(err) === 'ARABIC_NOT_ENABLED';
        this.errorMessage.set(hide ? '' : errorText(this.i18n, err, 'errors.generic', 'en'));
        this.state.set(hide ? 'hidden' : 'error');
      },
    });
  }

  change(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const current = this.row();
    const language = select.value as CustomerLang;
    if (!current || language === current.language || this.saveState() === 'saving') return;
    const seq = this.seq;
    const id = this.customerId();
    this.saveState.set('saving');
    this.errorMessage.set('');
    this.api.setCustomerLanguage(id, language).subscribe({
      next: (updated) => {
        if (seq !== this.seq) return;
        this.row.set(updated);
        this.saveState.set('saved');
      },
      error: (err: unknown) => {
        if (seq !== this.seq) return;
        select.value = current.language;
        this.saveState.set('error');
        this.errorMessage.set(errorText(this.i18n, err, 'errors.generic', 'en'));
      },
    });
  }
}
