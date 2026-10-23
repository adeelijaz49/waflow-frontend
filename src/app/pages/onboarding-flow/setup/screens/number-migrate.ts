import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, NumberScreenBase, OnbAError } from './onb-a-kit';

// Step 2, Path A, "move this number to WaFlow": the WhatsApp account on the number is deleted first. This screen is also where
// the connect step lands when Meta does not offer to keep the app on the number (then a short line says so).
@Component({
  selector: 'app-onb-number-migrate',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.migrate.title' | t }}</h1>
      @if (noCoexist()) {
        <p class="onb-alert onb-alert-info" role="note"><span class="onb-alert-icon" aria-hidden="true">&#8505;</span><span>{{ 'onboarding.number.migrate.noCoexist' | t }}</span></p>
      }
      <p class="onb-lead">{{ 'onboarding.number.migrate.body' | t }}</p>
      <app-onb-a-error [error]="error()" />
      <div class="onb-bar">
        <button type="button" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()" (click)="migrate()">{{ 'onboarding.number.migrate.go' | t }}</button>
        <div class="onb-bar-links">
          <button type="button" class="onb-link" [disabled]="busy()" (click)="different()">{{ 'onboarding.number.bizapp.other' | t }}</button>
          <app-onb-help />
        </div>
        <a class="onb-link" [routerLink]="urls.businessApp">{{ 'onboarding.common.back' | t }}</a>
      </div>
    </section>
  `,
})
export class NumberMigrateScreen extends NumberScreenBase {
  readonly urls = NUMBER_URLS;
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly fromQuery = (() => {
    try {
      return this.route?.snapshot?.queryParamMap?.get('reason') === 'coexistence';
    } catch {
      return false;
    }
  })();

  /** Meta did not offer to keep the app on this number (query marker from the connect step, or the server's last problem). */
  readonly noCoexist = computed(
    () =>
      this.fromQuery ||
      this.help.lastError() === 'CONNECT_COEXISTENCE_UNAVAILABLE' ||
      this.state.state()?.lastError?.code === 'CONNECT_COEXISTENCE_UNAVAILABLE',
  );

  migrate(): void {
    this.answer({ hasNumber: true, usage: 'business_app', businessAppChoice: 'migrate' }, NUMBER_URLS.connect);
  }

  different(): void {
    this.pathB({ hasNumber: true, usage: 'business_app', businessAppChoice: 'different_number' });
  }
}
