import { Component, computed, inject, input } from '@angular/core';
import { EmbeddedText } from './embedded-text';
import { FlowLanguageStore } from './flow-language.store';
import { summarizeFlow } from './flow-language.util';

// One line on a Flows page card: whether this flow's messages can go out in Arabic ("Sends in Arabic.
// Follow-ups ready: 1 of 2", "Arabic not ready: Waiting for WhatsApp", "No Arabic version yet", "English
// only (fixed message)"). All chips share ONE tree request (the store). Renders nothing until the answer
// arrives, when the Arabic area is unavailable, or when the flow is not in the answer.
@Component({
  selector: 'app-flow-language-chip',
  template: `
    @if (ready() && text(); as txt) {
      <div class="flc" [class]="'flc flc-' + kind()" role="status">{{ txt }}</div>
    }
  `,
  styles: [`
    :host { display: block; min-inline-size: 0; }
    .flc { margin-block: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted, #64748b); overflow-wrap: anywhere; }
    .flc-ready { color: #065f46; }
    .flc-not_ready { color: #92400e; }
  `],
})
export class FlowLanguageChip extends EmbeddedText {
  private readonly store = inject(FlowLanguageStore);

  readonly flowId = input.required<string>();

  private readonly row = computed(() => {
    const s = this.store.all();
    return s.state === 'ready' || (s.state === 'loading' && s.items.length) ? s.items.find((f) => f.flowId === this.flowId()) ?? null : null;
  });
  readonly summary = computed(() => (this.row() ? summarizeFlow(this.row()!) : null));
  readonly kind = computed(() => this.summary()?.kind ?? '');

  readonly text = computed<string>(() => {
    const s = this.summary();
    if (!s || !this.ready()) return '';
    switch (s.kind) {
      case 'english_only': return this.t('flowlang.chip.english_only');
      case 'none': return this.t('flowlang.chip.none');
      case 'ready':
        return s.followUpsTotal > 0
          ? this.t('flowlang.chip.readyFollowUps', { ready: s.followUpsReady, total: s.followUpsTotal })
          : this.t('flowlang.chip.ready');
      default: return this.t('flowlang.chip.notReady', { state: this.t(`flowlang.state.${s.entryState}`) });
    }
  });

  constructor() {
    super();
    this.store.ensureAll();
  }
}
