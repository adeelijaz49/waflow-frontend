import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { FB_LOAD_TIMEOUT_MS, FB_SCRIPT_ID, FacebookSdkService, type FbApi } from './facebook-sdk.service';

const CFG = { appId: '1234567890', graphVersion: 'v25.0' };

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>(`script#${FB_SCRIPT_ID}`));
}

interface FakeFb extends FbApi { init: Mock<FbApi['init']>; login: Mock<FbApi['login']> }

function fakeFb(): FakeFb {
  return { init: vi.fn<FbApi['init']>(), login: vi.fn<FbApi['login']>() };
}

// The Meta script itself never loads in jsdom: the specs play its part (define window.FB, call window.fbAsyncInit, or fail the element).
function sdkLoaded(fb: FbApi = fakeFb()): void {
  window.FB = fb;
  window.fbAsyncInit?.();
}

describe('FacebookSdkService', () => {
  let svc: FacebookSdkService;

  beforeEach(() => {
    scripts().forEach((s) => s.remove());
    delete window.FB;
    delete window.fbAsyncInit;
    svc = TestBed.inject(FacebookSdkService);
  });

  afterEach(() => {
    vi.useRealTimers();
    scripts().forEach((s) => s.remove());
    delete window.FB;
    delete window.fbAsyncInit;
  });

  it('starts idle and adds nothing to the page until load() is called', () => {
    expect(svc.status()).toBe('idle');
    expect(scripts()).toHaveLength(0);
  });

  it('load() adds exactly one script element with the documented URL and attributes', () => {
    void svc.load(CFG).catch(() => undefined);
    const els = scripts();
    expect(els).toHaveLength(1);
    expect(els[0].src).toBe('https://connect.facebook.net/en_US/sdk.js');
    expect(els[0].async).toBe(true);
    expect(els[0].defer).toBe(true);
    expect(els[0].crossOrigin).toBe('anonymous');
    expect(svc.status()).toBe('loading');
  });

  it('uses the locale of the config when it is a valid locale, else en_US', () => {
    void svc.load({ ...CFG, sdkLocale: 'ar_AR' }).catch(() => undefined);
    expect(scripts()[0].src).toBe('https://connect.facebook.net/ar_AR/sdk.js');
    scripts()[0].onerror?.(new Event('error'));

    const again = TestBed.inject(FacebookSdkService);
    void again.load({ ...CFG, sdkLocale: '../evil' }).catch(() => undefined);
    expect(scripts()[0].src).toBe('https://connect.facebook.net/en_US/sdk.js');
  });

  it('FB.init gets the app id, the graph version from the config and the fixed flags; load() resolves and the status is ready', async () => {
    const fb = fakeFb();
    const p = svc.load({ ...CFG, graphVersion: 'v25.0' });
    sdkLoaded(fb);
    await expect(p).resolves.toBeUndefined();
    expect(fb.init).toHaveBeenCalledTimes(1);
    expect(fb.init).toHaveBeenCalledWith({ appId: '1234567890', cookie: true, xfbml: false, version: 'v25.0' });
    expect(svc.status()).toBe('ready');
  });

  it('is idempotent: concurrent calls share one script and one promise; after ready it resolves at once without a new element or init', async () => {
    const fb = fakeFb();
    const p1 = svc.load(CFG);
    const p2 = svc.load(CFG);
    expect(p2).toBe(p1);
    expect(scripts()).toHaveLength(1);
    sdkLoaded(fb);
    await p1;
    await expect(svc.load(CFG)).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(1);
    expect(fb.init).toHaveBeenCalledTimes(1);
  });

  it('onerror -> ONB_SDK_BLOCKED, the element and the callback are removed, and "try again" starts clean', async () => {
    const p = svc.load(CFG);
    const el = scripts()[0];
    el.onerror?.(new Event('error'));
    await expect(p).rejects.toMatchObject({ message: 'ONB_SDK_BLOCKED', code: 'ONB_SDK_BLOCKED' });
    expect(scripts()).toHaveLength(0);
    expect(el.isConnected).toBe(false);
    expect(window.fbAsyncInit).toBeUndefined();
    expect(svc.status()).toBe('blocked');

    const retry = svc.load(CFG);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(el);
    const fb = fakeFb();
    sdkLoaded(fb);
    await expect(retry).resolves.toBeUndefined();
    expect(svc.status()).toBe('ready');
  });

  it('no fbAsyncInit within 10 s -> ONB_SDK_TIMEOUT, the element is removed and a late callback is ignored', async () => {
    vi.useFakeTimers();
    const p = svc.load(CFG);
    const assertion = expect(p).rejects.toMatchObject({ message: 'ONB_SDK_TIMEOUT', code: 'ONB_SDK_TIMEOUT' });
    vi.advanceTimersByTime(FB_LOAD_TIMEOUT_MS - 1);
    expect(svc.status()).toBe('loading');
    vi.advanceTimersByTime(1);
    await assertion;
    expect(scripts()).toHaveLength(0);
    expect(window.fbAsyncInit).toBeUndefined();
    expect(svc.status()).toBe('blocked');
  });

  it('a successful load cancels the timeout (no late rejection, nothing pending)', async () => {
    vi.useFakeTimers();
    const p = svc.load(CFG);
    sdkLoaded();
    await p;
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(FB_LOAD_TIMEOUT_MS * 2);
    expect(svc.status()).toBe('ready');
  });

  it('a bad config (app id or graph version) is refused without touching the page', async () => {
    await expect(svc.load({ appId: '', graphVersion: 'v25.0' })).rejects.toMatchObject({ code: 'ONB_SDK_BLOCKED' });
    await expect(svc.load({ appId: '123', graphVersion: 'latest' })).rejects.toMatchObject({ code: 'ONB_SDK_BLOCKED' });
    await expect(svc.load({ appId: 'a b', graphVersion: 'v25.0' })).rejects.toMatchObject({ code: 'ONB_SDK_BLOCKED' });
    expect(scripts()).toHaveLength(0);
  });

  it('a throwing FB.init counts as blocked', async () => {
    const fb = fakeFb();
    fb.init.mockImplementation(() => {
      throw new Error('boom');
    });
    const p = svc.load(CFG);
    sdkLoaded(fb);
    await expect(p).rejects.toMatchObject({ code: 'ONB_SDK_BLOCKED' });
    expect(scripts()).toHaveLength(0);
  });

  it('fbAsyncInit without window.FB counts as blocked', async () => {
    const p = svc.load(CFG);
    window.fbAsyncInit?.();
    await expect(p).rejects.toMatchObject({ code: 'ONB_SDK_BLOCKED' });
  });

  it('login() before the SDK is ready throws ONB_SDK_BLOCKED and never touches FB', () => {
    const fb = fakeFb();
    window.FB = fb;
    expect(() => svc.login({ a: 1 }, () => undefined)).toThrow('ONB_SDK_BLOCKED');
    expect(fb.login).not.toHaveBeenCalled();
  });

  it('login() once ready calls FB.login synchronously with the callback and the options unchanged', async () => {
    const fb = fakeFb();
    const p = svc.load(CFG);
    sdkLoaded(fb);
    await p;
    const cb = vi.fn();
    const options = { config_id: 'c', response_type: 'code' };
    svc.login(options, cb);
    expect(fb.login).toHaveBeenCalledTimes(1);
    expect(fb.login).toHaveBeenCalledWith(cb, options);
  });

  it('the SDK status never exposes tokens: the service holds no Facebook data', async () => {
    const p = svc.load(CFG);
    sdkLoaded();
    await p;
    expect(Object.keys(svc).sort()).toEqual(['inflight', 'status']);
  });
});
