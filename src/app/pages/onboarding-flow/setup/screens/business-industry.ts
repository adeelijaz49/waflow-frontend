import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, signal, untracked } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { ONB_INDUSTRY_KEYS } from '../../onb.types';
import { OnbAError, OnbASummary, BusinessScreenBase } from './onb-a-kit';

// Step 1, screen 2 of 4: "What kind of business is it?" One radio group, 56 px rows (real radios: arrow keys work and the
// chosen row is announced by the screen reader).
@Component({
  selector: 'app-onb-business-industry',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbASummary, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack">
      <h1 id="onb-industry-h" class="onb-q" tabindex="-1" onbFocus="onboarding.step.business" onbStep="business">{{ 'onboarding.business.industry.title' | t }}</h1>
      <app-onb-a-summary />
      <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
        <div class="onb-choices" role="radiogroup" aria-labelledby="onb-industry-h">
          @for (k of options(); track k) {
            <label class="onb-choice">
              <input type="radio" name="onb-industry" [value]="k" [checked]="chosen() === k" (change)="choose(k)" />
              <span class="onb-choice-name">{{ 'onboarding.industry.' + k | t }}</span>
            </label>
          }
        </div>
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="submit" class="onb-btn onb-btn-primary" [disabled]="busy() || !chosen()" [attr.aria-busy]="busy()">{{ 'onboarding.common.continue' | t }}</button>
          <div class="onb-bar-links"><span></span><app-onb-help /></div>
        </div>
      </form>
    </section>
  `,
})
export class BusinessIndustryScreen extends BusinessScreenBase {
  protected readonly field = 'industry' as const;
  readonly chosen = signal<string | null>(null);
  private started = false;

  /** The server's list when it sends one, else the contract list; only keys that have copy are offered. */
  readonly options = computed(() => {
    const fromServer = this.state.state()?.business?.industryOptions;
    const list = (Array.isArray(fromServer) ? fromServer : []).filter((k) => ONB_INDUSTRY_KEYS.includes(k));
    return list.length ? list : [...ONB_INDUSTRY_KEYS];
  });

  constructor() {
    super();
    effect(() => {
      const industry = this.state.state()?.business?.industry ?? null;
      untracked(() => {
        if (industry && !this.started) this.chosen.set(industry);
        if (this.state.state() !== null) this.started = true;
      });
    });
  }

  choose(key: string): void {
    this.chosen.set(key);
  }

  submit(e: Event): void {
    e.preventDefault();
    const industry = this.chosen();
    if (this.busy() || !industry || !this.options().includes(industry)) return;
    this.save({ industry }, 'industry');
  }
}
