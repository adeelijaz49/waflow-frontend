import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from '../services/api.service';
import { AuthService } from './auth.service';

export interface LoyaltySettings {
  loyaltyPointsPerUnit: number;
  minPointsPerPurchase: number;
  currency: string;
  merchantName: string;
}

const DEFAULTS: LoyaltySettings = { loyaltyPointsPerUnit: 100, minPointsPerPurchase: 100, currency: 'AUD', merchantName: '' };

// Single cached copy of Settings so the currency pipe (and anything else) doesn't
// need to fetch it independently. Refreshed whenever the Settings page saves, and
// reset + refreshed when the signed-in workspace changes (one app, many customers:
// the previous customer's currency must never linger).
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private settings$ = new BehaviorSubject<LoyaltySettings>(DEFAULTS);
  readonly settings = this.settings$.asObservable();

  private workspaceId: string | null = null;
  private readonly fetchedAtStart: boolean;

  constructor(private api: ApiService, private auth: AuthService) {
    this.fetchedAtStart = this.auth.isLoggedIn;
    this.refresh();
    this.auth.session.subscribe((s) => this.onSession(s?.workspace?.id));
  }

  refresh(): void {
    this.api.getLoyaltySettings().subscribe(s => this.settings$.next({ ...DEFAULTS, ...s }));
  }

  get currencySnapshot(): string {
    return this.settings$.value.currency || 'AUD';
  }

  private onSession(id: unknown): void {
    // A logout emits null and a half-loaded /me carries no id: neither is a workspace change.
    if (typeof id !== 'string' || !id || id === this.workspaceId) return;
    const previous = this.workspaceId;
    this.workspaceId = id;
    // First session of this page load: the constructor already fetched with the stored token. (Not so when the
    // page started logged out and the person has just signed in: then the settings must be fetched now.)
    if (previous === null && this.fetchedAtStart) return;
    this.settings$.next(DEFAULTS);
    this.refresh();
  }
}
