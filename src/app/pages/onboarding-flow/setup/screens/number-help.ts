import { ChangeDetectionStrategy, Component, ViewEncapsulation, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { onbErrorCode } from '../../onb-error';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { NUMBER_URLS, OnbAError, OnbScreenBase } from './onb-a-kit';

export const NUMBER_HELP_MAX = 300;

// Step 2, Path B: "Ask WaFlow to help me get a number". One optional note, ONE request (the server allows 3 a day and
// returns the existing request for a repeat). WaFlow does not buy numbers; the copy says so.
@Component({
  selector: 'app-onb-number-help',
  imports: [RouterLink, OnbFocus, OnbHelp, OnbAError, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack" [attr.aria-busy]="busy()">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.number" onbStep="number">{{ 'onboarding.number.help.title' | t }}</h1>
      @if (outcome() === 'sent') {
        <p class="onb-alert onb-alert-success" role="status"><span class="onb-alert-icon" aria-hidden="true">&#10003;</span><span>{{ 'onboarding.number.help.done' | t }}</span></p>
      } @else if (outcome() === 'already') {
        <p class="onb-alert onb-alert-info" role="status"><span class="onb-alert-icon" aria-hidden="true">&#8505;</span><span>{{ 'onboarding.number.help.already' | t }}</span></p>
      } @else {
        <form class="onb-stack" novalidate (submit)="send($event)">
          <div>
            <label class="onb-label" for="onb-help-note">{{ 'onboarding.number.help.field' | t }}</label>
            <textarea id="onb-help-note" class="onb-textarea" appUserText [attr.maxlength]="max" rows="4" enterkeyhint="send"
              [value]="note()" (input)="onNote($event)"></textarea>
          </div>
          <app-onb-a-error [error]="error()" />
          <div class="onb-bar">
            <button type="submit" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ 'onboarding.number.help.send' | t }}</button>
            <div class="onb-bar-links">
              <a class="onb-link" [routerLink]="urls.getOne">{{ 'onboarding.common.back' | t }}</a>
              <app-onb-help />
            </div>
          </div>
        </form>
      }
      @if (outcome() !== null) {
        <div class="onb-bar">
          <a class="onb-btn onb-btn-primary" [routerLink]="urls.paused">{{ 'onboarding.common.continue' | t }}</a>
          <div class="onb-bar-links"><span></span><app-onb-help /></div>
        </div>
      }
    </section>
  `,
})
export class NumberHelpScreen extends OnbScreenBase {
  readonly urls = NUMBER_URLS;
  readonly max = NUMBER_HELP_MAX;
  readonly note = signal('');
  /** null = not asked yet; 'sent' = the request was made; 'already' = the server says one is already open (rate limit). */
  readonly outcome = signal<'sent' | 'already' | null>(null);

  onNote(e: Event): void {
    this.note.set((e.target as HTMLTextAreaElement).value);
  }

  send(e: Event): void {
    e.preventDefault();
    if (this.busy() || this.outcome() !== null) return;
    this.busy.set(true);
    this.clearError();
    const message = this.note().replace(/\s+/g, ' ').trim().slice(0, NUMBER_HELP_MAX);
    this.api.numberSupportRequest(message || undefined).subscribe({
      next: () => {
        this.busy.set(false);
        this.outcome.set('sent');
        this.announcer.say('onboarding.number.help.done');
      },
      error: (err: unknown) => {
        if (onbErrorCode(err) === 'RATE_LIMITED') {
          this.busy.set(false);
          this.help.setLastError('RATE_LIMITED');
          this.outcome.set('already');
          this.announcer.say('onboarding.number.help.already');
        } else {
          this.fail(err);
        }
      },
    });
  }
}
