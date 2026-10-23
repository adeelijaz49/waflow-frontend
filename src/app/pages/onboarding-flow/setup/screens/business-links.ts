import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, signal, untracked } from '@angular/core';
import { I18N_DIRECTIVES } from '../../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../../i18n/i18n.pipes';
import { OnbFocus } from '../../onb-focus';
import { OnbHelp } from '../../onb-help';
import { OnbAError, OnbASummary, BusinessScreenBase, type fieldOfError } from './onb-a-kit';
import { classifyLink, cleanLine, nextBusinessUrl, validContactEmail } from './onb-business-rules';

const EMAIL_FIELD_ID = 'onb-biz-email';

// Step 1, screen 3 of 4: "Where can customers find you?" One optional field. An Instagram name, an instagram.com address or
// a website are told apart on the device (classifyLink); invalid text shows an inline message and sends nothing.
// A second, equally optional field asks for an email address for updates (backend notifications and reminders: a phone-only
// account would never get any). Pre-filled from the saved address, else from the one captured at checkout; Skip leaves both alone.
@Component({
  selector: 'app-onb-business-links',
  imports: [OnbFocus, OnbHelp, OnbAError, OnbASummary, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../styles/onb-choices.css'],
  template: `
    <section class="onb-stack">
      <h1 class="onb-q" tabindex="-1" onbFocus="onboarding.step.business" onbStep="business">{{ 'onboarding.business.links.title' | t }}</h1>
      <app-onb-a-summary />
      <p class="onb-lead">{{ 'onboarding.business.links.body' | t }}</p>
      <form class="onb-stack" novalidate (submit)="submit($event)" [attr.aria-busy]="busy()">
        <div>
          <label class="onb-label" for="onb-biz-links">{{ 'onboarding.business.links.field' | t }}</label>
          <input id="onb-biz-links" class="onb-input" type="text" dir="ltr" inputmode="url" autocomplete="url" enterkeyhint="next"
            autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="220"
            [placeholder]="'onboarding.business.links.placeholder' | t"
            [value]="value()" (input)="onInput($event)" [attr.aria-invalid]="fieldError() ? 'true' : null" aria-describedby="onb-biz-links-err" />
          @if (fieldError()) {
            <p id="onb-biz-links-err" class="onb-field-error" role="alert">{{ 'onboarding.business.error.links' | t }}</p>
          }
        </div>
        <div>
          <label class="onb-label" for="onb-biz-email">{{ 'onboarding.business.email.field' | t }}</label>
          <input id="onb-biz-email" class="onb-input" type="email" dir="ltr" inputmode="email" autocomplete="email" enterkeyhint="done"
            autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="120"
            [placeholder]="'onboarding.business.email.placeholder' | t"
            [value]="email()" (input)="onEmail($event)" [attr.aria-invalid]="emailError() ? 'true' : null"
            aria-describedby="onb-biz-email-hint onb-biz-email-err" />
          <p id="onb-biz-email-hint" class="onb-hint">{{ 'onboarding.business.email.hint' | t }}</p>
          @if (emailError()) {
            <p id="onb-biz-email-err" class="onb-field-error" role="alert">{{ 'onboarding.business.error.email' | t }}</p>
          }
        </div>
        <app-onb-a-error [error]="error()" />
        <div class="onb-bar">
          <button type="submit" class="onb-btn onb-btn-primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ 'onboarding.common.continue' | t }}</button>
          <div class="onb-bar-links">
            <button type="button" class="onb-link" [disabled]="busy()" (click)="skip()">{{ 'onboarding.common.skip' | t }}</button>
            <app-onb-help />
          </div>
        </div>
      </form>
    </section>
  `,
})
export class BusinessLinksScreen extends BusinessScreenBase {
  protected readonly field = 'links' as const;
  readonly value = signal('');
  readonly email = signal('');
  readonly emailError = signal(false);
  private started = false;

  constructor() {
    super();
    this.fieldId = 'onb-biz-links';
    effect(() => {
      const s = this.state.state();
      untracked(() => {
        if (this.started || s === null) return;
        this.started = true;
        const b = s.business ?? null;
        this.value.set(b?.website ? b.website : b?.instagram ? `@${b.instagram}` : '');
        // the saved address, else the checkout one (only when it is usable: a broken pre-fill is never put in front of the merchant)
        this.email.set(validContactEmail(b?.contactEmail) ?? validContactEmail(s.prefill?.email) ?? '');
      });
    });
  }

  onInput(e: Event): void {
    this.value.set((e.target as HTMLInputElement).value);
    if (this.fieldError()) this.fieldError.set(false);
  }

  onEmail(e: Event): void {
    this.email.set((e.target as HTMLInputElement).value);
    if (this.emailError()) this.emailError.set(false);
  }

  submit(e: Event): void {
    e.preventDefault();
    if (this.busy()) return;
    const c = classifyLink(this.value());
    const typed = cleanLine(this.email());
    const email = typed ? validContactEmail(typed) : null;
    const linkBad = c.kind === 'invalid';
    const emailBad = typed !== '' && email === null;
    this.fieldError.set(linkBad);
    this.emailError.set(emailBad);
    if (linkBad || emailBad) {
      if (linkBad) this.focusField();
      else this.focusEmail();
      return;
    }
    const body: Record<string, unknown> = {};
    if (c.kind === 'instagram') body['instagram'] = c.instagram;
    else if (c.kind === 'website') body['website'] = c.website;
    // The address is sent when it is new or changed; a saved one the merchant emptied is cleared. Nothing else is ever sent for it.
    const saved = validContactEmail(this.business()?.contactEmail);
    if (email !== null && email !== saved) body['contactEmail'] = email;
    else if (typed === '' && saved !== null) body['contactEmail'] = null;
    if (Object.keys(body).length === 0) {
      this.skip();
      return;
    }
    this.save(body, 'links');
  }

  /** Optional: nothing is stored and nothing is asked again on this pass. */
  skip(): void {
    if (this.busy()) return;
    void this.router.navigateByUrl(nextBusinessUrl('links', this.business()));
  }

  /** The server refused the address (it checks the same format): shown next to its own field, not in the generic block. */
  protected override showFieldError(which: ReturnType<typeof fieldOfError>): boolean {
    if (which !== 'email') return super.showFieldError(which);
    this.emailError.set(true);
    this.focusEmail();
    return true;
  }

  private focusEmail(): void {
    setTimeout(() => document.getElementById(EMAIL_FIELD_ID)?.focus());
  }
}
