import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, filter, firstValueFrom, of, timeout } from 'rxjs';
import { ApiService } from '../services/api.service';
import { PlatformApiService } from './platform-api.service';

export interface AuthSession {
  user: { id: string; name: string; phone: string; email: string };
  workspace: { id: string; name: string; onboarding: { completed: boolean; currentStep: number } };
  role: 'owner' | 'member';
  // Platform staff (set by the backend from SUPER_ADMIN_CONTACTS, re-checked on every /api/platform call).
  superAdmin?: boolean;
  // May this session manage the WhatsApp token and templates it sends from (the Settings cards)? Decided by the server with the very rule
  // it enforces on those calls: platform staff for the platform's account (a super admin outside any customer, or - while none is
  // configured - the oldest workspace's people), the owner of a customer for that customer's own account.
  canManageWhatsApp?: boolean;
  // Present only while a super admin is "inside" a customer (8-hour act-as token).
  actingAs?: { customerName: string; workspaceId: string };
}

export const TOKEN_KEY = 'waflow_auth_token';
// The super admin's own token, parked while they are inside a customer so "Back to Platform" can restore it.
export const HOME_TOKEN_KEY = 'waflow_home_token';
// Not scoped per workspace, so they must be dropped on every workspace switch (a chat session or caption draft
// from one customer must never show up inside another).
const UNSCOPED_KEYS = ['waflow_ai_mode_session_id', 'waflow_ai_mode_ar_session_id', 'waflow_caption_draft'];
// The audit call made when leaving a customer is best effort: this is how long it is waited for.
export const EXIT_TIMEOUT_MS = 5000;

// Modeled on SettingsService's BehaviorSubject pattern. The JWT itself (not
// this cached session object) is what the backend actually trusts on every
// request — session$ just holds enough to render the UI (name, workspace,
// role) without an extra round trip on every page.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session$ = new BehaviorSubject<AuthSession | null>(null);
  readonly session = this.session$.asObservable();

  constructor(private api: ApiService, private platform: PlatformApiService) {
    if (this.token) this.refresh();
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get sessionSnapshot(): AuthSession | null {
    return this.session$.value;
  }

  // Called by the login/auth-verify pages once a passwordless flow returns a
  // real session token (never for the chooseWorkspace intermediate step).
  completeLogin(token: string): void {
    // A new sign-in starts clean: a parked super-admin token or a chat / caption draft of whoever used this browser before must not
    // carry over (a stale chat session id would even be refused in another customer's workspace).
    try { localStorage.removeItem(HOME_TOKEN_KEY); } catch { /* storage blocked: nothing to clean */ }
    this.clearUnscopedKeys();
    localStorage.setItem(TOKEN_KEY, token);
    this.refresh();
  }

  // Where to send the browser right after a successful login — the one place
  // the onboarding wizard actually gets triggered from. Reads onboarding
  // straight off the login/verify/select-workspace response body (not the
  // async session$ refresh triggered by completeLogin above) so there's no
  // race between navigating and the session actually being populated.
  postLoginRedirect(res: { workspace?: { onboarding?: { completed?: boolean } } }): string {
    return res.workspace?.onboarding?.completed === false ? '/onboarding' : '/dashboard';
  }

  // Only a 401 means the token is no longer good. A network blip or a 5xx on /me
  // must not drop a super admin (or anyone) out of the app.
  refresh(): void {
    this.api.getMe().subscribe({
      next: (s) => this.session$.next(s),
      error: (err: HttpErrorResponse) => {
        if (err?.status === 401) this.logout();
      },
    });
  }

  // Resolves with the first non-null session (guards need it: session$ starts null and fills asynchronously, so a
  // snapshot read on a hard refresh would wrongly say "not a super admin"). Resolves null when there is no token or
  // when no session arrives within timeoutMs (e.g. /me failing).
  whenSession(timeoutMs = 5000): Promise<AuthSession | null> {
    const now = this.session$.value;
    if (now) return Promise.resolve(now);
    if (!this.token) return Promise.resolve(null);
    return firstValueFrom(
      this.session$.pipe(
        filter((s): s is AuthSession => !!s),
        timeout({ first: timeoutMs, with: () => of(null) }),
      ),
    );
  }

  // Super admin steps inside a customer. The API call happens first (with the home token); only when it succeeds is
  // the home token parked and the act-as token swapped in. A full page load follows so every in-memory cache of the
  // previous workspace is dropped. Rejects with the HTTP error so the caller can tell the person.
  async enterTenant(tenantId: string): Promise<void> {
    const res = await firstValueFrom(this.platform.enter(tenantId));
    if (!res?.token) throw new Error('The server did not return a session for this customer.');
    const current = this.token;
    // Never overwrite an existing stash with an act-as token (entering from inside a customer).
    if (current && !this.sessionSnapshot?.actingAs) localStorage.setItem(HOME_TOKEN_KEY, current);
    localStorage.setItem(TOKEN_KEY, res.token);
    this.clearUnscopedKeys();
    this.session$.next(null);
    this.go('/dashboard');
  }

  // Back to the platform. The server is told (audit row) on a best-effort basis; the home token is restored whatever
  // happens. When the stash is gone the person simply signs in again.
  async exitTenant(): Promise<void> {
    try {
      // best effort, and never for long: a hung connection must not keep the person on "Leaving..."
      await firstValueFrom(this.platform.exit().pipe(timeout(EXIT_TIMEOUT_MS)));
    } catch {
      // an expired act-as token (or no answer in time) must not trap the person inside the customer
    }
    const home = localStorage.getItem(HOME_TOKEN_KEY);
    localStorage.removeItem(HOME_TOKEN_KEY);
    this.clearUnscopedKeys();
    this.session$.next(null);
    if (home) {
      localStorage.setItem(TOKEN_KEY, home);
      this.go('/platform');
    } else {
      localStorage.removeItem(TOKEN_KEY);
      this.go('/login');
    }
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(HOME_TOKEN_KEY);
    this.clearUnscopedKeys();
    this.session$.next(null);
  }

  private clearUnscopedKeys(): void {
    for (const k of UNSCOPED_KEYS) {
      try { localStorage.removeItem(k); } catch { /* storage blocked: nothing to clean */ }
    }
  }

  // A full page load (not a router navigation) on purpose; one place so specs can stub it.
  protected go(url: string): void {
    window.location.assign(url);
  }
}
