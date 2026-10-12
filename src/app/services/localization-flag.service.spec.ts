import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { HubStateService } from '../pages/localization/hub/hub-state.service';
import type { LocalizationSettings } from '../pages/localization/localization.types';
import { LocalizationApiService } from './localization-api.service';
import { LocalizationFlagService } from './localization-flag.service';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const settings = (over: Partial<LocalizationSettings> = {}): LocalizationSettings => ({
  arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first', ...over,
});

function setup(getSettings: () => unknown) {
  const api = { getSettings: vi.fn(getSettings) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
  return api;
}

describe('LocalizationFlagService', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('waflow_auth_token', 'token-A');
  });

  it('is false until the answer arrives, then true only for arabicEnabled === true', () => {
    const answer = new Subject<LocalizationSettings>();
    const api = setup(() => answer);
    const flag = TestBed.inject(LocalizationFlagService);
    expect(flag.arabicEnabled()).toBe(false);
    expect(flag.loaded()).toBe(false);
    answer.next(settings());
    expect(flag.arabicEnabled()).toBe(true);
    expect(flag.loaded()).toBe(true);
    expect(flag.defaultCustomerLanguage()).toBe('ar');
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('stays false (and English default) when the merchant is not switched on', () => {
    const answer = new Subject<LocalizationSettings>();
    setup(() => answer);
    const flag = TestBed.inject(LocalizationFlagService);
    answer.next(settings({ arabicEnabled: false, defaultCustomerLanguage: 'en' }));
    expect(flag.arabicEnabled()).toBe(false);
    expect(flag.defaultCustomerLanguage()).toBe('en');
  });

  it.each([[0], [401], [402], [404], [500]])('stays false when the settings call fails with %s', (status) => {
    setup(() => throwError(() => ({ status })));
    const flag = TestBed.inject(LocalizationFlagService);
    expect(flag.arabicEnabled()).toBe(false);
    expect(flag.loaded()).toBe(true);
    expect(flag.defaultCustomerLanguage()).toBe('en');
  });

  it('is false for a truthy-but-not-true flag value', () => {
    const answer = new Subject<LocalizationSettings>();
    setup(() => answer);
    const flag = TestBed.inject(LocalizationFlagService);
    answer.next({ ...settings(), arabicEnabled: 'yes' as unknown as boolean });
    expect(flag.arabicEnabled()).toBe(false);
  });

  it('makes ONE request for many injections, ensureLoaded() calls and a hub load() in flight', () => {
    const answer = new Subject<LocalizationSettings>();
    const api = setup(() => answer);
    const flag = TestBed.inject(LocalizationFlagService);
    flag.ensureLoaded();
    flag.ensureLoaded();
    TestBed.inject(HubStateService).load();
    TestBed.inject(HubStateService).load();
    expect(TestBed.inject(LocalizationFlagService)).toBe(flag);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    answer.next(settings());
    flag.ensureLoaded();
    TestBed.inject(HubStateService).load();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('makes no request when nobody is logged in', () => {
    localStorage.clear();
    const api = setup(() => new Subject());
    const flag = TestBed.inject(LocalizationFlagService);
    expect(flag.arabicEnabled()).toBe(false);
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it('drops the previous merchant answer and reloads when the login token changes', () => {
    const answers: Subject<LocalizationSettings>[] = [];
    const api = setup(() => { const s = new Subject<LocalizationSettings>(); answers.push(s); return s; });
    const flag = TestBed.inject(LocalizationFlagService);
    answers[0].next(settings());
    expect(flag.arabicEnabled()).toBe(true);

    localStorage.setItem('waflow_auth_token', 'token-B'); // another workspace logs in inside the same SPA session
    flag.ensureLoaded();
    expect(flag.arabicEnabled()).toBe(false); // reset at once: the old flag must not leak
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    answers[1].next(settings({ arabicEnabled: false }));
    expect(flag.arabicEnabled()).toBe(false);
    expect(flag.loaded()).toBe(true);
  });

  it('does not leak the previous merchant flag when the hub (not an existing screen) loaded it first', () => {
    const answers: Subject<LocalizationSettings>[] = [];
    const api = setup(() => { const s = new Subject<LocalizationSettings>(); answers.push(s); return s; });
    const hub = TestBed.inject(HubStateService);
    hub.load(); // the Arabic hub opened under token-A
    answers[0].next(settings());
    expect(hub.enabled()).toBe(true);

    localStorage.setItem('waflow_auth_token', 'token-B'); // logout + another merchant logs in, no page reload
    const flag = TestBed.inject(LocalizationFlagService); // first injection happens only now (Promotions opened)
    expect(flag.arabicEnabled()).toBe(false);
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    answers[1].next(settings({ arabicEnabled: false }));
    expect(flag.arabicEnabled()).toBe(false);
    expect(flag.loaded()).toBe(true);
  });

  it('ignores a late answer for the previous token', () => {
    const answers: Subject<LocalizationSettings>[] = [];
    setup(() => { const s = new Subject<LocalizationSettings>(); answers.push(s); return s; });
    const flag = TestBed.inject(LocalizationFlagService);
    localStorage.setItem('waflow_auth_token', 'token-B');
    flag.ensureLoaded();
    answers[0].next(settings()); // the answer for token-A arrives after the switch
    expect(flag.arabicEnabled()).toBe(false);
    answers[1].next(settings({ arabicEnabled: false }));
    expect(flag.arabicEnabled()).toBe(false);
  });

  it('logout clears the flag without a request', () => {
    const answers: Subject<LocalizationSettings>[] = [];
    const api = setup(() => { const s = new Subject<LocalizationSettings>(); answers.push(s); return s; });
    const flag = TestBed.inject(LocalizationFlagService);
    answers[0].next(settings());
    localStorage.removeItem('waflow_auth_token');
    flag.ensureLoaded();
    expect(flag.arabicEnabled()).toBe(false);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  describe('R1-06: retry of a TRANSIENT first-load failure on the next navigation', () => {
    @Component({ template: '' })
    class Blank {}

    function setupRouted(answers: Array<() => unknown>) {
      let call = 0;
      const api = { getSettings: vi.fn(() => (answers[Math.min(call++, answers.length - 1)])()) };
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: '**', component: Blank }]), { provide: LocalizationApiService, useValue: api }],
      });
      return api;
    }
    const fail = (status: number) => () => throwError(() => ({ status }));
    const ok = (over: Partial<LocalizationSettings> = {}) => () => of(settings(over));

    it('a failed first load followed by a success on the next navigation flips the flag on', async () => {
      const api = setupRouted([fail(500), ok()]);
      const flag = TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      expect(flag.arabicEnabled()).toBe(false);
      expect(api.getSettings).toHaveBeenCalledTimes(1);
      await router.navigateByUrl('/a');
      expect(api.getSettings).toHaveBeenCalledTimes(2);
      expect(flag.arabicEnabled()).toBe(true);
      expect(TestBed.inject(HubStateService).failed()).toBe(false);
      await router.navigateByUrl('/b'); // success never retries
      await router.navigateByUrl('/c');
      expect(api.getSettings).toHaveBeenCalledTimes(2);
    });

    it('stops after two retries (three requests in all), however many navigations follow', async () => {
      const api = setupRouted([fail(0)]);
      const flag = TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      for (const url of ['/a', '/b', '/c', '/d', '/e']) await router.navigateByUrl(url);
      expect(api.getSettings).toHaveBeenCalledTimes(3);
      expect(flag.arabicEnabled()).toBe(false);
      expect(TestBed.inject(HubStateService).failed()).toBe(true);
    });

    it('an unflagged merchant whose call succeeds makes exactly ONE request across navigations', async () => {
      const api = setupRouted([ok({ arabicEnabled: false })]);
      TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      for (const url of ['/a', '/b', '/c']) await router.navigateByUrl(url);
      expect(api.getSettings).toHaveBeenCalledTimes(1);
    });

    it.each([[401], [402], [403], [404]])('a definitive %s answer is never retried', async (status) => {
      const api = setupRouted([fail(status), ok()]);
      const flag = TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/a');
      await router.navigateByUrl('/b');
      expect(api.getSettings).toHaveBeenCalledTimes(1);
      expect(flag.arabicEnabled()).toBe(false);
    });

    it.each([[429], [502], [503]])('a transient %s answer is retried', async (status) => {
      const api = setupRouted([fail(status), ok()]);
      const flag = TestBed.inject(LocalizationFlagService);
      await TestBed.inject(Router).navigateByUrl('/a');
      expect(api.getSettings).toHaveBeenCalledTimes(2);
      expect(flag.arabicEnabled()).toBe(true);
    });

    it('does not start a second request while one is in flight (a navigation during the retry)', async () => {
      const retry = new Subject<LocalizationSettings>();
      const api = setupRouted([fail(500), () => retry]);
      const flag = TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/a'); // retry starts, stays pending
      await router.navigateByUrl('/b');
      await router.navigateByUrl('/c');
      expect(api.getSettings).toHaveBeenCalledTimes(2);
      retry.next(settings());
      expect(flag.arabicEnabled()).toBe(true);
    });

    it('a changed login token is handled by the existing reload (one request for it), not by an extra retry', async () => {
      const api = setupRouted([fail(500), ok({ arabicEnabled: false })]);
      const flag = TestBed.inject(LocalizationFlagService);
      localStorage.setItem('waflow_auth_token', 'token-B');
      await TestBed.inject(Router).navigateByUrl('/a');
      expect(api.getSettings).toHaveBeenCalledTimes(2); // the token reload only
      expect(flag.arabicEnabled()).toBe(false);
      await TestBed.inject(Router).navigateByUrl('/b');
      expect(api.getSettings).toHaveBeenCalledTimes(2);
    });

    it('logout resets the retry budget and makes no request; a new login gets a fresh budget', async () => {
      const api = setupRouted([fail(500)]);
      TestBed.inject(LocalizationFlagService);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/a');
      await router.navigateByUrl('/b'); // budget used up: 3 requests
      expect(api.getSettings).toHaveBeenCalledTimes(3);
      localStorage.removeItem('waflow_auth_token');
      await router.navigateByUrl('/c');
      expect(api.getSettings).toHaveBeenCalledTimes(3);
      localStorage.setItem('waflow_auth_token', 'token-B');
      await router.navigateByUrl('/d'); // new session: the load for the new token (fails), no retry in the same navigation
      await router.navigateByUrl('/e');
      expect(api.getSettings).toHaveBeenCalledTimes(5); // 3 + the new token load + ONE retry on the next navigation
    });
  });
});
