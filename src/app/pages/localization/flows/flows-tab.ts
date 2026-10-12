import { Component, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type {
  FlowMessageNodeRow, FlowMessageRow, LocalizedTemplate, MessageLanguage, TemplateButton, TemplateVariant,
} from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { LangPill } from '../shared/lang-pill';
import { errorText } from '../shared/loc-errors';
import { WaPreview } from '../shared/wa-preview';

export type PreviewMode = 'ar' | 'en' | 'both';
type TemplateState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; template: LocalizedTemplate };
export interface PreviewPane {
  lang: 'ar' | 'en';
  variant: TemplateVariant | null;
  missing: boolean;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  messageLanguage: MessageLanguage;
}

const LANGS: MessageLanguage[] = ['en', 'ar', 'bilingual'];

// Automated Flows tab: per-language versions and approval status of each flow's entry message.
@Component({
  selector: 'app-loc-flows-tab',
  imports: [NgClass, RouterLink, ApprovalBadge, LangPill, WaPreview, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './flows-tab.html',
  styleUrl: './flows-tab.css',
})
export class FlowsTab {
  private readonly api = inject(LocalizationApiService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly langs = LANGS;
  readonly flows = signal<FlowMessageRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly busyNode = signal<string | null>(null);
  readonly openNode = signal<string | null>(null);
  readonly mode = signal<PreviewMode>('ar');
  readonly templates = signal<Record<string, TemplateState>>({});
  readonly hasFlows = computed(() => this.flows().length > 0);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.listFlowMessages().subscribe({
      next: (res) => { this.flows.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(errorText(this.i18n, err)); this.loading.set(false); },
    });
  }

  triggerKey(type: string): string {
    const key = `flows.trigger.${type}`;
    return this.i18n.has(key) ? key : 'flows.trigger.other';
  }

  tplClass(status: FlowMessageNodeRow['templateStatus']): string {
    if (status === 'approved') return 'badge-success';
    if (status === 'pending') return 'badge-warning';
    if (status === 'rejected') return 'badge-danger';
    return 'badge-neutral';
  }

  variantOf(node: FlowMessageNodeRow, lang: MessageLanguage) {
    return node.variantStatus.find((v) => v.language === lang) ?? null;
  }

  localize(node: FlowMessageNodeRow): void {
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

  editLink(node: FlowMessageNodeRow): string[] {
    return ['/arabic/templates', node.localizedTemplateId ?? ''];
  }

  togglePreview(node: FlowMessageNodeRow): void {
    const id = node.messageNodeId;
    if (this.openNode() === id) { this.openNode.set(null); return; }
    this.openNode.set(id);
    if (node.localizedTemplateId) this.loadTemplate(id, node.localizedTemplateId);
  }

  private loadTemplate(nodeId: string, templateId: string): void {
    const cur = this.templates()[nodeId];
    if (cur && cur.state !== 'error') return;
    this.templates.update((m) => ({ ...m, [nodeId]: { state: 'loading' } }));
    this.api.getTemplate(templateId).subscribe({
      next: (template) => this.templates.update((m) => ({ ...m, [nodeId]: { state: 'ready', template } })),
      error: (err) => this.templates.update((m) => ({ ...m, [nodeId]: { state: 'error', message: errorText(this.i18n, err) } })),
    });
  }

  retryTemplate(node: FlowMessageNodeRow): void {
    if (node.localizedTemplateId) this.loadTemplate(node.messageNodeId, node.localizedTemplateId);
  }

  tplState(node: FlowMessageNodeRow): TemplateState | null {
    return this.templates()[node.messageNodeId] ?? null;
  }

  // Panes for the chosen preview mode. A language without a version falls back to the English message
  // (what customers really receive today) and is flagged as missing.
  panes(node: FlowMessageNodeRow): PreviewPane[] {
    const st = this.tplState(node);
    const variants = st?.state === 'ready' ? st.template.variants : [];
    const nodeButtons: TemplateButton[] = node.buttons.map((b) => ({ role: 'flow_button', text: b.label }));
    const english: PreviewPane = {
      lang: 'en', variant: null, missing: false, header: '', footer: '', body: node.bodyText,
      buttons: nodeButtons, messageLanguage: 'en',
    };
    const make = (lang: 'ar' | 'en'): PreviewPane => {
      const v = variants.find((x) => x.language === lang) ?? variants.find((x) => x.language === 'bilingual') ?? null;
      if (!v) return lang === 'en' ? english : { ...english, lang, missing: true };
      return {
        lang, variant: v, missing: false, header: v.header, footer: v.footer, body: v.body,
        buttons: v.buttons.length ? v.buttons : nodeButtons, messageLanguage: v.language,
      };
    };
    const m = this.mode();
    return m === 'both' ? [make('ar'), make('en')] : [make(m)];
  }
}
