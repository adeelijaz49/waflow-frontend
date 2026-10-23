import {
  ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, createComponent, effect, inject, untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { I18nService } from '../../../i18n/i18n.service';
import { ONB_UI_ENABLED_TOKEN, isLockAllowed, isSetupUrl, pathOf } from '../onb-links';
import { OnbStateService } from '../onb-state.service';

const TOKEN_KEY = 'waflow_auth_token';
const MAX_MAIN_RETRIES = 5;
const STALE_MS = 15000;
const HOST_CLASS = 'onb-shell-host';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Mounts the persistent status strip (and the "visible but locked" treatment) for an ENROLLED merchant only.
// For everyone else the only observable effects are the single state request and one sessionStorage hint:
// no element, no class on <body>, no style, no inert/aria-hidden attribute, no DOM listener that touches the page.
@Injectable({ providedIn: 'root' })
export class OnbShellMount {
  private readonly state = inject(OnbStateService);
  private readonly router = inject(Router);
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly doc = inject(DOCUMENT);
  private readonly enabled = inject(ONB_UI_ENABLED_TOKEN);

  private started = false;
  private navSub?: Subscription;
  private visibilityHandler?: () => void;
  private effectRef?: { destroy(): void };
  private ref: ComponentRef<unknown> | null = null;
  private host: HTMLElement | null = null;
  private mounting: Promise<void> | null = null;
  private mainRetries = 0;
  private wasEnrolled = false;
  private observer: MutationObserver | null = null;
  private observedMain: HTMLElement | null = null;
  private readonly marked = new Set<HTMLElement>();
  /** The catalogue could not be downloaded: neither the strip nor the veil are shown (a lock must be explained). */
  textsFailed = false;

  /** Idempotent. Never throws. */
  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    try {
      this.state.ensureLoaded();
      this.navSub = this.router.events.subscribe((e) => {
        if (e instanceof NavigationEnd) this.onNavigationEnd();
      });
      this.visibilityHandler = () => {
        if (this.doc.visibilityState === 'visible' && readToken()) this.state.refreshIfStale(STALE_MS);
      };
      this.doc.addEventListener('visibilitychange', this.visibilityHandler);
      this.effectRef = effect(
        () => {
          this.state.enrolled();
          this.state.locked();
          untracked(() => void this.evaluate());
        },
        { injector: this.envInjector },
      );
    } catch {
      /* the onboarding flow is optional: never block the app */
    }
  }

  /** Stops everything and removes whatever was mounted (tests, hot reload). */
  stop(): void {
    this.started = false;
    this.navSub?.unsubscribe();
    this.navSub = undefined;
    if (this.visibilityHandler) this.doc.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = undefined;
    this.effectRef?.destroy();
    this.effectRef = undefined;
    this.unmount();
    this.wasEnrolled = false;
  }

  get mounted(): boolean {
    return this.ref !== null;
  }

  private onNavigationEnd(): void {
    try {
      if (readToken()) this.state.retryIfFailed(); // BEFORE ensureLoaded: a fresh request is never retried at once
      this.state.ensureLoaded();
      this.state.refreshIfStale(STALE_MS);
      void this.evaluate();
    } catch {
      /* fail open */
    }
  }

  /** Brings the DOM in line with the state. Idempotent. */
  async evaluate(): Promise<void> {
    try {
      const should = this.state.enrolled() && !!readToken();
      if (!should) {
        this.wasEnrolled = false;
        this.unmount();
        return;
      }
      const justEnrolled = !this.wasEnrolled;
      this.wasEnrolled = true;
      await this.ensureMounted();
      this.applyLock();
      if (justEnrolled) this.lateRedirect();
    } catch {
      /* fail open */
    }
  }

  private ensureMounted(): Promise<void> {
    if (this.ref) return Promise.resolve();
    this.mounting ??= this.mountStrip().finally(() => {
      this.mounting = null;
    });
    return this.mounting;
  }

  private async mountStrip(): Promise<void> {
    if (this.mainRetries >= MAX_MAIN_RETRIES) return; // <main> never appeared: stop retrying (fail open)
    const i18n = this.envInjector.get(I18nService);
    try {
      await i18n.init();
      this.textsFailed = false;
    } catch {
      this.textsFailed = true; // no strip and no veil: retried on the next navigation
      return;
    }
    const mod = await import('./onb-shell');
    if (!this.state.enrolled() || !readToken() || this.ref) return; // changed while the chunk loaded
    const main = this.doc.querySelector<HTMLElement>('main.main-content');
    if (!main) {
      this.mainRetries++; // retried on the next NavigationEnd, at most MAX_MAIN_RETRIES times
      return;
    }
    const host = this.doc.createElement('div');
    host.className = HOST_CLASS;
    main.insertBefore(host, main.firstChild);
    const ref = createComponent(mod.OnbShell, { environmentInjector: this.envInjector, hostElement: host });
    this.appRef.attachView(ref.hostView);
    ref.changeDetectorRef.detectChanges();
    this.ref = ref;
    this.host = host;
    this.mainRetries = 0;
  }

  private unmount(): void {
    this.mainRetries = 0;
    this.clearLock();
    const ref = this.ref;
    const host = this.host;
    this.ref = null;
    this.host = null;
    if (ref) {
      try {
        this.appRef.detachView(ref.hostView);
      } catch {
        /* already detached */
      }
      ref.destroy();
    }
    host?.remove();
  }

  // ---- lock treatment -------------------------------------------------------------------------------------

  private currentUrl(): string {
    return pathOf(this.router.url);
  }

  private setBodyClass(name: string, on: boolean): void {
    const cl = this.doc.body.classList;
    if (on && !cl.contains(name)) cl.add(name);
    else if (!on && cl.contains(name)) cl.remove(name); // never rewrite the class attribute when there is nothing to do
  }

  private applyLock(): void {
    if (!this.ref || this.textsFailed) {
      this.clearLock();
      return;
    }
    const url = this.currentUrl();
    this.host?.classList.toggle('onb-hide', isSetupUrl(url));
    const navLocked = this.state.enrolled() && this.state.locked();
    const pageLocked = navLocked && !isLockAllowed(url);
    this.setBodyClass('onb-locked', navLocked);
    this.setBodyClass('onb-veil', pageLocked);
    if (pageLocked) this.watchMain();
    else this.unwatchMain();
  }

  private clearLock(): void {
    this.setBodyClass('onb-locked', false);
    this.setBodyClass('onb-veil', false);
    this.unwatchMain();
  }

  private watchMain(): void {
    const main = this.doc.querySelector<HTMLElement>('main.main-content');
    if (!main) return;
    if (this.observer && this.observedMain === main) {
      this.markChildren(main);
      return;
    }
    this.unwatchMain();
    this.observedMain = main;
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.markChildren(main));
      this.observer.observe(main, { childList: true });
    }
    this.markChildren(main);
  }

  private markChildren(main: HTMLElement): void {
    for (const child of Array.from(main.children) as HTMLElement[]) {
      if (child.classList.contains(HOST_CLASS) || this.marked.has(child)) continue;
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        child.dataset['onbInert'] = '1';
      }
      if (!child.hasAttribute('aria-hidden')) {
        child.setAttribute('aria-hidden', 'true');
        child.dataset['onbAria'] = '1';
      }
      this.marked.add(child);
    }
  }

  private unwatchMain(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedMain = null;
    for (const el of this.marked) {
      // only undo what this feature added (an element that was inert/aria-hidden before keeps its attributes)
      if (el.dataset['onbInert'] === '1') el.removeAttribute('inert');
      if (el.dataset['onbAria'] === '1') el.removeAttribute('aria-hidden');
      delete el.dataset['onbInert'];
      delete el.dataset['onbAria'];
    }
    this.marked.clear();
  }

  // ---- late redirect --------------------------------------------------------------------------------------

  // Covers a wrong hint, a canMatch timeout, or a merchant enrolled/paid while already logged in: the legacy page
  // rendered first; once the state says enrolled, send the merchant to the right place ONCE per login session.
  private lateRedirect(): void {
    if (this.state.shadowActive) return;
    const path = this.currentUrl();
    if (path !== '/dashboard' && path !== '/onboarding') return;
    const target = this.state.landingUrl();
    if (!target || !this.state.firstLandingThisSession()) return;
    void this.router.navigateByUrl(target, { replaceUrl: true });
  }
}
