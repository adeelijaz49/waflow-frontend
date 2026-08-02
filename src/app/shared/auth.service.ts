import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from '../services/api.service';

export interface AuthSession {
  user: { id: string; name: string; phone: string; email: string };
  workspace: { id: string; name: string };
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
