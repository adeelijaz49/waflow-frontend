import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { from, map, switchMap, throwError } from 'rxjs';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { ApiService } from '../../../../services/api.service';
import { LocalizationApiService } from '../../../../services/localization-api.service';
import { LocalizationFlagService } from '../../../../services/localization-flag.service';
import { blobToText, downloadBlob, downloadCsv, parseCsvText, toCsv } from '../../customers/csv';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError } from './onb-a-kit';
import { OnbAiNext } from './onb-ai-handoff';
import { checkChosenFile, CUSTOMER_URLS, FULL_IMPORT_URL, PromptScreenBase } from './onb-c-kit';

export type ItemKind = 'product' | 'service';
type Stage = 'form' | 'added' | 'csv' | 'csvPreview' | 'csvResult';

/** `General` is stored data (the API requires a category), never shown as UI copy. */
export const DEFAULT_CATEGORY = 'General';
/** Minutes: the default of the Services page. */
export const DEFAULT_DURATION = 60;

/** A typed price -> a number >= 0, or null. Accepts Arabic-Indic digits and the Arabic decimal separator. */
export function parseItemPrice(raw: unknown): number | null {
  let text = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!text) return null;
  text = text
    .replace(/[\u{660}-\u{669}]/gu, (d) => String((d.codePointAt(0) as number) - 0x660))
    .replace(/[\u{6F0}-\u{6F9}]/gu, (d) => String((d.codePointAt(0) as number) - 0x6f0))
    .replace(/\u{66B}/gu, '.');
  if (!text.includes('.')) text = text.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? n : null;
}

export interface ItemBodyInput { name: string; price: number; description: string; photoUrl: string | null }

/** The request body of one product or service (DF 3.8). */
export function itemBody(kind: ItemKind, input: ItemBodyInput): Record<string, unknown> {
  const base = {
    name: input.name,
    category: DEFAULT_CATEGORY,
    basePrice: input.price,
    description: input.description,
    images: input.photoUrl ? [input.photoUrl] : [],
  };
  return kind === 'service' ? { ...base, duration: DEFAULT_DURATION } : base;
}

interface CsvJob { id: string; clean: number; duplicate: number; error: number }
interface CsvResult { added: number; skipped: number; duplicates: number }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Products or services prompt (DF 3.8): "What do you sell?", one item at a time, or a CSV through the engine's own template.
// Arabic name / description appear only when the workspace has Arabic on (they could not be saved otherwise).
@Component({
  selector: 'app-onb-products',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, OnbAiNext, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css', '../../styles/onb-prompts.css'],
  template: `
    <section class="onb-stack">
      @switch (stage()) {
        @case ('form') {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.products.title" onbStep="products">{{ 'onboarding.products.title' | t }}</h1>
          <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
            <fieldset class="onb-prompt-kinds">
              <legend class="onb-sr">{{ 'onboarding.products.title' | t }}</legend>
              <label class="onb-choice">
                <input type="radio" name="onb-prod-kind" value="product" id="onb-prod-kind-product" [checked]="kind() === 'product'" (change)="setKind('product')" />
                <span class="onb-choice-name">{{ 'onboarding.products.kind.product' | t }}</span>
              </label>
              <label class="onb-choice">
                <input type="radio" name="onb-prod-kind" value="service" id="onb-prod-kind-service" [checked]="kind() === 'service'" (change)="setKind('service')" />
                <span class="onb-choice-name">{{ 'onboarding.products.kind.service' | t }}</span>
              </label>
            </fieldset>
            <div>
              <label class="onb-label" for="onb-prod-name">{{ 'onboarding.products.name' | t }}</label>
              <input id="onb-prod-name" class="onb-input" type="text" appUserText autocomplete="off" enterkeyhint="next" maxlength="120"
                [value]="name()" (input)="onName($event)" [attr.aria-invalid]="nameError() ? 'true' : null" aria-describedby="onb-prod-name-err" />
              @if (nameError()) {
                <p id="onb-prod-name-err" class="onb-field-error" role="alert">{{ 'onboarding.products.nameNeeded' | t }}</p>
              }
            </div>
            <div>
              <label class="onb-label" for="onb-prod-price">{{ 'onboarding.products.price' | t }}</label>
              <input id="onb-prod-price" class="onb-input" type="text" inputmode="decimal" dir="ltr" autocomplete="off" enterkeyhint="done" maxlength="14"
                [value]="price()" (input)="onPrice($event)" [attr.aria-invalid]="priceError() ? 'true' : null" aria-describedby="onb-prod-price-err" />
              @if (priceError()) {
                <p id="onb-prod-price-err" class="onb-field-error" role="alert">{{ 'onboarding.products.priceNeeded' | t }}</p>
              }
            </div>
            <div>
              <button type="button" class="onb-link" id="onb-prod-more-btn" [attr.aria-expanded]="more()" aria-controls="onb-prod-more" (click)="more.set(!more())">{{ 'onboarding.products.more' | t }}</button>
            </div>
            @if (more()) {
              <div class="onb-prompt-more" id="onb-prod-more">
                <div>
                  <label class="onb-label" for="onb-prod-desc">{{ 'onboarding.products.desc' | t }}</label>
                  <textarea id="onb-prod-desc" class="onb-textarea" rows="3" appUserText maxlength="500" [value]="description()" (input)="onDescription($event)"></textarea>
                </div>
                <div>
                  <input id="onb-prod-photo" class="onb-prompt-file" type="file" accept="image/*" (change)="onPhoto($event)" />
                  <label for="onb-prod-photo" class="onb-btn onb-btn-secondary" [attr.aria-busy]="uploading()">{{ 'onboarding.products.photo' | t }}</label>
                  @if (photoName(); as n) {
                    <p class="onb-prompt-file-name" id="onb-prod-photo-name" appUserText>{{ n }}</p>
                  }
                </div>
                @if (arabic()) {
                  <div>
                    <label class="onb-label" for="onb-prod-name-ar">{{ 'onboarding.products.nameAr' | t }}</label>
                    <input id="onb-prod-name-ar" class="onb-input" type="text" dir="rtl" lang="ar" autocomplete="off" maxlength="120"
                      [value]="nameAr()" (input)="onNameAr($event)" [attr.aria-invalid]="nameArError() ? 'true' : null" aria-describedby="onb-prod-name-ar-err" />
                    @if (nameArError()) {
                      <p id="onb-prod-name-ar-err" class="onb-field-error" role="alert">{{ 'onboarding.products.nameArNeeded' | t }}</p>
                    }
                  </div>
                  <div>
                    <label class="onb-label" for="onb-prod-desc-ar">{{ 'onboarding.products.descAr' | t }}</label>
                    <textarea id="onb-prod-desc-ar" class="onb-textarea" rows="3" dir="rtl" lang="ar" maxlength="500" [value]="descAr()" (input)="onDescAr($event)"></textarea>
                  </div>
                }
              </div>
            }
            <app-onb-a-error [error]="error()" />
            <div class="onb-bar">
              <button type="submit" id="onb-prod-add" class="onb-btn onb-btn-primary" [disabled]="busy() || uploading()" [attr.aria-busy]="busy()">{{ 'onboarding.products.add' | t }}</button>
              <div class="onb-prompt-links">
                <button type="button" class="onb-link" id="onb-prod-csv" (click)="openCsv()">{{ 'onboarding.products.csv' | t }}</button>
                <button type="button" class="onb-link" id="onb-prod-skip" [disabled]="busy()" (click)="skip('products')">{{ 'onboarding.common.skip' | t }}</button>
                <app-onb-help />
              </div>
            </div>
          </form>
        }
        @case ('added') {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.products.title" onbStep="products">{{ 'onboarding.products.added' | t: { name: lastName() } }}</h1>
          <p class="onb-lead" id="onb-prod-count">{{ 'onboarding.products.count' | t: { n: count() } }}</p>
          @if (arabicFailed()) {
            <div class="onb-alert onb-alert-warn" role="status" id="onb-prod-ar-failed">
              <span class="onb-alert-icon" aria-hidden="true">!</span>
              <span>{{ 'onboarding.products.arFailed' | t }}</span>
            </div>
          }
          <app-onb-ai-next kind="products" [count]="count()" />
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="button" id="onb-prod-done" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="done()">{{ 'onboarding.common.done' | t }}</button>
            <button type="button" id="onb-prod-another" class="onb-btn onb-btn-secondary" (click)="another()">{{ 'onboarding.products.another' | t }}</button>
            <div class="onb-bar-links"><span></span><app-onb-help /></div>
          </div>
        }
        @case ('csv') {
          <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.products.title" onbStep="products">{{ 'onboarding.products.csvTitle' | t }}</h1>
          <p class="onb-lead">{{ 'onboarding.products.csvBody' | t }}</p>
          <div>
            <button type="button" class="onb-link" id="onb-prod-template" (click)="downloadTemplate()">{{ 'onboarding.customers.upload.template' | t }}</button>
          </div>
          <div>
            <input id="onb-prod-file" class="onb-prompt-file" type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain" (change)="onCsvFile($event)" />
            <label for="onb-prod-file" class="onb-btn onb-btn-secondary">{{ 'onboarding.customers.upload.choose' | t }}</label>
            @if (csvFile(); as f) {
              <p class="onb-prompt-file-name" id="onb-prod-file-name" appUserText>{{ f.name }}</p>
            }
          </div>
          @if (hint(); as h) {
            <div class="onb-alert" [class.onb-alert-info]="h === 'xlsx'" [class.onb-alert-warn]="h === 'columns'" role="alert" tabindex="-1" id="onb-prod-hint">
              <span class="onb-alert-icon" aria-hidden="true">{{ h === 'xlsx' ? 'i' : '!' }}</span>
              <div class="onb-stack onb-tight">
                <span>{{ (h === 'xlsx' ? 'onboarding.customers.upload.xlsx' : 'onboarding.products.csvNoColumns') | t }}</span>
                <a class="onb-link" [routerLink]="fullImport" [queryParams]="{ entityType: kind() }">{{ 'onboarding.customers.upload.full' | t }}</a>
              </div>
            </div>
          }
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="button" id="onb-prod-csv-check" class="onb-btn onb-btn-primary" [disabled]="!csvFile() || busy()" [attr.aria-busy]="busy()" (click)="checkCsv()">{{ 'onboarding.customers.upload.check' | t }}</button>
            <div class="onb-bar-links">
              <button type="button" class="onb-link" (click)="backToForm()">{{ 'onboarding.common.back' | t }}</button>
              <app-onb-help />
            </div>
          </div>
        }
        @case ('csvPreview') {
          @if (csvJob(); as j) {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.products.title" onbStep="products">{{ 'onboarding.products.csvTitle' | t }}</h1>
            <ul class="onb-prompt-counts">
              <li id="onb-prod-prev-ok">{{ 'onboarding.customers.preview.ok' | t: { n: j.clean } }}</li>
              @if (j.error > 0) {
                <li data-bad id="onb-prod-prev-bad">{{ 'onboarding.products.csvBad' | t: { n: j.error } }}</li>
              }
              @if (j.duplicate > 0) {
                <li id="onb-prod-prev-dupes">{{ 'onboarding.customers.preview.dupes' | t: { n: j.duplicate } }}</li>
              }
            </ul>
            @if (j.error > 0) {
              <div>
                <button type="button" class="onb-link" id="onb-prod-prev-download" [disabled]="downloading()" (click)="downloadSkipped()">{{ 'onboarding.customers.preview.download' | t }}</button>
              </div>
            }
            <app-onb-a-error [error]="error()" />
            <div class="onb-bar">
              <button type="button" id="onb-prod-prev-add" class="onb-btn onb-btn-primary" [disabled]="(j.clean + j.duplicate) === 0 || busy()" [attr.aria-busy]="busy()" (click)="runCsv()">
                {{ 'onboarding.products.csvAdd' | t: { n: j.clean + j.duplicate } }}
              </button>
              <div class="onb-bar-links">
                <button type="button" class="onb-link" (click)="openCsv()">{{ 'onboarding.common.back' | t }}</button>
                <app-onb-help />
              </div>
            </div>
          }
        }
        @case ('csvResult') {
          @if (csvResult(); as r) {
            <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.products.title" onbStep="products">{{ 'onboarding.products.csvResult' | t: { added: r.added, skipped: r.skipped } }}</h1>
            @if (r.duplicates > 0) {
              <ul class="onb-prompt-counts">
                <li id="onb-prod-res-dupes">{{ 'onboarding.customers.result.dupes' | t: { n: r.duplicates } }}</li>
              </ul>
            }
            @if (r.skipped > 0) {
              <div>
                <button type="button" class="onb-link" id="onb-prod-res-download" [disabled]="downloading()" (click)="downloadSkipped()">{{ 'onboarding.customers.preview.download' | t }}</button>
              </div>
            }
            @if (r.added > 0) {
              <app-onb-ai-next kind="products" [count]="r.added" />
            }
            <app-onb-a-error [error]="error()" />
            <div class="onb-bar">
              @if (r.added > 0 || r.duplicates > 0) {
                <button type="button" id="onb-prod-res-done" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="done()">{{ 'onboarding.common.done' | t }}</button>
              } @else {
                <button type="button" id="onb-prod-res-again" class="onb-btn onb-btn-primary" (click)="backToForm()">{{ 'onboarding.products.another' | t }}</button>
              }
              <div class="onb-bar-links"><span></span><app-onb-help /></div>
            </div>
          }
        }
      }
    </section>
  `,
})
export class ProductsScreen extends PromptScreenBase {
  private readonly legacy = inject(ApiService);
  private readonly loc = inject(LocalizationApiService);
  private readonly flag = inject(LocalizationFlagService);
  readonly fullImport = FULL_IMPORT_URL;

  readonly stage = signal<Stage>('form');
  readonly kind = signal<ItemKind>('product');
  readonly name = signal('');
  readonly price = signal('');
  readonly description = signal('');
  readonly nameAr = signal('');
  readonly descAr = signal('');
  readonly more = signal(false);
  readonly photoUrl = signal<string | null>(null);
  readonly photoName = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly nameError = signal(false);
  readonly priceError = signal(false);
  readonly nameArError = signal(false);
  readonly arabicFailed = signal(false);
  readonly lastName = signal('');
  /** Items added one by one in this visit. */
  readonly count = signal(0);

  readonly csvFile = signal<File | null>(null);
  readonly hint = signal<'xlsx' | 'columns' | null>(null);
  readonly csvJob = signal<CsvJob | null>(null);
  readonly csvResult = signal<CsvResult | null>(null);
  readonly downloading = signal(false);

  /** The Arabic fields exist only when the workspace has Arabic on (OD7). */
  readonly arabic = computed(() => this.flag.arabicEnabled());

  constructor() {
    super();
    effect(() => {
      if (this.hint() !== null) untracked(() => setTimeout(() => document.getElementById('onb-prod-hint')?.focus()));
    });
  }

  setKind(k: ItemKind): void {
    this.kind.set(k);
  }

  onName(e: Event): void {
    this.name.set((e.target as HTMLInputElement).value);
    this.nameError.set(false);
  }

  onPrice(e: Event): void {
    this.price.set((e.target as HTMLInputElement).value);
    this.priceError.set(false);
  }

  onDescription(e: Event): void {
    this.description.set((e.target as HTMLTextAreaElement).value);
  }

  onNameAr(e: Event): void {
    this.nameAr.set((e.target as HTMLInputElement).value);
    this.nameArError.set(false);
  }

  onDescAr(e: Event): void {
    this.descAr.set((e.target as HTMLTextAreaElement).value);
  }

  /** A photo is uploaded as soon as it is chosen (POST /uploads/image -> { url }); the item then carries that URL. */
  onPhoto(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    this.clearError();
    this.announcer.say('onboarding.common.loading');
    this.legacy.uploadImage(file).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.photoUrl.set(typeof res?.url === 'string' && res.url ? res.url : null);
        this.photoName.set(this.photoUrl() ? file.name : null);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.fail(err);
      },
    });
  }

  submit(e: Event): void {
    e.preventDefault();
    if (this.busy() || this.uploading()) return;
    const name = this.name().trim();
    const price = parseItemPrice(this.price());
    const arabicOn = this.arabic();
    const nameAr = arabicOn ? this.nameAr().trim() : '';
    const descAr = arabicOn ? this.descAr().trim() : '';
    this.nameError.set(!name);
    this.priceError.set(price === null);
    const arNeeded = arabicOn && !!descAr && !nameAr;
    this.nameArError.set(arNeeded);
    if (!name || price === null || arNeeded) {
      if (arNeeded && name && price !== null) this.more.set(true);
      setTimeout(() => document.getElementById(!name ? 'onb-prod-name' : price === null ? 'onb-prod-price' : 'onb-prod-name-ar')?.focus());
      return;
    }
    this.busy.set(true);
    this.clearError();
    const kind = this.kind();
    const body = itemBody(kind, { name, price, description: this.description().trim(), photoUrl: this.photoUrl() });
    const req = kind === 'service' ? this.legacy.createService(body) : this.legacy.createProduct(body);
    req.subscribe({
      next: (saved: { _id?: unknown } | null) => {
        this.busy.set(false);
        this.arabicFailed.set(false);
        this.count.update((n) => n + 1);
        this.lastName.set(name);
        const id = saved && saved._id ? String(saved._id) : null;
        if (nameAr && id) this.saveArabic(kind, id, nameAr, descAr);
        this.resetForm();
        this.stage.set('added');
        this.announcer.say('onboarding.products.added', { name });
        this.markDone('products', true); // background: at least one item now exists
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Arabic draft through the existing, flag-gated catalogue endpoint. Never blocks: a failure is only mentioned. */
  private saveArabic(kind: ItemKind, id: string, name: string, description: string): void {
    this.loc.saveCatalogTranslation(kind, id, { name, ...(description ? { description } : {}), source: 'merchant' }).subscribe({
      error: () => this.arabicFailed.set(true),
    });
  }

  private resetForm(): void {
    this.name.set('');
    this.price.set('');
    this.description.set('');
    this.nameAr.set('');
    this.descAr.set('');
    this.photoUrl.set(null);
    this.photoName.set(null);
    this.more.set(false);
  }

  another(): void {
    this.clearError();
    this.stage.set('form');
  }

  done(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.markDone('products', false, () => {
      this.busy.set(false);
      this.open(CUSTOMER_URLS.dashboard);
    });
  }

  // ------------------------------------------------------------------------------------------------ CSV path

  openCsv(): void {
    this.clearError();
    this.hint.set(null);
    this.csvJob.set(null);
    this.csvFile.set(null);
    this.stage.set('csv');
  }

  backToForm(): void {
    this.clearError();
    this.stage.set('form');
  }

  onCsvFile(e: Event): void {
    this.csvFile.set((e.target as HTMLInputElement).files?.[0] ?? null);
    this.hint.set(null);
    this.clearError();
  }

  /**
   * The engine's own template for this kind (columns Name / Price / Category / ...), HEADER ONLY: the engine's sample file has
   * example rows (a T-shirt, a haircut) that would be imported as real items if the file were uploaded untouched.
   */
  downloadTemplate(): void {
    const kind = this.kind();
    this.legacy.downloadImportSampleTemplate(kind).pipe(switchMap((blob) => from(blobToText(blob)))).subscribe({
      next: (text) => downloadCsv(toCsv(parseCsvText(text)[0] ?? [], []), `${kind}-import-template.csv`),
      error: (err: unknown) => this.fail(err),
    });
  }

  /** One job, never with a consent flag (products and services have none): upload, auto-map, validate. */
  checkCsv(): void {
    const f = this.csvFile();
    if (!f || this.busy()) return;
    this.clearError();
    this.hint.set(null);
    const verdict = checkChosenFile(f);
    if (verdict === 'xlsx') {
      this.hint.set('xlsx');
      this.announcer.say('onboarding.customers.upload.xlsx');
      return;
    }
    if (verdict) {
      this.fail({ code: verdict });
      return;
    }
    this.busy.set(true);
    this.announcer.say('onboarding.common.loading');
    const kind = this.kind();
    this.legacy
      .uploadImport(kind, f, false)
      .pipe(
        switchMap((created: { id?: unknown; columnMapping?: Record<string, string>; fields?: { key: string; required?: boolean }[] }) => {
          const id = String(created?.id ?? '');
          const mapping = created?.columnMapping ?? {};
          const required = (created?.fields ?? []).filter((x) => x.required).map((x) => x.key);
          const need = required.length ? required : ['name', 'basePrice'];
          if (!id || need.some((k) => !mapping[k])) return throwError(() => ({ unmapped: true }));
          return this.legacy.updateImportMapping(id, mapping).pipe(
            map((v: { summary?: { clean?: number; duplicate?: number; error?: number } }): CsvJob => ({
              id, clean: num(v?.summary?.clean), duplicate: num(v?.summary?.duplicate), error: num(v?.summary?.error),
            })),
          );
        }),
      )
      .subscribe({
        next: (job) => {
          this.busy.set(false);
          this.csvJob.set(job);
          this.stage.set('csvPreview');
        },
        error: (err: unknown) => {
          if ((err as { unmapped?: boolean } | null)?.unmapped) {
            this.busy.set(false);
            this.hint.set('columns');
            this.announcer.say('onboarding.products.csvNoColumns');
          } else {
            this.fail(err);
          }
        },
      });
  }

  runCsv(): void {
    const job = this.csvJob();
    if (!job || this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.announcer.say('onboarding.common.loading');
    this.legacy.runImport(job.id, []).subscribe({
      next: (r: { importedCount?: number; skippedDuplicateCount?: number; failedCount?: number }) => {
        this.busy.set(false);
        const result = { added: num(r?.importedCount), skipped: num(r?.failedCount), duplicates: num(r?.skippedDuplicateCount) };
        this.csvResult.set(result);
        this.stage.set('csvResult');
        this.announcer.say('onboarding.products.csvResult', { added: result.added, skipped: result.skipped });
        if (result.added > 0 || result.duplicates > 0) this.markDone('products', true);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /** The engine's own error report (rows that cannot be added, with a Reason column). */
  downloadSkipped(): void {
    const job = this.csvJob();
    if (!job || this.downloading()) return;
    this.downloading.set(true);
    this.clearError();
    this.legacy.downloadImportErrorReport(job.id).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        downloadBlob(blob, 'import-errors.csv');
      },
      error: (err: unknown) => {
        this.downloading.set(false);
        this.fail(err);
      },
    });
  }
}
