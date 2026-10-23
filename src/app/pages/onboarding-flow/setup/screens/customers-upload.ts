import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { LocalizationFlagService } from '../../../../services/localization-flag.service';
import { buildCustomerTemplateCsv, decodeCsvBytes, downloadCsv, parseCustomerFileText, readFileBytes } from '../../customers/csv';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { checkChosenFile, CUSTOMER_URLS, CustomersListBase, FULL_IMPORT_URL } from './onb-c-kit';
import { OnbPhoneNote } from './onb-phone-note';

// Customers prompt, screen U: "Upload your customer list". Reads the CSV here (BOM, comma / semicolon / tab, quotes, Arabic text),
// never uploads it as it is: the rows are re-built per opt-in group by CustomersFlowService.
@Component({
  selector: 'app-onb-customers-upload',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, OnbPhoneNote, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.customers.stepName" onbStep="customers">{{ 'onboarding.customers.upload.title' | t }}</h1>
      <p class="onb-lead">{{ 'onboarding.customers.upload.body' | t }}</p>
      <p class="onb-muted" id="onb-cust-columns">{{ (flag.arabicEnabled() ? 'onboarding.customers.upload.columnsLang' : 'onboarding.customers.upload.columns') | t }}</p>
      <app-onb-phone-note [country]="businessCountry()" />
      <div>
        <button type="button" class="onb-link" id="onb-cust-template" (click)="downloadTemplate()">{{ 'onboarding.customers.upload.template' | t }}</button>
      </div>
      <div>
        <input id="onb-cust-file" class="onb-prompt-file" type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain" (change)="onFile($event)" />
        <label for="onb-cust-file" class="onb-btn onb-btn-secondary">{{ 'onboarding.customers.upload.choose' | t }}</label>
        @if (fileName(); as n) {
          <p class="onb-prompt-file-name" id="onb-cust-file-name" appUserText>{{ n }}</p>
        }
      </div>
      @if (hint() === 'xlsx') {
        <div class="onb-alert onb-alert-info" role="alert" tabindex="-1" id="onb-cust-hint">
          <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
          <div class="onb-stack onb-tight">
            <span>{{ 'onboarding.customers.upload.xlsx' | t }}</span>
            <a class="onb-link" [routerLink]="fullImport" [queryParams]="{ entityType: 'customer' }">{{ 'onboarding.customers.upload.full' | t }}</a>
          </div>
        </div>
      }
      @if (columnHint(); as c) {
        <div class="onb-alert onb-alert-warn" role="alert" tabindex="-1" id="onb-cust-hint">
          <span class="onb-alert-icon" aria-hidden="true">!</span>
          <div class="onb-stack onb-tight">
            <span>{{ (c === 'noPhone' ? 'onboarding.customers.upload.noPhone' : 'onboarding.customers.upload.noName') | t }}</span>
            <a class="onb-link" [routerLink]="fullImport" [queryParams]="{ entityType: 'customer' }">{{ 'onboarding.customers.upload.full' | t }}</a>
          </div>
        </div>
      }
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" id="onb-cust-check" class="onb-btn onb-btn-primary" [disabled]="!file() || busy()" [attr.aria-busy]="busy()" (click)="check()">{{ 'onboarding.customers.upload.check' | t }}</button>
        <div class="onb-bar-links">
          <button type="button" class="onb-link" (click)="open(urls.method)">{{ 'onboarding.common.back' | t }}</button>
          <app-onb-help />
        </div>
      </div>
    </section>
  `,
})
export class CustomersUploadScreen extends CustomersListBase {
  readonly urls = CUSTOMER_URLS;
  readonly fullImport = FULL_IMPORT_URL;
  readonly flag = inject(LocalizationFlagService);
  readonly file = signal<File | null>(null);
  readonly fileName = computed(() => this.file()?.name ?? null);
  readonly hint = signal<'xlsx' | null>(null);

  constructor() {
    super();
    effect(() => {
      if (this.hint() !== null || this.columnHint() !== null) {
        untracked(() => setTimeout(() => document.getElementById('onb-cust-hint')?.focus()));
      }
    });
  }

  onFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    this.hint.set(null);
    this.columnHint.set(null);
    this.clearError();
  }

  /** The client-generated template (opt-in / source / date columns; Language only when Arabic is on for the workspace). */
  downloadTemplate(): void {
    try {
      downloadCsv(buildCustomerTemplateCsv(this.flag.arabicEnabled()), 'customers-template.csv');
    } catch (err) {
      this.fail(err);
    }
  }

  async check(): Promise<void> {
    const f = this.file();
    if (!f || this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.hint.set(null);
    this.columnHint.set(null);
    this.announcer.say('onboarding.common.loading');
    const verdict = checkChosenFile(f);
    if (verdict === 'xlsx') {
      this.hint.set('xlsx');
      this.busy.set(false);
      this.announcer.say('onboarding.customers.upload.xlsx');
      return;
    }
    if (verdict) {
      this.fail({ code: verdict });
      return;
    }
    let text: string;
    try {
      text = decodeCsvBytes(await readFileBytes(f));
    } catch {
      this.fail({ code: 'ONB_IMPORT_BAD_FILE' });
      return;
    }
    this.accept(parseCustomerFileText(text, { country: this.businessCountry() }), f.name);
  }
}
