import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { FlowLanguageStore } from '../embedded/flow-language.store';
import { summarizeFlow } from '../embedded/flow-language.util';
import type { FlowNodeVersion, FlowTreeNode, FlowTreeRow, PromotionTreeRow } from '../localization.types';
import { errorStatus, errorText } from '../shared/loc-errors';
import { FlowNodeCard, PreviewMode } from './flow-node-card';

export type { PreviewMode } from './flow-node-card';

const MODES: PreviewMode[] = ['ar', 'en', 'both'];

// Automated Flows tab: the full message tree of every flow (the entry message and every follow-up reply) with the
// per-language status of each message, the Arabic editor for follow-up replies and a preview-language toggle.
// Below the flows, a second section lists the promotions that send their own message from the Promotions screen
// and are not used by any flow (their follow-up replies would otherwise be unreachable); same cards, same editor.
// A deep link /arabic/flows?node=<messageNodeId> opens and scrolls to one message (of a flow or of such a promotion).
@Component({
  selector: 'app-loc-flows-tab',
  imports: [NgClass, RouterLink, FlowNodeCard, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './flows-tab.html',
  styleUrl: './flows-tab.css',
})
export class FlowsTab {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(FlowLanguageStore);

  readonly modes = MODES;
  readonly flows = signal<FlowTreeRow[]>([]);
  readonly loading = signal(true);
  readonly refreshing = signal(false); // a quiet re-read is running (the list stays on screen)
  readonly error = signal('');
  readonly actionError = signal('');
  readonly busyNode = signal<string | null>(null);
  readonly mode = signal<PreviewMode>('ar');
  readonly hasFlows = computed(() => this.flows().length > 0);

  // Promotions with their own message that no flow sends. 'unavailable' = the backend does not offer the list
  // (404) or Arabic is off (402): the section is simply not shown. A failure here never hides the flows above.
  readonly promoRows = signal<PromotionTreeRow[]>([]);
  readonly promoState = signal<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  readonly promoError = signal('');
  readonly promoTruncated = signal(false);
  readonly hasPromos = computed(() => this.promoRows().length > 0);
  readonly showEmpty = computed(() => !this.hasFlows() && !this.hasPromos() && (this.promoState() === 'ready' || this.promoState() === 'unavailable'));

  // ?node=<messageNodeId> (re-evaluated on every in-app navigation)
  private readonly wantedNode = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('node') || null)), { initialValue: null });
  readonly focusId = computed<string | null>(() => {
    const id = this.wantedNode();
    if (!id || this.loading() || this.error()) return null;
    const inFlows = this.flows().some((f) => f.nodes.some((n) => n.messageNodeId === id));
    return inFlows || this.promoRows().some((p) => p.nodes.some((n) => n.messageNodeId === id)) ? id : null;
  });
  // "Not found" only once every list that could hold the message has answered (a failed promotion list is not "gone").
  readonly nodeMissing = computed(() => !!this.wantedNode() && !this.loading() && !this.error()
    && (this.promoState() === 'ready' || this.promoState() === 'unavailable') && this.focusId() === null);

  // Only the newest read may update the screen: a slow, older answer must not overwrite a newer one.
  private loadSeq = 0;
  private promoSeq = 0;

  constructor() {
    this.load();
  }

  // The Refresh button re-reads in place once there is a list: replacing the list by a spinner would drop an
  // open editor together with its unsaved Arabic text.
  refresh(): void { this.load(this.hasFlows() || this.hasPromos(), true); }

  load(quiet = false, report = false): void {
    const mine = ++this.loadSeq;
    if (quiet) this.refreshing.set(true);
    else this.loading.set(true);
    this.error.set('');
    if (report) this.actionError.set('');
    this.loadPromotions(quiet);
    this.api.listFlowTrees().subscribe({
      next: (res) => { if (mine !== this.loadSeq) return; this.flows.set(res?.items ?? []); this.loading.set(false); this.refreshing.set(false); },
      error: (err) => {
        if (mine !== this.loadSeq) return;
        this.refreshing.set(false);
        if (quiet && !this.loading()) { // keep what is on screen; the next full load shows the error
          if (report) this.actionError.set(errorText(this.i18n, err));
          return;
        }
        this.error.set(errorText(this.i18n, err));
        this.loading.set(false);
      },
    });
  }

  // The promotion section. A quiet re-read keeps what is on screen (and ignores a failure); a full one shows the
  // section's own loading / error state. Newest answer wins.
  loadPromotions(quiet = false): void {
    const mine = ++this.promoSeq;
    if (!quiet || this.promoState() === 'error') this.promoState.set('loading');
    this.api.listPromotionTrees().subscribe({
      next: (res) => {
        if (mine !== this.promoSeq) return;
        this.promoRows.set(res?.items ?? []);
        this.promoTruncated.set(res?.truncated === true);
        this.promoError.set('');
        this.promoState.set('ready');
      },
      error: (err) => {
        if (mine !== this.promoSeq) return;
        const status = errorStatus(err);
        if (status === 402 || status === 404) {
          this.promoRows.set([]);
          this.promoTruncated.set(false);
          this.promoState.set('unavailable');
        } else if (quiet && this.promoState() === 'ready') {
          // keep the list that is on screen; the next full load shows the error
        } else {
          this.promoRows.set([]);
          this.promoError.set(errorText(this.i18n, err));
          this.promoState.set('error');
        }
      },
    });
  }

  promoStatusKey(status: string): string {
    return `flows.promoStatus.${status === 'active' || status === 'expired' ? status : 'draft'}`;
  }

  triggerKey(type: string): string {
    const key = `flows.trigger.${type}`;
    return this.i18n.has(key) ? key : 'flows.trigger.other';
  }

  modeKey(m: PreviewMode): string {
    return m === 'ar' ? 'preview.arabicCustomer' : m === 'en' ? 'preview.englishCustomer' : 'flows.both';
  }

  // One line per flow, as on the Automated Flows page: can this flow's messages go out in Arabic?
  chip(flow: Pick<FlowTreeRow, 'messageSource' | 'nodes'>): string {
    const s = summarizeFlow(flow);
    switch (s.kind) {
      case 'english_only': return this.i18n.t('flowlang.chip.english_only');
      case 'none': return this.i18n.t('flowlang.chip.none');
      case 'ready':
        return s.followUpsTotal > 0
          ? this.i18n.t('flowlang.chip.readyFollowUps', { ready: s.followUpsReady, total: s.followUpsTotal })
          : this.i18n.t('flowlang.chip.ready');
      default: return this.i18n.t('flowlang.chip.notReady', { state: this.i18n.t(`flowlang.state.${s.entryState}`) });
    }
  }

  localize(node: FlowTreeNode): void {
    if (this.busyNode()) return;
    this.busyNode.set(node.messageNodeId);
    this.actionError.set('');
    this.api.localizeFlowMessage(node.messageNodeId).subscribe({
      next: (tpl) => {
        this.busyNode.set(null);
        void this.router.navigate(['/arabic/templates', tpl.id]);
      },
      error: (err) => { this.busyNode.set(null); this.actionError.set(errorText(this.i18n, err)); },
    });
  }

  // An editor saved or reviewed a follow-up: show the new state at once, then re-read the trees (statuses such as
  // "sendable" are computed by the server) and refresh what the Automated Flows / Promotions screens cached.
  onVersionChanged(flow: FlowTreeRow, change: { nodeId: string; version: FlowNodeVersion | null }): void {
    if (change.version) {
      const version = change.version;
      this.flows.update((rows) => rows.map((row) => (row.nodes.some((n) => n.messageNodeId === change.nodeId)
        ? {
            ...row,
            nodes: row.nodes.map((n) => (n.messageNodeId === change.nodeId
              ? { ...n, versions: [...n.versions.filter((v) => v.language !== 'ar'), version] }
              : n)),
          }
        : row)));
    }
    this.load(true);
    this.refreshEmbedded(flow);
  }

  // Same for a promotion row: patch the saved version in, re-read both lists, refresh the promotion's cached tree.
  onPromotionVersionChanged(row: PromotionTreeRow, change: { nodeId: string; version: FlowNodeVersion | null }): void {
    if (change.version) {
      const version = change.version;
      this.promoRows.update((rows) => rows.map((r) => (r.promotionId === row.promotionId
        ? {
            ...r,
            nodes: r.nodes.map((n) => (n.messageNodeId === change.nodeId
              ? { ...n, versions: [...n.versions.filter((v) => v.language !== 'ar'), version] }
              : n)),
          }
        : r)));
    }
    this.load(true);
    if (this.store.ownerTree('promotion', row.promotionId)().state !== 'idle') this.store.reloadOwner('promotion', row.promotionId);
  }

  private refreshEmbedded(flow: FlowTreeRow): void {
    // Only what some screen already loaded is refreshed: nothing is requested for screens nobody opened.
    if (this.store.all().state !== 'idle') this.store.reloadAll();
    if (this.store.ownerTree('flow', flow.flowId)().state !== 'idle') this.store.reloadOwner('flow', flow.flowId);
    if (flow.promotionId && this.store.ownerTree('promotion', flow.promotionId)().state !== 'idle') {
      this.store.reloadOwner('promotion', flow.promotionId);
    }
  }

}
