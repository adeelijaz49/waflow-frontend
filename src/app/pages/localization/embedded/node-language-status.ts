import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApprovalBadge } from '../shared/approval-badge';
import { EmbeddedText } from './embedded-text';
import { ArabicState, MessageSource, TreeNode, arabicStateOf, arabicVersion, englishNotApproved, splitAppUrl } from './flow-language.util';

// The Arabic status of ONE flow/promotion message node as a compact line: WhatsApp approval + native
// review badges, one state word ("Sends in Arabic", "Needs native review", ...) and a link to the Arabic
// hub where it is edited. Read-only; shared by the language panel (matrix row) and the viewer strip.
@Component({
  selector: 'app-node-language-status',
  imports: [RouterLink, ApprovalBadge],
  template: `
    @if (ready()) {
      <span class="nls">
        @if (version(); as v) {
          @if (v.metaStatus === 'NOT_REQUIRED') {
            <span class="badge badge-neutral">{{ t('flowlang.notRequired') }}</span>
            <span class="badge" [class.badge-info]="v.reviewStatus === 'reviewed'" [class.badge-neutral]="v.reviewStatus !== 'reviewed'">{{ t(v.reviewStatus === 'reviewed' ? 'flowlang.review.reviewed' : 'flowlang.review.draft') }}</span>
          } @else {
            <app-approval-badge [status]="$any(v.metaStatus)" [review]="v.reviewStatus" [uiLang]="uiLang()" />
          }
        }
        <span class="nls-state" [class]="'nls-state nls-' + state()">{{ t('flowlang.state.' + state()) }}</span>
        @if (link(); as l) {
          <a class="nls-link" [routerLink]="l.url.commands" [queryParams]="l.url.queryParams">{{ t(l.textKey) }}</a>
        }
      </span>
    }
  `,
  styles: [`
    :host { display: inline-block; min-inline-size: 0; }
    .nls { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-inline-size: 0; }
    .nls-state { font-size: 12px; font-weight: 600; color: var(--text-muted, #64748b); }
    .nls-sends { color: #065f46; }
    .nls-stale, .nls-unusable, .nls-not_ready { color: #991b1b; }
    .nls-waiting, .nls-needs_review, .nls-not_submitted, .nls-english_pending { color: #92400e; }
    .nls-link { font-size: 12px; font-weight: 600; color: var(--primary, #3b82f6); text-decoration: none; }
    .nls-link:hover { text-decoration: underline; }
    .nls-link:focus-visible { outline: 2px solid var(--primary, #3b82f6); outline-offset: 2px; border-radius: 4px; }
  `],
})
export class NodeLanguageStatus extends EmbeddedText {
  readonly node = input.required<TreeNode>();
  readonly messageSource = input<MessageSource | null>(null);

  readonly version = computed(() => (this.messageSource() === 'default_template' ? null : arabicVersion(this.node())));
  readonly state = computed<ArabicState>(() => arabicStateOf(this.node(), this.messageSource()));
  readonly englishPending = computed(() => englishNotApproved(this.node()));

  readonly link = computed<{ url: NonNullable<ReturnType<typeof splitAppUrl>>; textKey: string } | null>(() => {
    if (this.messageSource() === 'default_template') return null;
    const n = this.node();
    const v = this.version();
    if (v) {
      const url = splitAppUrl(v.editUrl);
      return url ? { url, textKey: 'flowlang.edit' } : null;
    }
    const url = n.canAddArabic ? splitAppUrl(n.addArabicUrl) : null;
    return url ? { url, textKey: 'flowlang.add' } : null;
  });
}

export type { ArabicState };
