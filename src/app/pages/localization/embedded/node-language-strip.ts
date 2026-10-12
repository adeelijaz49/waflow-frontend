import { Component, computed, inject, input } from '@angular/core';
import type { TemplateButton } from '../localization.types';
import { WaPreview } from '../shared/wa-preview';
import { EmbeddedText } from './embedded-text';
import { FlowLanguageStore } from './flow-language.store';
import { NodeLanguageStatus } from './node-language-status';
import { OwnerType, TreeNode, TreeVersion, arabicVersion } from './flow-language.util';

// A thin status strip under ONE business bubble of the Conversation Flow Viewer: the Arabic version's
// status chips, and (preview mode Arabic / Both) a read-only Arabic card under the English bubble. The
// English bubble stays the edit handle; Arabic text is edited in the hub. It is passive: it reads the
// tree the language panel in the same view has loaded, and renders nothing when the node is not in that
// tree, the tree is unavailable, or the owner has no saved id yet.
@Component({
  selector: 'app-node-language-strip',
  imports: [WaPreview, NodeLanguageStatus],
  template: `
    @if (ready() && node(); as n) {
      <div class="nls-strip">
        <div class="nls-row">
          <span class="nls-tag">{{ t('flowlang.arShort') }}</span>
          <app-node-language-status [node]="n" [messageSource]="messageSource()" [uiLang]="uiLang()" />
        </div>
        @if (mode() !== 'en' && version(n); as v) {
          <div class="nls-card">
            <app-wa-preview language="ar" [body]="v.body" [buttons]="buttons(v)" [uiLang]="uiLang()" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-inline-size: 0; }
    .nls-strip { display: flex; flex-direction: column; gap: 6px; min-inline-size: 0; margin-block: 4px 8px; padding-inline-start: 12px; border-inline-start: 2px solid var(--border, #e2e8f0); }
    .nls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .nls-tag { font-size: 11px; font-weight: 700; color: var(--text-muted, #64748b); }
    .nls-card { max-inline-size: 340px; }
  `],
})
export class NodeLanguageStrip extends EmbeddedText {
  private readonly store = inject(FlowLanguageStore);

  readonly ownerType = input.required<OwnerType>();
  readonly ownerId = input<string | null>(null);
  readonly nodeId = input.required<string>();

  readonly mode = this.store.previewMode;

  private readonly tree = computed(() => {
    const id = this.ownerId();
    return id ? this.store.ownerTree(this.ownerType(), id)().tree : null;
  });
  readonly messageSource = computed(() => this.tree()?.messageSource ?? null);
  readonly node = computed<TreeNode | null>(() => this.tree()?.nodes.find((n) => n.messageNodeId === this.nodeId()) ?? null);

  version(n: TreeNode): TreeVersion | null { return this.messageSource() === 'default_template' ? null : arabicVersion(n); }
  buttons(v: TreeVersion): TemplateButton[] {
    return v.buttons.map((b) => ({ role: b.role === 'opt_out' || b.role === 'url' ? b.role : 'flow_button', text: b.text }));
  }
}
