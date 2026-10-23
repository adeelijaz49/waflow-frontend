import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { OnbStateService } from '../onb-state.service';

// /onboarding shadow for ENROLLED workspaces only (everyone else keeps the old wizard): goes to the landing URL.
@Component({
  selector: 'app-onb-entry',
  imports: [...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="onb-wrap"><div class="onb-row" role="status"><span class="onb-spinner"></span> {{ 'common.loading' | t }}</div></div>`,
})
export class OnbEntry implements OnInit, OnDestroy {
  private readonly state = inject(OnbStateService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.state.shadowActive = true;
    void this.router.navigateByUrl(this.state.landingUrl() ?? '/dashboard', { replaceUrl: true });
  }

  ngOnDestroy(): void {
    this.state.shadowActive = false;
  }
}
