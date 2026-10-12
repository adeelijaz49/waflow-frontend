import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, Lang } from '../../../i18n';
import { ArabicState, arabicStateOf } from '../embedded/flow-language.util';
import type {
  FlowMessageSource, FlowNodeVersion, FlowTreeButton, FlowTreeNode, MessageLanguage, TemplateButton,
} from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { LangPill } from '../shared/lang-pill';
import { WaPreview } from '../shared/wa-preview';
import { FollowupEditor } from './followup-editor';
import { englishPreviewText, fillSamples, sampleLookup } from './followup.util';

export type PreviewMode = 'ar' | 'en' | 'both';

export interface NodePane {
  lang: 'ar' | 'en';
  missing: boolean;
  body: string;
  buttons: TemplateButton[];
  messageLanguage: MessageLanguage;
}

const ENTRY_LANGS: MessageLanguage[] = ['en', 'ar', 'bilingual'];
const FOLLOW_UP_LANGS: MessageLanguage[] = ['en', 'ar'];
const TEMPLATE_URL = /^\/arabic\/templates\/([^/?#]+)/;

// One message of a flow (the entry message or a follow-up reply): the English text and buttons, the status
// of every language version, a preview in the chosen language, and the actions - for the entry message the
// link to the template editor, for a follow-up the Arabic editor right here.
@Component({
  selector: 'app-loc-flow-node-card',
  imports: [NgClass, RouterLink, ApprovalBadge, LangPill, WaPreview, FollowupEditor, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './flow-node-card.html',
  styleUrl: './flow-node-card.css',
  host: {
    '[attr.id]': '"fl-node-" + node().messageNodeId',
    '[class.focused]': 'focused()',
    '[style.--fl-depth]': 'depth()',
  },
})
export class FlowNodeCard {
  private readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly node = input.required<FlowTreeNode>();
  readonly nodes = input<FlowTreeNode[]>([]);
  readonly messageSource = input<FlowMessageSource>('promotion');
  readonly mode = input<PreviewMode>('ar');
  // Opened from a deep link (/arabic/flows?node=<id>): expand and scroll to this card.
  readonly focused = input<boolean>(false);
  readonly localizing = input<boolean>(false);
  readonly localizeDisabled = input<boolean>(false);

  readonly localize = output<FlowTreeNode>();
  readonly versionChanged = output<{ nodeId: string; version: FlowNodeVersion | null }>();
  readonly reloadRequested = output<void>();

  readonly previewOpen = signal(false);
  readonly editing = signal(false);
  private readonly editor = viewChild(FollowupEditor);

  readonly depth = computed(() => Math.min(Math.max(this.node().depth ?? 0, 0), 3));
  readonly langs = computed(() => (this.node().isEntry ? ENTRY_LANGS : FOLLOW_UP_LANGS));
  readonly arabic = computed(() => this.versionOf('ar'));
  readonly stale = computed(() => this.arabic()?.stale === true);
  readonly state = computed<ArabicState>(() => arabicStateOf(this.node(), this.messageSource()));
  readonly parentLabel = computed(() => {
    const n = this.node();
    if (!n.parentNodeId || n.parentButtonPosition === null) return '';
    const parent = this.nodes().find((x) => x.messageNodeId === n.parentNodeId);
    return parent?.buttons.find((b) => b.position === n.parentButtonPosition)?.label ?? '';
  });
  // The linked template of an entry message, found through the edit link of any of its versions.
  readonly templateId = computed<string | null>(() => {
    for (const v of this.node().versions) {
      const m = TEMPLATE_URL.exec(v.editUrl ?? '');
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  });
  readonly editLink = computed(() => ['/arabic/templates', this.templateId() ?? '']);

  readonly panes = computed<NodePane[]>(() => {
    const node = this.node();
    const nodeButtons: TemplateButton[] = node.buttons.map((b) => ({ role: 'flow_button', text: b.label }));
    const english: NodePane = {
      lang: 'en', missing: false, messageLanguage: 'en', buttons: nodeButtons,
      body: this.fill(englishPreviewText(node), 'en'),
    };
    const make = (lang: 'ar' | 'en'): NodePane => {
      if (lang === 'en') return english;
      const v = this.versionOf('ar') ?? (node.isEntry ? this.versionOf('bilingual') : null);
      if (!v) return { ...english, lang, missing: true };
      return {
        lang, missing: false, messageLanguage: v.language,
        body: this.fill(v.body, 'ar'),
        buttons: v.buttons.length ? v.buttons.map((b) => ({ role: b.role, text: b.text })) : nodeButtons,
      };
    };
    const m = this.mode();
    return m === 'both' ? [make('ar'), make('en')] : [make(m)];
  });

  constructor() {
    void this.i18n.ensureLoaded('ar').catch(() => undefined); // sample values of the Arabic preview
    effect(() => {
      if (!this.focused()) return;
      untracked(() => {
        if (this.node().isEntry) this.previewOpen.set(true);
        else this.editing.set(true);
        setTimeout(() => {
          const el = this.host.nativeElement;
          if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 0);
      });
    });
  }

  versionOf(lang: MessageLanguage): FlowNodeVersion | null {
    return this.node().versions.find((v) => v.language === lang) ?? null;
  }

  tplClass(status: FlowTreeNode['templateStatus']): string {
    if (status === 'approved') return 'badge-success';
    if (status === 'pending') return 'badge-warning';
    if (status === 'rejected') return 'badge-danger';
    return 'badge-neutral';
  }

  stateClass(state: ArabicState): string {
    if (state === 'sends') return 'badge-success';
    if (state === 'unusable') return 'badge-danger';
    if (state === 'none' || state === 'english_only') return 'badge-neutral';
    return 'badge-warning';
  }

  actionKey(b: FlowTreeButton): string | null {
    const key = `flows.action.${b.action}`;
    return b.action === 'send_message' || !this.i18n.has(key) ? null : key;
  }

  // Closing goes through the editor so unsaved Arabic text is never dropped without asking.
  toggleEditor(): void {
    const editor = this.editor();
    if (this.editing() && editor) void editor.close();
    else this.editing.update((v) => !v);
  }
  togglePreview(): void { this.previewOpen.update((v) => !v); }

  onChanged(version: FlowNodeVersion | null): void {
    this.versionChanged.emit({ nodeId: this.node().messageNodeId, version });
  }

  private fill(text: string, lang: Lang): string {
    return fillSamples(text, sampleLookup(this.i18n, lang));
  }
}
