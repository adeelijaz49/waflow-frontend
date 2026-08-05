import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from '../services/api.service';

export interface AuthSession {
  user: { id: string; name: string; phone: string; email: string };
  workspace: { id: string; name: string; onboarding: { completed: boolean; currentStep: number } };
  role: 'owner' | 'member';
}

const TOKEN_KEY = 'waflow_auth_token';

// Modeled on SettingsService's BehaviorSubject pattern. The JWT itself (not
// this cached session object) is what the backend actually trusts on every
// request — session$ just holds enough to render the UI (name, workspace,
// role) without an extra round trip on every page.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session$ = new BehaviorSubject<AuthSession | null>(null);
  readonly session = this.session$.asObservable();

  constructor(private api: ApiService) {
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

  refresh(): void {
    this.api.getMe().subscribe({
      next: (s) => this.session$.next(s),
      error: () => this.logout(),
    });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.session$.next(null);
  }
}
