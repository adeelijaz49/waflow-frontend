import { Directive, ElementRef, Injectable, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import { OnbAnalyticsService } from './onb-analytics.service';
import type { OnbEventStep } from './onb.types';

/** The polite live region of the setup shell: `say(key)` writes localised text for screen readers (DF 3.11). */
@Injectable({ providedIn: 'root' })
export class OnbAnnouncer {
  private readonly i18n = inject(I18nService);
  readonly message = signal('');
  private flip = false;

  say(key: string, params?: Record<string, string | number | null | undefined>): void {
    // A zero-width toggle makes a repeated identical message announce again.
    this.flip = !this.flip;
    this.message.set(this.i18n.t(key, params) + (this.flip ? '' : '\u{200B}'));
  }

  clear(): void {
    this.message.set('');
  }
}

function scrollToTop(): void {
  try {
    document.querySelector<HTMLElement>('main.main-content')?.scrollTo?.(0, 0);
  } catch {
    /* not scrollable here */
  }
  try {
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  } catch {
    /* ignore */
  }
}

// Put on every screen's <h1 tabindex="-1">: moves focus there on entry and on every route change (screen readers
// announce the new question), scrolls to the top, optionally sets the document title (and restores the previous one
// on destroy) and fires the `step_enter` analytics event.
//   <h1 tabindex="-1" onbFocus="onboarding.step.connect" onbStep="connect">
@Directive({ selector: '[onbFocus]', standalone: true })
export class OnbFocus implements OnInit, OnDestroy {
  /** Catalogue key of the screen name (optional): the title becomes "<onboarding.title> - <screen name>". */
  @Input('onbFocus') titleKey = '';
  /** Analytics step for `step_enter` (optional). */
  @Input() onbStep: OnbEventStep | '' = '';

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly title = inject(Title);
  private readonly i18n = inject(I18nService);
  private readonly analytics = inject(OnbAnalyticsService);
  private readonly router = inject(Router, { optional: true });
  private previousTitle: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sub?: Subscription;

  ngOnInit(): void {
    if (this.titleKey) {
      this.previousTitle = this.title.getTitle();
      this.title.setTitle(`${this.i18n.t('onboarding.title')} - ${this.i18n.t(this.titleKey)}`);
    }
    if (this.onbStep) this.analytics.track('step_enter', this.onbStep);
    this.focusSoon();
    this.sub = this.router?.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.focusSoon();
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.sub?.unsubscribe();
    if (this.previousTitle !== null) this.title.setTitle(this.previousTitle);
  }

  private focusSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const el = this.el.nativeElement;
      if (!el.isConnected) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus();
      scrollToTop();
    });
  }
}
