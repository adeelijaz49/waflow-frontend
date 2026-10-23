import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { OnbStateService } from '../onb-state.service';

// /setup index: resumes where the merchant left off. Also the Stripe return URL (/setup?checkout=return|cancel):
// the redirect is never proof of payment, so the state is re-read from the server first and the billing screen
// (which polls) is shown while the subscription is not active.
@Component({
  selector: 'app-onb-resume',
  imports: [...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="onb-wrap"><div class="onb-row" role="status"><span class="onb-spinner"></span> {{ 'common.loading' | t }}</div></div>`,
})
export class OnbResume implements OnInit {
  private readonly state = inject(OnbStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    void this.go();
  }

  private async go(): Promise<void> {
    const checkout = this.route.snapshot.queryParamMap.get('checkout');
    const known = checkout === 'return' || checkout === 'cancel' ? checkout : null;
    try {
      // a returning payer (or a merchant coming back from the billing portal) must not see yesterday's answer
      if (known || this.state.subState() !== 'active') await this.state.reloadNow();
    } catch {
      /* use what we have */
    }
    if (known && this.state.takeover()) {
      await this.router.navigate(['/setup/billing'], { queryParams: { checkout: known }, replaceUrl: true });
      return;
    }
    await this.router.navigateByUrl(this.state.landingUrl() ?? '/dashboard', { replaceUrl: true });
  }
}
