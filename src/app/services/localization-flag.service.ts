import { Injectable, Signal, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { HubStateService } from '../pages/localization/hub/hub-state.service';

const TOKEN_KEY = 'waflow_auth_token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// The one place the EXISTING screens (Promotions, Flows, Settings, customers, ...) ask "is Arabic
// switched on for this merchant?". It is a thin facade over HubStateService, so the whole app makes
// ONE GET /api/localization/settings (shared with the Arabic hub).
//
//  * arabicEnabled() is false until the answer arrives, and stays false on ANY error (network, 401,
//    402, 5xx): an unflagged merchant, or a merchant whose settings call fails, sees exactly today's UI.
//  * The settings are cached per login token (see HubStateService): when the stored token changes (logout/login,
//    switching workspace inside one SPA session) the cache is dropped and re-requested, so a flag never leaks
//    from one workspace to another. The check runs on first injection and after every navigation.
//  * R1-06: a TRANSIENT failure of the first call (network, timeout, 429, 5xx) is retried on the next
//    navigation, at most twice per login session; a 401/402/403/404 answer or a success never retries.
@Injectable({ providedIn: 'root' })
export class LocalizationFlagService {
  private readonly hub = inject(HubStateService);

  readonly arabicEnabled: Signal<boolean> = computed(() => this.hub.enabled());
  readonly loaded: Signal<boolean> = this.hub.loaded;
  readonly defaultCustomerLanguage: Signal<'en' | 'ar'> = computed(() =>
    this.hub.settings()?.defaultCustomerLanguage === 'ar' ? 'ar' : 'en',
  );

  constructor() {
    this.ensureLoaded();
    try {
      inject(Router).events.subscribe((e) => {
        if (e instanceof NavigationEnd) {
          // R1-06: a transient failure is retried (max 2 per session). BEFORE ensureLoaded(), so a request that
          // ensureLoaded() starts for a changed token is never retried within the same navigation.
          if (readToken()) this.hub.retryIfFailed();
          this.ensureLoaded();
        }
      });
    } catch {
      /* no router in this context: the first-injection load is enough */
    }
  }

  // Idempotent. Requests the settings once per login token (HubStateService drops and re-requests them
  // when the stored token changed); logged out = forget the previous merchant's answer, no request. Never throws.
  ensureLoaded(): void {
    if (readToken()) this.hub.load();
    else if (this.hub.loaded()) this.hub.reset();
  }
}
