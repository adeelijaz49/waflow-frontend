import { Component, Injector, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, debounceTime, firstValueFrom, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocalizationFlagService } from '../../../services/localization-flag.service';
import type {
  LocalizedTemplate, MetaStatus, PlanVariantInfo, PromotionSendPlan, PromotionTestSendResult, SendLanguageCounts, TemplateVariant,
} from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { errorCode, errorStatus } from '../shared/loc-errors';
import { WaPreview } from '../shared/wa-preview';
import { EmbeddedText } from './embedded-text';
import { LanguagePlanBridge } from './language-plan-bridge';
import { LanguagePlanSummary } from './language-plan-summary';
import { KNOWN_FALLBACK_REASONS, planCounts, splitReason } from './plan-summary.util';
import { TrackedSet } from './tracked-set';

const DEBOUNCE_MS = 400;
// The plan request carries the selected ids in a JSON body and the server's express.json() default limit is 100 kb: about 3,700
// ids already exceed it (an HTML 413, not the API error). Above this many selected customers the request is not sent and the
// existing "too many selected" message is shown instead (the send itself is unaffected).
const MAX_IDS = 3000;
const LOOKUP_CHUNK = 50; // customer ids per GET /api/customers?ids= (keeps the URL short)
const LOOKUP_PARALLEL = 3;

type PanelStatus = 'idle' | 'empty' | 'toomany' | 'loading' | 'ready' | 'error' | 'unavailable';
type PlanAnswer =
  | { kind: 'empty' }
  | { kind: 'toomany' }
  | { kind: 'plan'; plan: PromotionSendPlan; size: number }
  | { kind: 'error'; unavailable: boolean };
type TestState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'dry' }
  | { kind: 'no_version'; reason: string }
  | { kind: 'error' };

const ENGLISH_STATUS: Record<string, MetaStatus> = {
  approved: 'APPROVED', pending: 'PENDING', rejected: 'REJECTED', not_created: 'NOT_CREATED',
};

// "Language" panel of the Promotions campaign panel (flagged merchants only). The legacy send sends each
// customer a message in THEIR language; this panel shows, before sending, who gets which language, the
// approval state of the English and Arabic versions of the promotion's entry message, why some Arabic
// customers will get English instead, and offers selection shortcuts, an Arabic preview and an Arabic
// test. It is advisory: it never blocks or changes the send. Every failure degrades to an inline note
// (or nothing for 402/404); the old controls keep working.
@Component({
  selector: 'app-promotion-language-panel',
  imports: [RouterLink, ApprovalBadge, WaPreview, LanguagePlanSummary],
  templateUrl: './promotion-language-panel.html',
  styleUrl: './promotion-language-panel.css',
})
export class PromotionLanguagePanel extends EmbeddedText {
  private readonly api = inject(LocalizationApiService);
  private readonly bridge = inject(LanguagePlanBridge);
  private readonly flag = inject(LocalizationFlagService);
  private readonly injector = inject(Injector);

  readonly promotion = input.required<any>();
  readonly selection = input.required<TrackedSet<string>>();
  readonly testPhone = input<string>('');
  readonly sendResult = input<any>(null);

  readonly status = signal<PanelStatus>('idle');
  readonly plan = signal<PromotionSendPlan | null>(null);
  // How many customers the stored plan was asked about. An EMPTY selection is planned too (the answer carries
  // the Arabic version, so the version row, preview and test work before anyone is selected) but its zero counts
  // are never shown: only a plan for a non-empty selection feeds the summary and the shortcuts.
  readonly planSize = signal(0);
  readonly shownPlan = computed<PromotionSendPlan | null>(() => (this.planSize() > 0 ? this.plan() : null));
  // "Keep only English" may need a customer lookup; the buttons wait for it.
  readonly narrowing = signal(false);
  readonly narrowFailed = signal(false);

  // Arabic preview (collapsed by default; the template is fetched once, when first opened).
  readonly previewOpen = signal(false);
  readonly previewState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly previewVariant = signal<TemplateVariant | null>(null);
  private previewFor: string | null = null;

  // Arabic test message.
  readonly phone = signal('');
  readonly test = signal<TestState>({ kind: 'idle' });
  private phoneTouched = false;

  private readonly requests = new Subject<{ id: string; ids: string[] }>();
  private lastRequest: { id: string; ids: string[] } | null = null;
  private lastPromotionId: string | null = null;

  readonly promotionId = computed<string>(() => this.promotion()?._id ?? '');

  readonly entryNode = computed<{ _id?: string; templateStatus?: string } | null>(() => {
    const n = this.promotion()?.entryNodeId;
    return n && typeof n === 'object' ? n : null;
  });
  readonly englishStatus = computed<MetaStatus | null>(() => {
    const n = this.entryNode();
    return n ? ENGLISH_STATUS[String(n.templateStatus ?? 'not_created')] ?? 'NOT_CREATED' : null;
  });
  readonly variant = computed<PlanVariantInfo | null>(() => this.plan()?.variant ?? null);
  readonly counts = computed(() => (this.plan() ? planCounts(this.plan()!) : null));
  readonly defaultLanguage = computed(() => this.t(`promolang.language.${this.flag.defaultCustomerLanguage()}`));

  // Selection shortcuts (need the ids the plan was asked to return). Each count is exactly the number of
  // customers left selected by its button, and matches the figure of the plan bar: Arabic = bar "Arabic",
  // English = bar "English" + "English instead of Arabic" (customers who WILL be messaged in English).
  // 'rest' = selected customers in no bucket: the plain English recipients AND the customers who will not be
  // messaged at all (no consent / opted out / demo); the plan reports only how many there are, not which.
  readonly shortcuts = computed(() => {
    const p = this.shownPlan();
    this.selection().rev(); // the selected size is read from the live Set
    const buckets = p?.buckets;
    if (!p || !buckets) return null;
    const selected = this.selection();
    const inSel = (ids: string[]): string[] => ids.filter((id) => selected.has(id));
    const arabic = inSel(buckets.arabic ?? []);
    const fallback = inSel(buckets.englishFallback ?? []);
    const excluded = new Set(buckets.excluded ?? []);
    const arSet = new Set(arabic);
    const fbSet = new Set(fallback);
    const rest = [...selected].filter((id) => !arSet.has(id) && !fbSet.has(id) && !excluded.has(id));
    return { arabic, fallback, rest, english: p.byLanguage?.en ?? 0, size: selected.size };
  });

  readonly sendSummary = computed(() => {
    const r = this.sendResult() as (SendLanguageCounts & { error?: boolean }) | null;
    if (!r || r.error || (!r.languageCounts && !r.localization)) return null;
    const loc = r.localization;
    return {
      counts: r.languageCounts ?? null,
      fallbacks: (loc?.fallbackToEnglish ?? []).filter((f) => f.count > 0),
      stopped: loc?.stopped ? splitReason(loc.stopped).field || loc.stopped : null,
    };
  });

  constructor() {
    super();

    // Every change of the promotion or the selection (any call site: the page mutates the TrackedSet in
    // place) schedules ONE debounced plan request; a newer request cancels an older in-flight one.
    effect(() => {
      const promo = this.promotion();
      const sel = this.selection();
      sel.rev();
      const id: string = promo?._id ?? '';
      untracked(() => this.schedule(id, [...sel]));
    });

    // After a send the plan is refreshed (opt-outs / statuses may have changed), so a second send never
    // confirms with the numbers of the first one. The debounce coalesces this with any selection change.
    effect(() => {
      const r = this.sendResult() as { error?: boolean } | null;
      if (!r || r.error) return;
      untracked(() => this.schedule(this.promotionId(), [...this.selection()]));
    });

    effect(() => {
      const p = this.testPhone();
      untracked(() => { if (!this.phoneTouched) this.phone.set(p ?? ''); });
    });

    this.requests
      .pipe(
        debounceTime(DEBOUNCE_MS),
        switchMap((req) => {
          if (!req.id) return of<PlanAnswer>({ kind: 'empty' });
          if (req.ids.length > MAX_IDS) return of<PlanAnswer>({ kind: 'toomany' });
          if (this.status() === 'unavailable') return EMPTY;
          return this.api.getPromotionSendPlan(req.id, req.ids, true).pipe(
            map((plan): PlanAnswer => ({ kind: 'plan', plan, size: req.ids.length })),
            catchError((err: unknown) => {
              const s = errorStatus(err);
              return of<PlanAnswer>({ kind: 'error', unavailable: s === 402 || s === 404 || errorCode(err) === 'ARABIC_NOT_ENABLED' });
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((a) => this.apply(a));
  }

  private schedule(id: string, ids: string[]): void {
    if (id !== this.lastPromotionId) {
      // Another promotion: forget everything shown for the previous one.
      this.lastPromotionId = id;
      if (this.status() === 'unavailable') this.status.set('idle');
      this.previewOpen.set(false);
      this.previewState.set('idle');
      this.previewVariant.set(null);
      this.previewFor = null;
      this.test.set({ kind: 'idle' });
      this.plan.set(null);
      this.planSize.set(0);
    }
    // The previous answer stays on screen (dimmed) while the next one loads, but it can never reach the
    // confirmation dialog: the bridge is cleared at once. For an empty selection the plan is kept (its
    // variant stays visible) and only its counts are hidden.
    if (ids.length === 0) this.planSize.set(0);
    this.narrowFailed.set(false);
    this.bridge.publish(null); // a plan for another selection must never reach the confirmation dialog
    this.lastRequest = { id, ids };
    if (this.status() !== 'unavailable') {
      this.status.set(!id || ids.length === 0 ? 'empty' : ids.length > MAX_IDS ? 'toomany' : 'loading');
    }
    this.requests.next({ id, ids });
  }

  private apply(a: PlanAnswer): void {
    switch (a.kind) {
      case 'empty': this.status.set('empty'); this.plan.set(null); this.planSize.set(0); break;
      case 'toomany': this.status.set('toomany'); this.plan.set(null); this.planSize.set(0); break;
      case 'error': this.status.set(a.unavailable ? 'unavailable' : 'error'); this.plan.set(null); this.planSize.set(0); break;
      case 'plan':
        this.plan.set(a.plan);
        this.planSize.set(a.size);
        if (a.size === 0) {
          this.status.set('empty');
          break;
        }
        this.status.set('ready');
        this.bridge.publish({ promotionId: this.promotionId(), selectedSize: a.size, plan: a.plan });
        break;
    }
  }

  retry(): void {
    if (this.lastRequest) {
      this.status.set('loading');
      this.requests.next(this.lastRequest);
    }
  }

  // ── Selection shortcuts: explicit buttons that rewrite the merchant's selection ──
  private setSelection(ids: string[]): void {
    const sel = this.selection();
    sel.clear();
    for (const id of ids) sel.add(id);
  }
  keepArabic(): void { const s = this.shortcuts(); if (s) this.setSelection(s.arabic); }
  // Leaves exactly the customers who will get an English message: the English recipients of the plan bar,
  // including the ones getting English instead of Arabic. When the plan says some selected customers will not
  // be messaged (no consent / opted out), the ones in 'rest' are looked up to tell them apart.
  async keepEnglish(): Promise<void> {
    const s = this.shortcuts();
    const p = this.plan();
    if (!s || !p || this.narrowing()) return;
    const rev = this.selection().rev();
    let keep = s.rest;
    if (this.unmessagedCount(p) > 0 && s.rest.length > 0) {
      this.narrowing.set(true);
      this.narrowFailed.set(false);
      try {
        keep = await this.messageable(s.rest);
      } catch {
        this.narrowFailed.set(true);
        return;
      } finally {
        this.narrowing.set(false);
      }
      if (this.selection().rev() !== rev) return; // the selection changed while looking: do not overwrite it
    }
    this.setSelection([...keep, ...s.fallback]);
  }
  skipFallbacks(): void {
    const s = this.shortcuts();
    if (!s) return;
    const drop = new Set(s.fallback);
    this.setSelection([...this.selection()].filter((id) => !drop.has(id)));
  }

  // Selected customers the plan will not message because of consent / opt-out / demo (not the blocked ones:
  // those are in buckets.excluded).
  private unmessagedCount(p: PromotionSendPlan): number {
    return (p.skipped?.noConsent ?? 0) + (p.skipped?.optedOut ?? 0) + (p.skipped?.demoSimulated ?? 0);
  }

  // The ids of "ids" that can be sent marketing messages (same rule as the backend: marketing consent, not
  // opted out, not a demo record). Customers the lookup does not return are dropped.
  private async messageable(ids: string[]): Promise<string[]> {
    if (this.promotion()?.isDemo) return [];
    const api = this.injector.get(ApiService);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) chunks.push(ids.slice(i, i + LOOKUP_CHUNK));
    const pages = await firstValueFrom(
      from(chunks).pipe(
        mergeMap((chunk) => api.getCustomers({ ids: chunk.join(','), page: 1, limit: LOOKUP_CHUNK }), LOOKUP_PARALLEL),
        toArray(),
      ),
    );
    const ok = new Set<string>();
    for (const page of pages) {
      for (const c of (page as { customers?: Array<{ _id: string; marketingConsent?: boolean; optedOut?: boolean; isDemo?: boolean }> })?.customers ?? []) {
        if (c.marketingConsent === true && c.optedOut !== true && c.isDemo !== true) ok.add(String(c._id));
      }
    }
    return ids.filter((id) => ok.has(id));
  }

  // ── Texts that depend on the data ──
  sourceText(v: PlanVariantInfo): string {
    return this.t(`promolang.source.${v.source}`);
  }

  // ── Arabic preview ──
  togglePreview(): void {
    const open = !this.previewOpen();
    this.previewOpen.set(open);
    const id = this.variant()?.templateId ?? null;
    if (!open || !id || this.previewFor === id) return;
    this.previewFor = id;
    this.previewState.set('loading');
    this.api.getTemplate(id).subscribe({
      next: (tpl: LocalizedTemplate) => {
        const v = tpl.variants?.find((x) => x.language === 'ar') ?? null;
        this.previewVariant.set(v);
        this.previewState.set(v ? 'ready' : 'error');
      },
      error: () => { this.previewFor = null; this.previewState.set('error'); },
    });
  }

  // ── Arabic test ──
  onPhone(value: string): void {
    this.phoneTouched = true;
    this.phone.set(value);
  }

  sendTest(): void {
    const v = this.variant();
    const phone = this.phone().trim();
    if (!v?.sendable || !phone || this.test().kind === 'sending') return;
    this.test.set({ kind: 'sending' });
    this.api.testSendPromotionArabic(this.promotionId(), phone).subscribe({
      next: (r: PromotionTestSendResult) => this.test.set({ kind: r?.dryRun ? 'dry' : 'sent' }),
      error: (err: unknown) => {
        const body = (err as { error?: { code?: string; reason?: string; detail?: { reason?: string } } } | null)?.error;
        if (errorStatus(err) === 409 && body?.code === 'NO_ARABIC_VERSION') {
          this.test.set({ kind: 'no_version', reason: body.reason ?? body.detail?.reason ?? '' });
        } else {
          this.test.set({ kind: 'error' });
        }
      },
    });
  }

  reasonText(reason: string): string {
    const { code, field } = splitReason(reason || 'unknown');
    return KNOWN_FALLBACK_REASONS.includes(code) ? this.t(`promolang.reason.${code}`, { field }) : this.t('promolang.reason.unknown');
  }
  fallbackLine(f: { reason: string; count: number }): string {
    return this.tp('promolang.sent.fallback', f.count, { reason: this.reasonText(f.reason) });
  }
}
