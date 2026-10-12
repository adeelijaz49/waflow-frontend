import { Component, computed, inject, input, output } from '@angular/core';
import { I18N_DIRECTIVES, I18N_PIPES, I18nService } from '../../../i18n';
import type { AiModePendingAction } from '../localization.types';
import { LocUiService } from '../shared/loc-ui.service';
import { DANGER_TOOLS, detailRows } from './aim-helpers';

// The human-approval gate. It shows the server's deterministic summary and the
// key arguments, and only ever EMITS a decision when the user presses a button:
// it never confirms by itself. Irreversible actions (refund) ask once more.
@Component({
  selector: 'app-aim-confirm-card',
  imports: [...I18N_DIRECTIVES, ...I18N_PIPES],
  templateUrl: './aim-confirm-card.html',
  styleUrl: './aim-confirm-card.css',
})
export class AimConfirmCard {
  private readonly i18n = inject(I18nService);
  private readonly ui = inject(LocUiService);

  readonly action = input.required<AiModePendingAction>();
  readonly busy = input(false);
  readonly decide = output<boolean>();

  readonly danger = computed(() => DANGER_TOOLS.includes(this.action().toolName));
  readonly rows = computed(() => detailRows(this.i18n, this.action()));

  async confirm(): Promise<void> {
    if (this.busy()) return;
    if (this.danger()) {
      const ok = await this.ui.confirm({
        title: this.i18n.t('aimode.confirm.refundTitle'),
        message: `${this.action().summary}\n\n${this.i18n.t('aimode.confirm.refundWarning')}`,
        confirmLabel: this.i18n.t('aimode.confirm.refundYes'),
        cancelLabel: this.i18n.t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    this.decide.emit(true);
  }

  cancel(): void {
    if (!this.busy()) this.decide.emit(false);
  }
}
