import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, from, map, of, switchMap, tap, throwError, toArray } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { OnbStateService } from '../onb-state.service';
import {
  blobToText, buildJobCsv, csvFile, downloadCsv, mergeErrorReports, splitByOptIn,
  type ConsentMode, type CustomerRow, type ParsedCustomers, type RejectReason,
} from './csv';

export interface FlowJobSummary { totalRows: number; clean: number; duplicate: number; error: number; discrepancy: number }
export interface FlowJobRun { imported: number; skippedDuplicate: number; failed: number }

/** One import job on the server: `attested` jobs were created with marketingConsentAttested = true (only after the tick). */
export interface FlowJob {
  id: string;
  attested: boolean;
  rows: number;
  summary: FlowJobSummary;
  discrepancies: number[];
  ran: FlowJobRun | null;
}

export interface FlowResult {
  added: number;
  failed: number;
  duplicates: number;
  withoutOptin: number;
  rejected: number;
  skipped: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * In-memory state of the customers prompt (DF 3.7): the parsed list, the merchant's opt-in answer, the import jobs and the result.
 * Nothing here is persisted (no storage, no URL, no log): a refresh goes back to the first screen, and a logout or a login of another
 * merchant in the same tab wipes it (R6-13: OnbStateService tells every holder of per-login data when the session ends).
 *
 * Compliance: the attested job (marketingConsentAttested = true) is created ONLY when `attest()` is true; `attest` starts false, is
 * set only by the checkbox of the opt-in screen and is cleared by `reset()` / `setParsed()` / any change of the answer. The "all of
 * them agreed" answer is refused while the file holds a consent-like column that was not understood.
 */
@Injectable({ providedIn: 'root' })
export class CustomersFlowService {
  private readonly api = inject(ApiService);

  readonly parsed = signal<ParsedCustomers | null>(null);
  readonly fileName = signal<string | null>(null);
  readonly pasteText = signal('');
  readonly consent = signal<ConsentMode | null>(null);
  readonly attest = signal(false);
  readonly jobs = signal<FlowJob[] | null>(null);
  readonly result = signal<FlowResult | null>(null);
  /** What the split found out about the list for the current answer (set with the jobs). */
  private readonly splitStats = signal<{ conflicting: number; repeated: number } | null>(null);

  constructor() {
    // Logout / another login in the same tab: the previous merchant's list must not stay reachable through the Back button.
    inject(OnbStateService).onSessionEnd(() => this.reset());
  }

  /** The opt-in screen is needed when the list has no opt-in column (ask once) or has rows marked yes (confirm them). */
  readonly needsOptInQuestion = computed(() => {
    const p = this.parsed();
    if (!p || p.rows.length === 0) return false;
    return !p.hasOptInColumn || p.rows.some((r) => r.optIn === 'yes');
  });

  /**
   * The "Yes, all of them agreed" shortcut is OFF: the file has a column that looks like consent ("Accepts Marketing", "Consent status",
   * ...) but is not the opt-in column we understand, so what it says is unknown. Consent is never guessed.
   */
  readonly shortcutBlocked = computed(() => {
    const p = this.parsed();
    return !!p && !p.hasOptInColumn && p.unknownConsentColumns.length > 0;
  });

  /** Forget everything (entering the method screen, leaving the flow, the end of the session). */
  reset(): void {
    this.parsed.set(null);
    this.fileName.set(null);
    this.pasteText.set('');
    this.consent.set(null);
    this.attest.set(false);
    this.jobs.set(null);
    this.result.set(null);
    this.splitStats.set(null);
  }

  /** A freshly parsed list replaces everything that depended on the previous one. */
  setParsed(parsed: ParsedCustomers, fileName: string | null): void {
    this.parsed.set(parsed);
    this.fileName.set(fileName);
    this.consent.set(null);
    this.attest.set(false);
    this.jobs.set(null);
    this.result.set(null);
    this.splitStats.set(null);
  }

  /** The merchant's answer. Anything that changes the split drops the jobs prepared for the previous answer. */
  setConsent(requested: ConsentMode, attest: boolean): void {
    const mode: ConsentMode = requested === 'all' && this.shortcutBlocked() ? 'none' : requested;
    const effective = mode !== 'none' && attest === true;
    if (this.consent() !== mode || this.attest() !== effective) {
      this.jobs.set(null);
      this.result.set(null);
      this.splitStats.set(null);
    }
    this.consent.set(mode);
    this.attest.set(effective);
  }

  /** Creates and validates the import job(s) once (idempotent while the answer is unchanged). Attested job first. */
  prepare(withLanguage: boolean): Observable<FlowJob[]> {
    const parsed = this.parsed();
    const consent = this.consent();
    if (!parsed || consent === null) return throwError(() => ({ code: 'ONB_IMPORT_NO_ROWS' }));
    const existing = this.jobs();
    if (existing) return of(existing);
    const attest = this.attest() === true && consent !== 'none';
    const split = splitByOptIn(parsed.rows, { consent, attest });
    this.splitStats.set({ conflicting: split.conflicting, repeated: split.repeated });
    const groups: { attested: boolean; rows: CustomerRow[] }[] = [];
    if (split.attested.length) groups.push({ attested: true, rows: split.attested });
    if (split.plain.length) groups.push({ attested: false, rows: split.plain });
    if (groups.length === 0) {
      this.jobs.set([]);
      return of([]);
    }
    return from(groups).pipe(
      concatMap((g) => this.createJob(g.rows, g.attested && attest, withLanguage)),
      toArray(),
      tap((jobs) => this.jobs.set(jobs)),
    );
  }

  private createJob(rows: CustomerRow[], attested: boolean, withLanguage: boolean): Observable<FlowJob> {
    const file = csvFile(buildJobCsv(rows, withLanguage, attested), 'customers.csv');
    return this.api.uploadImport('customer', file, attested).pipe(
      switchMap((created: { id?: unknown; columnMapping?: Record<string, string>; fields?: { key: string; required?: boolean }[] }) => {
        const id = String(created?.id ?? '');
        const mapping = created?.columnMapping ?? {};
        const required = (created?.fields ?? []).filter((f) => f.required).map((f) => f.key);
        const need = required.length ? required : ['name', 'phone'];
        if (!id || need.some((k) => !mapping[k])) return throwError(() => ({ code: 'ONB_IMPORT_BAD_FILE' }));
        return this.api.updateImportMapping(id, mapping).pipe(
          map((v: { summary?: Partial<FlowJobSummary>; discrepancies?: { rowIndex?: number }[] }): FlowJob => ({
            id,
            attested,
            rows: rows.length,
            summary: {
              totalRows: num(v?.summary?.totalRows), clean: num(v?.summary?.clean), duplicate: num(v?.summary?.duplicate),
              error: num(v?.summary?.error), discrepancy: num(v?.summary?.discrepancy),
            },
            discrepancies: (v?.discrepancies ?? []).map((d) => num(d?.rowIndex)),
            ran: null,
          })),
        );
      }),
    );
  }

  /**
   * Counts for the preview screen (sums over the jobs plus the rows rejected on this side). `duplicates` = people already in the
   * workspace's list (the engine also counts a person listed twice in the file as a duplicate: those are shown as `repeated`).
   * `conflicting` = rows kept without permission only because the same person appears in another row that is not a clear yes.
   */
  readonly preview = computed(() => {
    const jobs = this.jobs();
    const parsed = this.parsed();
    if (!jobs || !parsed) return null;
    const sum = (f: (j: FlowJob) => number): number => jobs.reduce((n, j) => n + f(j), 0);
    const rejected = parsed.rejected.length;
    const stats = this.splitStats();
    const repeated = stats?.repeated ?? 0;
    return {
      total: parsed.rows.length + rejected,
      canAdd: sum((j) => j.summary.clean),
      cannotAdd: sum((j) => j.summary.error) + rejected,
      duplicates: Math.max(0, sum((j) => j.summary.duplicate) - repeated),
      withoutOptin: jobs.filter((j) => !j.attested).reduce((n, j) => n + j.summary.clean, 0),
      repeated,
      conflicting: stats?.conflicting ?? 0,
      unreadable: parsed.unreadable,
    };
  });

  /** Runs every job that has not run yet (attested first). A failed second job can be retried without repeating the first. */
  run(): Observable<FlowResult> {
    const jobs = this.jobs();
    if (!jobs) return throwError(() => ({ code: 'ONB_IMPORT_NO_ROWS' }));
    return from(jobs.map((_, i) => i)).pipe(
      concatMap((i) => {
        const job = this.jobs()?.[i];
        if (!job || job.ran) return of(null);
        // Discrepancies (existing customers whose data differs) default to "skip", as the existing wizard does.
        const resolutions = job.discrepancies.map((rowIndex) => ({ rowIndex, action: 'skip' as const }));
        return this.api.runImport(job.id, resolutions).pipe(
          tap((r: { importedCount?: number; skippedDuplicateCount?: number; failedCount?: number }) => {
            const ran: FlowJobRun = { imported: num(r?.importedCount), skippedDuplicate: num(r?.skippedDuplicateCount), failed: num(r?.failedCount) };
            this.jobs.update((list) => (list ?? []).map((j, k) => (k === i ? { ...j, ran } : j)));
          }),
        );
      }),
      toArray(),
      map(() => this.computeResult()),
      tap((r) => this.result.set(r)),
    );
  }

  private computeResult(): FlowResult {
    const jobs = this.jobs() ?? [];
    const ran = jobs.filter((j) => j.ran);
    const sum = (f: (r: FlowJobRun) => number, only: FlowJob[] = ran): number => only.reduce((n, j) => n + f(j.ran as FlowJobRun), 0);
    const rejected = this.parsed()?.rejected.length ?? 0;
    const failed = sum((r) => r.failed);
    return {
      added: sum((r) => r.imported),
      failed,
      duplicates: sum((r) => r.skippedDuplicate),
      withoutOptin: sum((r) => r.imported, ran.filter((j) => !j.attested)),
      rejected,
      skipped: failed + rejected,
    };
  }

  /** Downloads ONE CSV of every skipped row: the engine's error reports plus the rows rejected here, with a Reason column. */
  async downloadSkipped(reasonOf: (r: RejectReason) => string): Promise<void> {
    const jobs = this.jobs() ?? [];
    const withErrors = jobs.filter((j) => (j.ran ? j.ran.failed : j.summary.error) > 0);
    const reports = await Promise.all(
      withErrors.map((j) => new Promise<string>((resolve, reject) => {
        this.api.downloadImportErrorReport(j.id).subscribe({
          next: (blob) => blobToText(blob).then(resolve, reject),
          error: reject,
        });
      })),
    );
    downloadCsv(mergeErrorReports(reports, this.parsed()?.rejected ?? [], reasonOf), 'customers-skipped-rows.csv');
  }
}
