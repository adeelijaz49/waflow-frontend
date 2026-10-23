import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import type { OnbLevel } from '../onb.types';

// The persistent WhatsApp status pill (strip + setup header). Icon AND word, never colour alone.
@Component({
  selector: 'app-onb-status-pill',
  imports: [...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill" [attr.data-level]="kind()"><span aria-hidden="true" [innerHTML]="glyph()"></span> {{ key() | t }}</span>`,
  styles: [`
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 14px; font-weight: 600; border: 1px solid var(--border); background: var(--surface); color: var(--text); white-space: nowrap; }
    .pill[data-level="connected"] { color: #065f46; border-color: var(--success); }
    .pill[data-level="attention"] { color: #78350f; border-color: var(--warning); }
    .pill[data-level="reconnect"] { color: #7f1d1d; border-color: var(--danger); }
  `],
})
export class OnbStatusPill {
  readonly level = input<OnbLevel | string | null | undefined>(null);

  readonly kind = computed<'connected' | 'attention' | 'reconnect' | 'none'>(() => {
    const l = this.level();
    return l === 'connected' ? 'connected' : l === 'needs_attention' ? 'attention' : l === 'reconnect_needed' ? 'reconnect' : 'none';
  });

  readonly key = computed(() => {
    switch (this.kind()) {
      case 'connected': return 'onboarding.pill.connected';
      case 'attention': return 'onboarding.pill.attention';
      case 'reconnect': return 'onboarding.pill.reconnect';
      default: return 'onboarding.pill.notConnected';
    }
  });

  // HTML entities (check mark, warning sign, cross, circle) keep the source ASCII-only.
  readonly glyph = computed(() => {
    switch (this.kind()) {
      case 'connected': return '&#10003;';
      case 'attention': return '&#9888;';
      case 'reconnect': return '&#10007;';
      default: return '&#9675;';
    }
  });
}
