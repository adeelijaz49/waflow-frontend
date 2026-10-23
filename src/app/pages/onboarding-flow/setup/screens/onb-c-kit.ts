import { inject, signal } from '@angular/core';
import { LocUiService } from '../../../localization/shared/loc-ui.service';
import { CustomersFlowService } from '../../customers/customers-flow.service';
import { fileKind, MAX_IMPORT_BYTES, type ImportIssue, type ParsedCustomers } from '../../customers/csv';
import type { OnbPromptKind } from '../../onb.types';
import { OnbScreenBase } from './onb-a-kit';

// Shared pieces of the customers / products prompt screens (F1-c). Nothing here is visible text: all copy is catalogue keys.

export const CUSTOMER_URLS = {
  method: '/setup/customers',
  upload: '/setup/customers/upload',
  paste: '/setup/customers/paste',
  one: '/setup/customers/one',
  optin: '/setup/customers/optin',
  preview: '/setup/customers/preview',
  result: '/setup/customers/result',
  dashboard: '/dashboard',
} as const;

/** The full import page, for what these screens do not handle (spreadsheets, foreign column names). */
export const FULL_IMPORT_URL = '/imports';

/** The code an import issue shows as an error block (the two "column" issues have their own hint instead). */
export function issueCode(issue: ImportIssue): string | null {
  if (issue === 'no_rows') return 'ONB_IMPORT_NO_ROWS';
  if (issue === 'too_many') return 'ONB_IMPORT_TOO_MANY';
  return null;
}

/** Whether a chosen file can be read here: null = yes, else the error code (a spreadsheet is a hint, not an error: 'xlsx'). */
export function checkChosenFile(file: { name: string; size: number; type?: string }): 'xlsx' | 'ONB_IMPORT_BAD_FILE' | null {
  const kind = fileKind(file.name, file.type ?? '');
  if (kind === 'xlsx') return 'xlsx';
  if (kind === 'other' || file.size > MAX_IMPORT_BYTES || file.size === 0) return 'ONB_IMPORT_BAD_FILE';
  return null;
}

/** Skip / done handling shared by the two prompts (POST /prompts/<kind>). The server stays the truth (422 when nothing exists yet). */
export abstract class PromptScreenBase extends OnbScreenBase {
  protected readonly toast = inject(LocUiService, { optional: true });
  /** `done` was accepted by the server for this screen's prompt. */
  readonly doneSent = signal(false);

  open(url: string): void {
    void this.router.navigateByUrl(url);
  }

  protected patchPrompt(kind: OnbPromptKind, value: 'done' | 'skipped'): void {
    const s = this.state.state();
    if (s) this.state.patch({ prompts: { ...(s.prompts ?? {}), [kind]: { state: value } } });
  }

  /** "Skip for now": always available, records `skipped`, tells the merchant it will be on the dashboard. */
  skip(kind: OnbPromptKind): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearError();
    this.api.promptDone(kind, 'skipped').subscribe({
      next: () => {
        this.busy.set(false);
        this.patchPrompt(kind, 'skipped');
        this.analytics.track('step_skip', kind);
        const text = this.i18n.t('onboarding.customers.skipped');
        this.toast?.toast(text, 'info');
        this.announcer.say('onboarding.customers.skipped');
        void this.state.reloadNow();
        void this.router.navigateByUrl(CUSTOMER_URLS.dashboard);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  /**
   * `done`: only after at least one record exists (the server checks the count and answers 422 VALIDATION_FAILED otherwise).
   * `quiet` = a background call right after the first success (a failure is ignored; Done retries it and shows errors).
   */
  protected markDone(kind: OnbPromptKind, quiet: boolean, then?: () => void): void {
    if (this.doneSent()) {
      then?.();
      return;
    }
    this.api.promptDone(kind, 'done').subscribe({
      next: () => {
        this.doneSent.set(true);
        this.patchPrompt(kind, 'done');
        this.analytics.track('step_complete', kind);
        void this.state.reloadNow();
        then?.();
      },
      error: (err: unknown) => {
        if (quiet) return;
        this.fail(err);
      },
    });
  }
}

/** Upload and paste share what happens after the list is parsed. */
export abstract class CustomersListBase extends PromptScreenBase {
  readonly flow = inject(CustomersFlowService);
  /** A column hint instead of an error block (the file has no phone / name column): offers the full import page. */
  readonly columnHint = signal<'noPhone' | 'noName' | null>(null);

  protected accept(parsed: ParsedCustomers, fileName: string | null): void {
    const code = parsed.issue ? issueCode(parsed.issue) : null;
    if (code) {
      this.fail({ code });
      return;
    }
    if (parsed.issue === 'no_phone_column' || parsed.issue === 'no_name_column') {
      this.columnHint.set(parsed.issue === 'no_phone_column' ? 'noPhone' : 'noName');
      this.busy.set(false);
      this.announcer.say(parsed.issue === 'no_phone_column' ? 'onboarding.customers.upload.noPhone' : 'onboarding.customers.upload.noName');
      return;
    }
    this.flow.setParsed(parsed, fileName);
    this.busy.set(false);
    if (this.flow.needsOptInQuestion()) {
      void this.router.navigateByUrl(CUSTOMER_URLS.optin);
    } else {
      // Every row is "no / blank" in the file's own opt-in column (or the list is empty): nobody is confirmed.
      this.flow.setConsent('none', false);
      void this.router.navigateByUrl(CUSTOMER_URLS.preview);
    }
  }
}
