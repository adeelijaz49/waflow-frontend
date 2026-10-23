import { Injectable, signal } from '@angular/core';

// Loads Meta's JavaScript SDK dynamically, only when the Connect screen opens (DF 4.1, 10): the app loads no other
// third-party script. Nothing of Meta's (token, code, cookie) is read or stored here: the SDK is only the opener of the
// Embedded Signup popup, and `login()` hands Meta's callback straight to the caller.
export interface FbLoginResponse { authResponse?: { code?: string } | null; status?: string }

export interface FbApi {
  init(o: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, o: Record<string, unknown>): void;
}

declare global {
  interface Window { FB?: FbApi; fbAsyncInit?: () => void }
}

export const FB_SCRIPT_ID = 'facebook-jssdk';
export const FB_LOAD_TIMEOUT_MS = 10_000;
const DEFAULT_LOCALE = 'en_US';
const LOCALE_PATTERN = /^[a-z]{2,3}_[A-Z]{2}$/;
const APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_PATTERN = /^v[0-9]{1,2}\.[0-9]{1,2}$/;

export type FbSdkErrorCode = 'ONB_SDK_BLOCKED' | 'ONB_SDK_TIMEOUT';

/** An Error whose message AND `code` are the stable client error code (onbErrorCode reads `code`). */
function sdkError(code: FbSdkErrorCode): Error & { code: FbSdkErrorCode } {
  return Object.assign(new Error(code), { code });
}

@Injectable({ providedIn: 'root' })
export class FacebookSdkService {
  readonly status = signal<'idle' | 'loading' | 'ready' | 'blocked'>('idle');
  private inflight: Promise<void> | null = null;

  /** Idempotent: one script element, one `FB.init`. Rejects ONB_SDK_BLOCKED (script error, bad config) or ONB_SDK_TIMEOUT (10 s). */
  load(cfg: { appId: string; graphVersion: string; sdkLocale?: string }): Promise<void> {
    if (this.status() === 'ready' && typeof window !== 'undefined' && window.FB) return Promise.resolve();
    if (this.inflight) return this.inflight;
    if (!cfg || !APP_ID_PATTERN.test(String(cfg.appId ?? '')) || !VERSION_PATTERN.test(String(cfg.graphVersion ?? ''))) {
      this.status.set('blocked');
      return Promise.reject(sdkError('ONB_SDK_BLOCKED'));
    }
    const locale = typeof cfg.sdkLocale === 'string' && LOCALE_PATTERN.test(cfg.sdkLocale) ? cfg.sdkLocale : DEFAULT_LOCALE;
    this.status.set('loading');

    const p = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let script: HTMLScriptElement | null = null;

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
      const fail = (code: FbSdkErrorCode): void => {
        if (settled) return;
        settled = true;
        cleanup();
        // A failed attempt leaves nothing behind, so "Try again" starts clean (no stale element, no late callback).
        script?.remove();
        if (window.fbAsyncInit === onReady) delete window.fbAsyncInit;
        this.status.set('blocked');
        this.inflight = null;
        reject(sdkError(code));
      };
      const onReady = (): void => {
        if (settled) return;
        const fb = window.FB;
        if (!fb) {
          fail('ONB_SDK_BLOCKED');
          return;
        }
        try {
          fb.init({ appId: cfg.appId, cookie: true, xfbml: false, version: cfg.graphVersion });
        } catch {
          fail('ONB_SDK_BLOCKED');
          return;
        }
        settled = true;
        cleanup();
        this.status.set('ready');
        this.inflight = null;
        resolve();
      };

      // A leftover element of an earlier failed attempt would never fire fbAsyncInit again: replace it.
      document.getElementById(FB_SCRIPT_ID)?.remove();
      window.fbAsyncInit = onReady;
      script = document.createElement('script');
      script.id = FB_SCRIPT_ID;
      script.src = `https://connect.facebook.net/${locale}/sdk.js`;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => fail('ONB_SDK_BLOCKED');
      timer = setTimeout(() => fail('ONB_SDK_TIMEOUT'), FB_LOAD_TIMEOUT_MS);
      document.head.appendChild(script);
    });
    this.inflight = p;
    return p;
  }

  /**
   * Opens the Embedded Signup popup. MUST be called synchronously from the click handler (nothing awaited before it),
   * otherwise the browser blocks the popup. Throws ONB_SDK_BLOCKED when the SDK is not ready.
   */
  login(options: Record<string, unknown>, cb: (r: FbLoginResponse) => void): void {
    const fb = typeof window !== 'undefined' ? window.FB : undefined;
    if (this.status() !== 'ready' || !fb) throw sdkError('ONB_SDK_BLOCKED');
    fb.login(cb, options);
  }
}
