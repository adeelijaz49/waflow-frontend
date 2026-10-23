import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { I18nService } from '../../../i18n/i18n.service';
import { isLang, type Lang } from '../../../i18n/i18n.types';
import { LocUiHost } from '../../localization/shared/loc-ui-host';
import { OnbApiService } from '../onb-api.service';
import { OnbHelp, OnbHelpSheet } from '../onb-help';
import { OnbAnnouncer } from '../onb-focus';
import { OnbStateService } from '../onb-state.service';
import { OnbNotifications } from '../shell/onb-notifications';
import { OnbStatusPill } from '../shell/onb-status-pill';
import { OnbChecklist, checklistRows, currentStepNumber } from './onb-checklist';

// Route component of /setup: header (title, status pill, bell, language, help), progress, the five-step checklist
// (top sheet on phones, inline-start panel from 900 px), the routed screen, the shared toast/confirm host and the
// polite live region. Owns the page-level lang/dir (scoped to this subtree; the rest of the app stays as it is).
@Component({
  selector: 'app-onb-setup-shell',
  imports: [
    RouterOutlet, LocUiHost, OnbChecklist, OnbStatusPill, OnbNotifications, OnbHelp, OnbHelpSheet,
    ...I18N_DIRECTIVES, ...I18N_PIPES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './onb-setup-shell.html',
  styleUrls: ['./onb-setup-shell.css', '../styles/onb-base.css', '../styles/onb-parts.css'],
})
export class OnbSetupShell implements OnInit {
  readonly i18n = inject(I18nService);
  readonly state = inject(OnbStateService);
  readonly announcer = inject(OnbAnnouncer);
  private readonly api = inject(OnbApiService);
  private readonly route = inject(ActivatedRoute);

  readonly textsFailed = signal(false);
  readonly showSteps = signal(false);
  readonly bellOpen = signal(false);

  readonly rows = computed(() => checklistRows(this.state.state()));
  readonly stepNumber = computed(() => currentStepNumber(this.rows()));
  readonly otherLang = computed<Lang>(() => (this.i18n.lang() === 'ar' ? 'en' : 'ar'));

  ngOnInit(): void {
    this.start();
  }

  start(): void {
    this.textsFailed.set(false);
    const requested = this.route.snapshot.queryParamMap.get('lang');
    this.state.ensureLoaded();
    void this.i18n
      .init()
      .then(() => (isLang(requested) && requested !== this.i18n.lang() ? this.i18n.use(requested) : undefined))
      .catch(() => this.textsFailed.set(true));
  }

  switchLanguage(): void {
    const next = this.otherLang();
    void this.i18n.use(next).then(
      () => {
        // Best effort (gate A: the server refuses it unless the subscription is active, so it is skipped then).
        if (this.state.subState() === 'active') {
          this.api.preferences({ uiLanguage: next, languages: next === 'ar' ? ['ar', 'en'] : ['en'] }).subscribe({ error: () => undefined });
        }
      },
      () => undefined, // the other language could not be downloaded: stay in the current one
    );
  }
}
