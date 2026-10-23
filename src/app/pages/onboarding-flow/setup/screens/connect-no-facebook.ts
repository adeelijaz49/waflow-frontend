import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp, OnbHelpService } from '../../onb-help';
import { ONB_EXTERNAL_LINKS } from '../../onb-links';

// "I don't have a Facebook account" (DF 4.4 S4): an explanation and the way forward. Nothing is sent to Meta from here.
@Component({
  selector: 'app-onb-connect-no-facebook',
  imports: [OnbFocus, OnbHelp, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="onb-wrap onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">{{ 'onboarding.connect.nofb.title' | t }}</h1>
      <div class="onb-alert onb-alert-info" role="note">
        <span class="onb-alert-icon" aria-hidden="true">&#8505;</span>
        <span>{{ 'onboarding.errors.CONNECT_NO_FACEBOOK_ACCOUNT' | t }}</span>
      </div>
      <a class="onb-btn onb-btn-secondary" [href]="signupUrl" target="_blank" rel="noopener noreferrer">{{ 'onboarding.connect.nofb.create' | t }}</a>
    </div>
    <div class="onb-bar">
      <button type="button" class="onb-btn onb-btn-primary" (click)="ready()">{{ 'onboarding.connect.nofb.ready' | t }}</button>
      <div class="onb-bar-links">
        <span></span>
        <app-onb-help />
      </div>
    </div>
  `,
})
export class ConnectNoFacebookScreen {
  private readonly router = inject(Router);
  private readonly help = inject(OnbHelpService);
  readonly signupUrl = ONB_EXTERNAL_LINKS.facebookSignup;

  constructor() {
    this.help.setLastError('CONNECT_NO_FACEBOOK_ACCOUNT');
  }

  /** "I can log in now": back to the Connect screen. */
  ready(): void {
    void this.router.navigateByUrl('/setup/connect');
  }
}
