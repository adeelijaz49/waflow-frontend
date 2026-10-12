import { Injectable, inject, signal } from '@angular/core';
import { I18nService } from '../../../i18n';
import { LocalizationFlagService } from '../../../services/localization-flag.service';
import type { PromotionSendPlan } from '../localization.types';
import { planCounts } from './plan-summary.util';

export interface PublishedPlan {
  promotionId: string;
  selectedSize: number;
  plan: PromotionSendPlan;
}

// The Promotions page confirms a send with a dialog it owns; the language panel (a child) knows the
// plan. The panel publishes its last GOOD plan here and the page asks for a one/two-line English note to
// append to its confirmation. The note exists only when the merchant is flagged and the plan matches the
// promotion AND the exact selection being sent; otherwise it is '' (the dialog is then exactly today's).
// It never throws and never blocks anything.
@Injectable({ providedIn: 'root' })
export class LanguagePlanBridge {
  private readonly flag = inject(LocalizationFlagService);
  private readonly i18n = inject(I18nService);
  private readonly current = signal<PublishedPlan | null>(null);

  publish(entry: PublishedPlan | null): void {
    this.current.set(entry);
  }

  confirmNote(promotionId: string, selectedSize: number): string {
    try {
      if (!this.flag.arabicEnabled()) return '';
      const cur = this.current();
      if (!cur || cur.promotionId !== promotionId || cur.selectedSize !== selectedSize) return '';
      if (!this.i18n.has('promolang.confirm.note', 'en')) return '';
      const c = planCounts(cur.plan);
      if (c.ar === 0 && c.fallback === 0) return '';
      const head = this.i18n.t('promolang.confirm.note', { ar: c.ar, en: c.en + c.fallback }, 'en');
      if (c.fallback === 0) return `\n\n${head}`;
      const tail = this.i18n.tp('promolang.confirm.fallback', c.fallback, undefined, 'en');
      return `\n\n${head} ${tail}`;
    } catch {
      return '';
    }
  }
}
