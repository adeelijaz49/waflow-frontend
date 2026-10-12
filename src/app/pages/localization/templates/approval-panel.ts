import { Component, computed, inject, input, output, signal } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService, LocaleFormatService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { ApprovalBadge } from '../shared/approval-badge';
import { errorText } from '../shared/loc-errors';
import { LocUiService } from '../shared/loc-ui.service';
import type { LocalizedTemplate, MessageLanguage, ReviewStatus, TemplateVariant, TemplatesUsage } from '../localization.types';
import { canSubmitStatus, isRealRejectionReason } from './template-utils';

const SENDABLE_REASONS = new Set([
  'not_submitted', 'pending', 'rejected', 'paused', 'disabled', 'flagged', 'not_approved', 'not_reviewed', 'missing',
]);

// Approval and review panel of ONE language version: the WhatsApp (Meta) status, submit for approval,
// refresh, test message to the merchant's own phone, native-review marks and the plain-language
// "can this be sent?" line. Every action that reaches WhatsApp, a phone, or marks wording as reviewed
// goes through an explicit confirmation first.
@Component({
  selector: 'app-loc-approval-panel',
  imports: [ApprovalBadge, ...I18N_PIPES, ...I18N_DIRECTIVES],
  templateUrl: './approval-panel.html',
  styleUrl: './approval-panel.css',
})
export class ApprovalPanel {
  private readonly api = inject(LocalizationApiService);
  private readonly ui = inject(LocUiService);
  private readonly fmt = inject(LocaleFormatService);
  readonly i18n = inject(I18nService);

  readonly template = input.required<LocalizedTemplate>();
  readonly variant = input.required<TemplateVariant | null>();
  readonly language = input.required<MessageLanguage>();
  // Unsaved edits in the editor, and how many blocking problems the checks found.
  readonly dirty = input<boolean>(false);
  readonly errorCount = input<number>(0);
  readonly usage = input<TemplatesUsage | null>(null);
  readonly templateChange = output<LocalizedTemplate>();

  readonly busy = signal<'submit' | 'refresh' | 'test' | 'review' | null>(null);
  readonly error = signal<string | null>(null);
  readonly phone = signal('');

  readonly rejectionReason = computed(() => {
    const r = this.variant()?.metaRejectedReason;
    return isRealRejectionReason(r) ? (r as string) : null;
  });
  readonly categoryChanged = computed(() => {
    const v = this.variant();
    return !!v?.metaCategory && v.metaCategory !== this.template().category ? v.metaCategory : null;
  });
  readonly lastChecked = computed(() => {
    const at = this.variant()?.metaLastCheckedAt;
    return at ? this.fmt.dateTime(at) : null;
  });
  readonly reviewedOn = computed(() => {
    const at = this.variant()?.reviewedAt;
    return at ? this.fmt.date(at, 'medium') : null;
  });

  // Why Submit is off (null = it can be pressed).
  readonly submitBlock = computed<string | null>(() => {
    const v = this.variant();
    if (!v) return 'dirty';
    if (this.dirty()) return 'dirty';
    if (this.errorCount() > 0) return 'invalid';
    if (this.usage()?.atCeiling) return 'ceiling';
    if (v.metaStatus === 'PENDING' || v.metaStatus === 'IN_APPEAL') return 'pending';
    if (v.metaStatus === 'APPROVED') return 'approved';
    if (!canSubmitStatus(v.metaStatus)) return 'status';
    return null;
  });
  readonly canTest = computed(() => this.variant()?.metaStatus === 'APPROVED' && !this.dirty());
  readonly sendableKey = computed(() => {
    const v = this.variant();
    if (!v) return 'templates.sendable.missing';
    if (v.sendable) return 'templates.sendable.ok';
    const reason = v.notSendableReason ?? '';
    return SENDABLE_REASONS.has(reason) ? `templates.sendable.${reason}` : 'templates.sendable.unknown';
  });
  readonly languageName = computed(() => this.i18n.t(`status.language.${this.language()}`));
  readonly statusHelpKey = computed(() => {
    const status = this.variant()?.metaStatus ?? 'NOT_CREATED';
    return this.i18n.has(`templates.statusHelp.${status}`) ? `templates.statusHelp.${status}` : null;
  });

  async submit(): Promise<void> {
    const v = this.variant();
    if (!v || this.submitBlock() !== null || this.busy()) return;
    const ok = await this.ui.confirm({
      title: this.i18n.t('templates.submit.confirmTitle'),
      message: this.i18n.t('templates.submit.confirmMessage', { language: this.languageName() }),
      confirmLabel: this.i18n.t('templates.submit.confirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.busy.set('submit');
    this.error.set(null);
    this.api.submitVariant(this.template().id, this.language()).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.templateChange.emit(res.template);
        this.ui.toast(this.i18n.t('templates.submit.done'), 'success');
        if (res.submission?.dryRun) this.ui.toast(this.i18n.t('templates.dryRunNotice'), 'info', 7000);
      },
      error: (err) => this.fail(err),
    });
  }

  refresh(): void {
    if (this.busy()) return;
    this.busy.set('refresh');
    this.error.set(null);
    const id = this.template().id;
    this.api.refreshTemplateStatuses(id).subscribe({
      next: () => {
        this.api.getTemplate(id).subscribe({
          next: (t) => {
            this.busy.set(null);
            this.templateChange.emit(t);
            this.ui.toast(this.i18n.t('templates.refreshStatusDone'), 'success');
          },
          error: (err) => this.fail(err),
        });
      },
      error: (err) => this.fail(err),
    });
  }

  async testSend(): Promise<void> {
    const phone = this.phone().trim();
    if (!this.canTest() || this.busy()) return;
    if (!phone) {
      this.error.set(this.i18n.t('templates.test.needPhone'));
      return;
    }
    const ok = await this.ui.confirm({
      title: this.i18n.t('templates.test.confirmTitle'),
      message: this.i18n.t('templates.test.confirmMessage', { phone }),
      confirmLabel: this.i18n.t('templates.test.confirm'),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.busy.set('test');
    this.error.set(null);
    this.api.testSendVariant(this.template().id, this.language(), phone).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.ui.toast(this.i18n.t(res.dryRun ? 'templates.dryRunNotice' : 'templates.test.done'), res.dryRun ? 'info' : 'success', res.dryRun ? 7000 : 4500);
      },
      error: (err) => this.fail(err),
    });
  }

  async review(status: ReviewStatus): Promise<void> {
    if (!this.variant() || this.busy() || (status === 'reviewed' && this.dirty())) return;
    const base = status === 'reviewed' ? 'templates.review.confirmReviewed' : 'templates.review.confirmDraft';
    const ok = await this.ui.confirm({
      title: this.i18n.t(`${base}Title`),
      message: this.i18n.t(`${base}Message`, { language: this.languageName() }),
      confirmLabel: this.i18n.t(base),
      cancelLabel: this.i18n.t('common.cancel'),
    });
    if (!ok) return;
    this.busy.set('review');
    this.error.set(null);
    this.api.reviewVariant(this.template().id, this.language(), status).subscribe({
      next: (t) => {
        this.busy.set(null);
        this.templateChange.emit(t);
        this.ui.toast(this.i18n.t(status === 'reviewed' ? 'templates.review.doneReviewed' : 'templates.review.doneDraft'), 'success');
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.busy.set(null);
    this.error.set(errorText(this.i18n, err));
  }
}
