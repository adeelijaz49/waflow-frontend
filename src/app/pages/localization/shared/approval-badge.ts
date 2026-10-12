import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { I18N_PIPES, Lang } from '../../../i18n';
import type { MetaStatus, ReviewStatus } from '../localization.types';

// Per-language approval badge (spec Phase 2): Meta's approval status
// (Not created / Pending / Approved / Rejected ...) plus the native-review
// status (Draft / Reviewed), reusing the app's global .badge-* classes. A
// "flagged" marker is shown when WhatsApp warned that the version is at risk.
@Component({
  selector: 'app-approval-badge',
  imports: [NgClass, ...I18N_PIPES],
  template: `
    <span class="badge" [ngClass]="metaClass()">{{ ('status.meta.' + status()) | t:undefined:uiLang() }}</span>
    @if (flagged()) {
      <span class="badge badge-warning">{{ 'status.flagged' | t:undefined:uiLang() }}</span>
    }
    @if (review()) {
      <span class="badge" [ngClass]="review() === 'reviewed' ? 'badge-info' : 'badge-neutral'">{{ ('status.review.' + review()) | t:undefined:uiLang() }}</span>
    }
  `,
  styles: [`:host { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }`],
})
export class ApprovalBadge {
  readonly status = input<MetaStatus>('NOT_CREATED');
  readonly review = input<ReviewStatus | null>(null);
  readonly flagged = input<boolean>(false);
  // Force the label language (the existing English screens pass 'en'); undefined = the active UI language.
  readonly uiLang = input<Lang | undefined>(undefined);

  readonly metaClass = computed(() => {
    switch (this.status()) {
      case 'APPROVED': return 'badge-success';
      case 'PENDING':
      case 'IN_APPEAL':
      case 'PAUSED': return 'badge-warning';
      case 'REJECTED':
      case 'DISABLED':
      case 'DELETED':
      case 'PENDING_DELETION':
      case 'LIMIT_EXCEEDED':
      case 'ERROR': return 'badge-danger';
      default: return 'badge-neutral'; // NOT_CREATED, ARCHIVED
    }
  });
}
