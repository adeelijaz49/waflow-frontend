import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MetaStatus, TemplateButton } from '../localization.types';
import { ApprovalBadge } from '../shared/approval-badge';
import { WaPreview } from '../shared/wa-preview';
import { EmbeddedText } from './embedded-text';
import { FlowLanguageStore } from './flow-language.store';
import { NodeLanguageStatus } from './node-language-status';
import { PreviewLangToggle } from './preview-lang-toggle';
import {
  OwnerType, TreeNode, TreeVersion, arabicVersion, bilingualVersion, englishNotApproved, parentButtonLabel, splitAppUrl,
} from './flow-language.util';

const ENGLISH_STATUS: Record<string, MetaStatus> = {
  approved: 'APPROVED', pending: 'PENDING', rejected: 'REJECTED', not_created: 'NOT_CREATED',
};

// "Languages" panel of an existing screen: every message node of one promotion or flow (entry message +
// follow-ups, in tree order) with its English text and buttons, the Arabic version's approval/review
// state, and a preview toggle (English / Arabic / Both). Read-only: Arabic text is written in the Arabic
// hub (links). It shows the SAVED state, so it reloads whenever `anchor` changes (the host replaces it
// after a save / submit / refresh). Renders nothing while unavailable (402/404) or when there is no
// saved owner yet.
@Component({
  selector: 'app-flow-language-panel',
  imports: [RouterLink, ApprovalBadge, WaPreview, NodeLanguageStatus, PreviewLangToggle],
  templateUrl: './flow-language-panel.html',
  styleUrl: './flow-language-panel.css',
})
export class FlowLanguagePanel extends EmbeddedText {
  readonly store = inject(FlowLanguageStore);

  readonly ownerType = input.required<OwnerType>();
  readonly ownerId = input<string | null>(null);
  // Any object: a NEW reference means "the saved data changed, reload".
  readonly anchor = input<unknown>(null);
  readonly readonly = input<boolean>(false);

  readonly owner = computed(() => {
    const id = this.ownerId();
    return id ? this.store.ownerTree(this.ownerType(), id)() : null;
  });
  readonly tree = computed(() => this.owner()?.tree ?? null);
  readonly nodes = computed<TreeNode[]>(() => this.tree()?.nodes ?? []);
  readonly isDefaultTemplate = computed(() => this.tree()?.messageSource === 'default_template');
  readonly mode = this.store.previewMode;
  readonly visible = computed(() => {
    const o = this.owner();
    return !!o && o.state !== 'unavailable' && o.state !== 'idle';
  });

  constructor() {
    super();
    effect(() => {
      const type = this.ownerType();
      const id = this.ownerId();
      this.anchor();
      if (id) untracked(() => this.store.reloadOwner(type, id));
    });
  }

  retry(): void {
    const id = this.ownerId();
    if (id) this.store.reloadOwner(this.ownerType(), id);
  }

  indent(n: TreeNode): number { return Math.min(n.depth ?? 0, 3) * 14; }
  headingLabel(n: TreeNode): string { return parentButtonLabel(this.nodes(), n); }
  englishStatus(n: TreeNode): MetaStatus { return ENGLISH_STATUS[n.templateStatus ?? 'not_created'] ?? 'NOT_CREATED'; }
  arabic(n: TreeNode): TreeVersion | null { return arabicVersion(n); }
  bilingual(n: TreeNode): TreeVersion | null { return bilingualVersion(n); }
  englishPending(n: TreeNode): boolean { return englishNotApproved(n); }
  englishButtons(n: TreeNode): TemplateButton[] { return n.buttons.map((b) => ({ role: 'flow_button', text: b.label })); }
  arabicButtons(v: TreeVersion): TemplateButton[] {
    return v.buttons.map((b) => ({ role: b.role === 'opt_out' || b.role === 'url' ? b.role : 'flow_button', text: b.text }));
  }
  addUrl(n: TreeNode): ReturnType<typeof splitAppUrl> { return n.canAddArabic ? splitAppUrl(n.addArabicUrl) : null; }
}
