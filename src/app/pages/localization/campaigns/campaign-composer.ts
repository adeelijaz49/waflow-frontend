import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, LocaleFormatService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import type {
  AudienceSpec, CampaignCreateRequest, CampaignPlan, CampaignPlanRequest, LanguageMode, LocalizedTemplate,
  SegmentKey, SegmentOption, TemplateVariant,
} from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { LangPill } from '../shared/lang-pill';
import { errorText, isNotEnabled } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import { AUTO_FILLED_FIELDS, MERGE_FIELDS, extractMergeFields } from '../shared/merge-fields';
import { MAX_CUSTOMER_IDS, SegmentInput, buildAudience, fallbackLine, isHttpsLink, sendSummary } from './campaign-text';
import { CustomerPicker } from './customer-picker';
import { PlanView } from './plan-view';
import { VariantPreview } from './variant-preview';

export type AudienceKind = AudienceSpec['kind'];
type PlanState = 'idle' | 'pending' | 'loading' | 'ready' | 'error';
type FieldProblem = 'required' | 'https' | null;

const PLAN_DEBOUNCE_MS = 450;
const DEFAULT_SEGMENTS: SegmentOption[] = [
  { key: 'language', params: ['language'] },
  { key: 'inactive_days', params: ['days'] },
  { key: 'has_points', params: ['minPoints'] },
  { key: 'awaiting_consent', params: [] },
];
const KNOWN_ORDER = MERGE_FIELDS.map((f) => f.key);

// Campaign composer: one page with numbered sections (template, language, audience, message fields,
// plan review, send) that unlock as the previous ones are completed. Nothing is sent until the user
// ticks the required acknowledgements AND confirms in the dialog; the server re-plans at send time.
@Component({
  selector: 'app-loc-campaign-composer',
  imports: [...I18N_PIPES, ...I18N_DIRECTIVES, RouterLink, ApprovalBadge, LangPill, PlanView, VariantPreview, CustomerPicker],
  templateUrl: './campaign-composer.html',
  styleUrl: './campaign-composer.css',
})
export class CampaignComposer implements OnInit {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly ui = inject(LocUiService);
  private readonly hub = inject(HubStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fmt = inject(LocaleFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly modes: LanguageMode[] = ['per_customer', 'en', 'ar', 'bilingual'];
  readonly audienceKinds: AudienceKind[] = ['all_eligible', 'segment', 'customer_ids'];
  readonly maxIds = MAX_CUSTOMER_IDS;
  readonly linkPlaceholder = 'https://example.com'; // i18n-ignore: example URL, not translatable text

  readonly templates = signal<LocalizedTemplate[]>([]);
  readonly templatesLoading = signal(true);
  readonly templatesError = signal('');
  readonly templateId = signal('');
  readonly mode = signal<LanguageMode>('per_customer');
  readonly audienceKind = signal<AudienceKind>('all_eligible');
  readonly segments = signal<SegmentOption[]>(DEFAULT_SEGMENTS);
  readonly segmentKey = signal<SegmentKey | ''>('');
  readonly segLanguage = signal<'en' | 'ar' | 'unknown'>('ar');
  readonly segDays = signal<number | null>(30);
  readonly segPoints = signal<number | null>(100);
  readonly customerIds = signal<string[]>([]);
  readonly fieldValues = signal<Record<string, string>>({});
  readonly dateRaw = signal('');
  readonly name = signal('');
  readonly plan = signal<CampaignPlan | null>(null);
  readonly planState = signal<PlanState>('idle');
  readonly planError = signal('');
  readonly ackFallbacks = signal(false);
  readonly ackBlocked = signal(false);
  readonly busy = signal(false);
  readonly submitError = signal('');

  private nameTouched = false;
  private readonly planNonce = signal(0);

  readonly template = computed(() => this.templates().find((t) => t.id === this.templateId()) ?? null);

  readonly audience = computed<AudienceSpec | null>(() => {
    const seg: SegmentInput = { key: this.segmentKey(), language: this.segLanguage(), days: this.segDays(), minPoints: this.segPoints() };
    return buildAudience(this.audienceKind(), this.customerIds(), seg);
  });

  readonly segmentParams = computed(() => this.segments().find((s) => s.key === this.segmentKey())?.params ?? []);

  // Languages whose variants can be sent in the chosen mode (per-customer may use either).
  private readonly relevantVariants = computed<TemplateVariant[]>(() => {
    const t = this.template();
    if (!t) return [];
    const wanted = this.mode() === 'per_customer' ? ['en', 'ar'] : [this.mode()];
    return t.variants.filter((v) => wanted.includes(v.language));
  });

  private readonly usedFields = computed<string[]>(() => {
    const seen: string[] = [];
    for (const v of this.relevantVariants()) {
      const texts = [v.header, v.body, v.footer, ...v.buttons.flatMap((b) => [b.text, b.url ?? ''])];
      for (const f of texts.flatMap((x) => extractMergeFields(x))) if (!seen.includes(f)) seen.push(f);
    }
    const missing = this.plan()?.missingFieldValues ?? [];
    for (const f of missing) if (!seen.includes(f)) seen.push(f);
    return seen.sort((a, b) => this.rank(a) - this.rank(b));
  });

  readonly neededFields = computed(() => this.usedFields().filter((f) => !AUTO_FILLED_FIELDS.has(f)));
  readonly autoFields = computed(() => this.usedFields().filter((f) => AUTO_FILLED_FIELDS.has(f)));

  readonly fieldProblems = computed<Record<string, FieldProblem>>(() => {
    const values = this.fieldValues();
    const out: Record<string, FieldProblem> = {};
    for (const f of this.neededFields()) {
      const v = (values[f] ?? '').trim();
      out[f] = !v ? 'required' : f === 'link' && !isHttpsLink(v) ? 'https' : null;
    }
    return out;
  });
  readonly fieldsValid = computed(() => Object.values(this.fieldProblems()).every((p) => p === null));

  // Only the values of fields the chosen variants really use, and never an invalid link.
  readonly planFieldValues = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    const problems = this.fieldProblems();
    for (const f of this.neededFields()) {
      const v = (this.fieldValues()[f] ?? '').trim();
      if (v && problems[f] === null) out[f] = v;
    }
    return out;
  });

  readonly planRequest = computed<CampaignPlanRequest | null>(() => {
    const template = this.template();
    const audience = this.audience();
    if (!template || !audience) return null;
    return { templateId: template.id, languageMode: this.mode(), audience, fieldValues: this.planFieldValues() };
    // Structural equality: a re-plan changes `plan`, which feeds back into the needed fields; without
    // this the identical request would be rebuilt and re-planned forever.
  }, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

  readonly ackFallbacksRequired = computed(() => (this.plan()?.fallbacks.length ?? 0) > 0);
  readonly ackBlockedRequired = computed(() => (this.plan()?.blocked.length ?? 0) > 0);

  // Why the Send button is disabled (null = it can be used).
  readonly blocker = computed<string | null>(() => {
    const plan = this.plan();
    if (this.planState() === 'pending' || this.planState() === 'loading') return 'campaigns.send.hint.updating';
    if (!plan || this.planState() !== 'ready') return 'campaigns.send.hint.noPlan';
    if (!this.fieldsValid()) return 'campaigns.send.hint.fields';
    if (!plan.canSend) return 'campaigns.send.hint.cannot';
    if (this.ackFallbacksRequired() && !this.ackFallbacks()) return 'campaigns.send.hint.ack';
    if (this.ackBlockedRequired() && !this.ackBlocked()) return 'campaigns.send.hint.ack';
    if (!this.name().trim()) return 'campaigns.send.hint.name';
    return null;
  });
  readonly canSend = computed(() => this.blocker() === null && !this.busy());
  readonly canSaveDraft = computed(() => !!this.planRequest() && !!this.name().trim() && !this.busy());

  readonly unlocked = computed(() => ({
    options: !!this.template(),
    plan: !!this.planRequest(),
    send: !!this.plan(),
  }));

  constructor() {
    // Re-plan (debounced) whenever template / mode / audience / field values change.
    effect((onCleanup) => {
      const req = this.planRequest();
      this.planNonce();
      this.ackFallbacks.set(false);
      this.ackBlocked.set(false);
      if (!req) {
        this.plan.set(null);
        this.planState.set('idle');
        return;
      }
      this.planState.set('pending');
      let sub: { unsubscribe(): void } | undefined;
      const timer = setTimeout(() => {
        this.planState.set('loading');
        this.planError.set('');
        sub = this.api.planCampaign(req).subscribe({
          next: (plan) => {
            this.plan.set(plan);
            this.planState.set('ready');
          },
          error: (err) => {
            this.planState.set('error');
            this.planError.set(errorText(this.i18n, err));
            if (isNotEnabled(err)) this.hub.load(true);
          },
        });
      }, PLAN_DEBOUNCE_MS);
      onCleanup(() => {
        clearTimeout(timer);
        sub?.unsubscribe();
      });
    });
  }

  ngOnInit(): void {
    this.api.listTemplates({ archived: false }).subscribe({
      next: (res) => {
        this.templates.set(res.items.filter((t) => !t.archived));
        this.templatesLoading.set(false);
        const wanted = this.route.snapshot.queryParamMap.get('templateId');
        if (wanted && this.templates().some((t) => t.id === wanted)) this.selectTemplate(wanted);
      },
      error: (err) => {
        this.templatesLoading.set(false);
        this.templatesError.set(errorText(this.i18n, err));
        if (isNotEnabled(err)) this.hub.load(true);
      },
    });
    this.api.getSegments().subscribe({
      next: (res) => { if (res.items.length) this.segments.set(res.items); },
      error: () => { /* the built-in segment list is used */ },
    });
    this.destroyRef.onDestroy(() => this.ui.respond(false));
  }

  retryPlan(): void {
    this.planNonce.update((n) => n + 1);
  }

  private rank(key: string): number {
    const i = KNOWN_ORDER.indexOf(key);
    return i === -1 ? KNOWN_ORDER.length : i;
  }

  variantOf(t: LocalizedTemplate, lang: string): TemplateVariant | undefined {
    return t.variants.find((v) => v.language === lang);
  }

  cardLanguages(t: LocalizedTemplate): Array<'en' | 'ar' | 'bilingual'> {
    return this.variantOf(t, 'bilingual') ? ['en', 'ar', 'bilingual'] : ['en', 'ar'];
  }

  modeAvailable(mode: LanguageMode): boolean {
    const t = this.template();
    if (!t) return false;
    return mode === 'per_customer' ? t.variants.length > 0 : !!this.variantOf(t, mode);
  }

  // Annotation under a language option: missing version, or a version that isn't sendable yet.
  modeNote(mode: LanguageMode): string | null {
    const t = this.template();
    if (!t || mode === 'per_customer') return null;
    const v = this.variantOf(t, mode);
    if (!v) return 'campaigns.mode.missing';
    return v.sendable ? null : 'campaigns.mode.notApproved';
  }

  defaultLanguageLabel(): string {
    return this.i18n.t(`status.language.${this.hub.settings()?.defaultCustomerLanguage ?? 'en'}`);
  }

  fieldLabel(key: string): string {
    const k = `campaigns.field.${key}`;
    return this.i18n.has(k) ? this.i18n.t(k) : key;
  }

  fieldValue(key: string): string {
    return this.fieldValues()[key] ?? '';
  }

  fieldType(key: string): string {
    return key === 'date' ? 'date' : key === 'link' ? 'url' : 'text';
  }

  selectTemplate(id: string): void {
    this.templateId.set(id);
    const t = this.template();
    if (t && !this.modeAvailable(this.mode())) this.mode.set('per_customer');
    if (t && !this.nameTouched) this.name.set(`${t.name} — ${this.fmt.date(new Date())}`);
  }

  setMode(mode: LanguageMode): void {
    if (this.modeAvailable(mode)) this.mode.set(mode);
  }

  onName(value: string): void {
    this.nameTouched = true;
    this.name.set(value);
  }

  setField(key: string, value: string): void {
    this.fieldValues.update((m) => ({ ...m, [key]: value }));
  }

  // The date input is a native picker; the message gets an unambiguous numeric DD/MM/YYYY (Western digits).
  setDate(iso: string): void {
    this.dateRaw.set(iso);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    this.setField('date', m ? `${m[3]}/${m[2]}/${m[1]}` : '');
  }

  setNumber(target: 'days' | 'points', raw: string): void {
    const n = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
    (target === 'days' ? this.segDays : this.segPoints).set(Number.isFinite(n as number) ? n : null);
  }

  setAudienceKind(kind: AudienceKind): void {
    this.audienceKind.set(kind);
    if (kind === 'segment' && !this.segmentKey() && this.segments().length) this.segmentKey.set(this.segments()[0].key);
  }

  private createBody(): CampaignCreateRequest | null {
    const req = this.planRequest();
    const name = this.name().trim();
    return req && name ? { ...req, name } : null;
  }

  async saveDraft(): Promise<void> {
    const body = this.createBody();
    if (!body || !this.canSaveDraft()) return;
    this.busy.set(true);
    this.submitError.set('');
    try {
      const created = await firstValueFrom(this.api.createCampaign(body));
      this.ui.toast(this.i18n.t('campaigns.toast.draftSaved'), 'success');
      await this.router.navigate(['/arabic/campaigns', created.id]);
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  // Create -> confirm -> send. Nothing reaches the send endpoint before the user confirms; a second
  // click while the confirmation or the requests are in flight is ignored.
  async send(): Promise<void> {
    const plan = this.plan();
    const body = this.createBody();
    if (!plan || !body || !this.canSend()) return;
    this.busy.set(true);
    this.submitError.set('');
    const message = [sendSummary(this.i18n, plan), ...plan.fallbacks.map((f) => fallbackLine(this.i18n, f))].join(' ');
    const ok = await this.ui.confirm({
      title: this.i18n.t('campaigns.confirm.title'),
      message,
      confirmLabel: this.i18n.t('campaigns.confirm.send'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) {
      this.busy.set(false);
      return;
    }
    let id: string;
    try {
      id = (await firstValueFrom(this.api.createCampaign(body))).id;
    } catch (err) {
      this.fail(err);
      this.busy.set(false);
      return;
    }
    try {
      await firstValueFrom(this.api.sendCampaign(id, { fallbacks: this.ackFallbacks(), blocked: this.ackBlocked() }));
      this.ui.toast(this.i18n.t('campaigns.toast.sending'), 'success');
    } catch (err) {
      // The draft exists: open it so the user can re-check the plan and try again from there.
      this.ui.toast(errorText(this.i18n, err), 'error');
      if (isNotEnabled(err)) this.hub.load(true);
    }
    await this.router.navigate(['/arabic/campaigns', id]);
    this.busy.set(false);
  }

  private fail(err: unknown): void {
    this.submitError.set(errorText(this.i18n, err));
    if (isNotEnabled(err)) this.hub.load(true);
  }
}
