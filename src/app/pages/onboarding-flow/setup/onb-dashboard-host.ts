import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { I18nService } from '../../../i18n/i18n.service';
import { Dashboard } from '../../dashboard/dashboard';
import { OnbStateService } from '../onb-state.service';
import { OnbHome } from './onb-home';
import { BillingScreen } from './screens/billing';

// /dashboard shadow for enrolled merchants whose setup needs attention (OnbStateService.hostNeeded):
//   takeover (none/pending)      -> the billing card
//   unfinished                   -> the checklist home
//   finished, prompts skipped    -> the two reminder cards above the existing dashboard (embedded unchanged)
// Finished and no reminders: the route's canMatch answers false and the plain existing dashboard renders.
@Component({
  selector: 'app-onb-dashboard-host',
  imports: [RouterLink, Dashboard, OnbHome, BillingScreen, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../styles/onb-base.css', '../styles/onb-parts.css'],
  template: `
    @if (i18n.ready()) {
      @if (state.takeover()) {
        <div class="onb onb-root" [appLangDir]="i18n.lang()"><div class="onb-wrap"><app-onb-billing /></div></div>
      } @else if (!state.finished()) {
        <div class="onb onb-root" [appLangDir]="i18n.lang()"><div class="onb-wrap"><app-onb-home /></div></div>
      } @else {
        <div class="onb" [appLangDir]="i18n.lang()">
          <div class="onb-wrap onb-reminders">
            @for (r of reminders(); track r.kind) {
              <div class="onb-alert onb-alert-warn" role="note">
                <span>{{ 'onboarding.home.reminder.' + r.kind | t }}</span>
                <a class="onb-link" [routerLink]="r.url">{{ 'onboarding.home.card.' + r.kind + '.cta' | t }}</a>
              </div>
            }
          </div>
        </div>
        <app-dashboard />
      }
    }
  `,
})
export class OnbDashboardHost implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly state = inject(OnbStateService);

  readonly reminders = computed(() => {
    const p = this.state.state()?.prompts;
    const rows: { kind: 'customers' | 'products'; url: string }[] = [];
    if (p?.customers?.state === 'pending' || p?.customers?.state === 'skipped') rows.push({ kind: 'customers', url: '/setup/customers' });
    if (p?.products?.state === 'pending' || p?.products?.state === 'skipped') rows.push({ kind: 'products', url: '/setup/products' });
    return rows;
  });

  ngOnInit(): void {
    this.state.shadowActive = true;
    void this.i18n.init().catch(() => undefined);
  }

  ngOnDestroy(): void {
    this.state.shadowActive = false;
  }
}
