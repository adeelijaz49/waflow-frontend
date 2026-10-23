import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18N_PIPES } from '../../../i18n/i18n.pipes';
import { I18nService } from '../../../i18n/i18n.service';
import { ModalFocus } from '../../localization/shared/modal-focus';
import { OnbApiService } from '../onb-api.service';
import { OnbStateService } from '../onb-state.service';
import type { OnbNotification } from '../onb.types';

/** Only in-app paths are followed from a notification (never an absolute or protocol-relative URL). */
export function safeActionPath(path: string | null | undefined): string | null {
  const p = String(path ?? '');
  return p.startsWith('/') && !p.startsWith('//') && !p.includes(String.fromCharCode(92)) ? p : null;
}

// The bell: a role="dialog" sheet (ModalFocus) with the newest notifications; "View all" opens /setup/notifications,
// which renders the same list as a page (`page` input). Titles/bodies are catalogue keys (onboarding.notify.<kind>.*):
// the backend only sends the kind and params.
@Component({
  selector: 'app-onb-notifications',
  imports: [NgTemplateOutlet, RouterLink, ModalFocus, ...I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page()) {
      <section class="onb-stack">
        <h1 class="onb-q" tabindex="-1">{{ 'onboarding.bell.label' | t }}</h1>
        <ng-container [ngTemplateOutlet]="list" />
      </section>
    } @else {
      <div class="onb-sheet-backdrop" (click)="closed.emit()"></div>
      <div class="onb-sheet" role="dialog" aria-modal="true" appModalFocus [attr.aria-label]="'onboarding.bell.label' | t">
        <h2 class="onb-sheet-title">{{ 'onboarding.bell.label' | t }}</h2>
        <ng-container [ngTemplateOutlet]="list" />
        <button type="button" class="onb-link" (click)="markAll()">{{ 'onboarding.bell.markRead' | t }}</button>
        <a class="onb-link" routerLink="/setup/notifications" (click)="closed.emit()">{{ 'onboarding.bell.viewAll' | t }}</a>
        <button type="button" class="onb-link" (click)="closed.emit()">{{ 'onboarding.common.close' | t }}</button>
      </div>
    }
    <ng-template #list>
      @if (loaded() && rows().length === 0) {
        <p class="onb-muted">{{ 'onboarding.bell.none' | t }}</p>
      }
      <ul class="onb-steps">
        @for (n of rows(); track n.id) {
          <li class="onb-step">
            <div class="onb-step-body">
              <button type="button" class="onb-link" (click)="open(n)">{{ titleKey(n) | t: n.params ?? undefined }}</button>
              <div class="onb-step-status">{{ bodyKey(n) | t: n.params ?? undefined }}</div>
            </div>
          </li>
        }
      </ul>
    </ng-template>
  `,
})
export class OnbNotifications implements OnInit {
  readonly page = input(false);
  readonly closed = output<void>();

  private readonly api = inject(OnbApiService);
  private readonly state = inject(OnbStateService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly rows = signal<OnbNotification[]>([]);
  readonly loaded = signal(false);

  ngOnInit(): void {
    this.api.notifications(false, 30).subscribe({
      next: (res) => {
        const list = Array.isArray(res) ? res : (res?.notifications ?? []);
        this.rows.set(list.filter((n) => n && typeof n.id === 'string'));
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true), // nothing to show; never an error dialog for a bell
    });
  }

  titleKey(n: OnbNotification): string {
    const key = `onboarding.notify.${n.kind}.title`;
    return this.i18n.has(key, 'en') ? key : 'onboarding.notify.unknown.title';
  }

  bodyKey(n: OnbNotification): string {
    const key = `onboarding.notify.${n.kind}.body`;
    return this.i18n.has(key, 'en') ? key : 'onboarding.notify.unknown.body';
  }

  open(n: OnbNotification): void {
    this.api.notificationsRead({ ids: [n.id] }).subscribe({ next: () => this.state.refresh(), error: () => undefined });
    const target = safeActionPath(n.actionPath);
    this.closed.emit();
    if (target) void this.router.navigateByUrl(target);
  }

  markAll(): void {
    this.api.notificationsRead({ all: true }).subscribe({
      next: () => {
        this.rows.update((r) => r.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
        this.state.patch({ notifications: { unread: 0 } });
        this.state.refresh();
      },
      error: () => undefined,
    });
  }
}

/** Route component of /setup/notifications. */
@Component({
  selector: 'app-onb-notifications-page',
  imports: [OnbNotifications],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-onb-notifications [page]="true" />`,
})
export class OnbNotificationsPage {}
