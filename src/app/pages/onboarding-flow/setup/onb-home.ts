import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { I18N_DIRECTIVES } from '../../../i18n/i18n.directives';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { AuthService } from '../../../shared/auth.service';
import { OnbApiService } from '../onb-api.service';
import { OnbHelp } from '../onb-help';
import { OnbStateService } from '../onb-state.service';
import type { OnbPromptKind, OnbPromptState } from '../onb.types';
import { OnbChecklist, checklistRows } from './onb-checklist';

interface PromptCard { kind: OnbPromptKind; state: OnbPromptState; count: number | null; url: string }

// Checklist home: the main content of the dashboard until setup is finished (spec 1b.3), with the two prompt cards
// once Step 3 is done (spec 0b: no waiting for Meta).
@Component({
  selector: 'app-onb-home',
  imports: [RouterLink, OnbChecklist, OnbHelp, ...I18N_DIRECTIVES, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="onb-stack">
      @if (name(); as n) {
        <h1 class="onb-q" tabindex="-1" appUserText>{{ 'onboarding.home.welcome' | t: { name: n } }}</h1>
      } @else {
        <h1 class="onb-q" tabindex="-1">{{ 'onboarding.title' | t }}</h1>
      }
      <p class="onb-lead">{{ 'onboarding.home.sub' | t }}</p>
      <app-onb-checklist [showAction]="true" />
      @if (connected()) {
        @for (c of cards(); track c.kind) {
          <div class="onb-card" [attr.data-state]="c.state">
            <div class="onb-card-title">{{ 'onboarding.home.card.' + c.kind + '.title' | t }}</div>
            @if (c.state === 'done') {
              <p class="onb-badge onb-badge-done"><span aria-hidden="true">&#10003;</span> {{ 'onboarding.home.count.' + c.kind | t: { n: c.count ?? 0 } }}</p>
            } @else {
              <p class="onb-muted">{{ 'onboarding.home.card.' + c.kind + '.body' | t }}</p>
              @if (c.state === 'skipped') {
                <p class="onb-alert onb-alert-warn" role="note">{{ 'onboarding.home.reminder.' + c.kind | t }}</p>
              }
              <a class="onb-btn onb-btn-primary" [routerLink]="c.url">{{ 'onboarding.home.card.' + c.kind + '.cta' | t }}</a>
              @if (c.state === 'pending') {
                <button type="button" class="onb-link" (click)="skip(c.kind)">{{ 'onboarding.common.skip' | t }}</button>
              }
            }
          </div>
        }
      }
      @if (locked()) {
        <p class="onb-muted" data-lock-note>{{ 'onboarding.home.locked' | t }}</p>
      }
      <app-onb-help />
    </section>
  `,
})
export class OnbHome {
  private readonly state = inject(OnbStateService);
  private readonly api = inject(OnbApiService);
  private readonly auth = inject(AuthService);
  private readonly session = toSignal(this.auth.session, { initialValue: this.auth.sessionSnapshot });

  /** Business name from the state, else the signed-in user's name; never the workspace name. */
  readonly name = computed(() => {
    const b = this.state.state()?.business?.name?.trim();
    if (b) return b;
    const u = this.session()?.user?.name?.trim();
    return u || null;
  });

  readonly connected = computed(() => checklistRows(this.state.state()).find((r) => r.key === 'connect')?.status === 'done');

  /** "The rest of WaFlow is visible but locked" is only true while the app is locked (D6 unlocks it when Step 3 is done). */
  readonly locked = computed(() => this.state.locked());

  readonly cards = computed<PromptCard[]>(() => {
    const p = this.state.state()?.prompts;
    return [
      { kind: 'customers', state: p?.customers?.state ?? 'pending', count: p?.counts?.customers ?? null, url: '/setup/customers' },
      { kind: 'products', state: p?.products?.state ?? 'pending', count: (p?.counts?.products ?? 0) + (p?.counts?.services ?? 0), url: '/setup/products' },
    ];
  });

  skip(kind: OnbPromptKind): void {
    this.api.promptDone(kind, 'skipped').subscribe({
      next: () => this.state.refresh(),
      error: () => undefined,
    });
    const s = this.state.state();
    if (s?.prompts) this.state.patch({ prompts: { ...s.prompts, [kind]: { state: 'skipped' } } });
  }
}
