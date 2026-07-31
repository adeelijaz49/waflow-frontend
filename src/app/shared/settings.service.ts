import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from '../services/api.service';

export interface LoyaltySettings {
  loyaltyPointsPerUnit: number;
  minPointsPerPurchase: number;
  currency: string;
  merchantName: string;
}

const DEFAULTS: LoyaltySettings = { loyaltyPointsPerUnit: 100, minPointsPerPurchase: 100, currency: 'AUD', merchantName: '' };

// Single cached copy of Settings so the currency pipe (and anything else) doesn't
// need to fetch it independently. Refreshed whenever the Settings page saves.
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private settings$ = new BehaviorSubject<LoyaltySettings>(DEFAULTS);
  readonly settings = this.settings$.asObservable();

  constructor(private api: ApiService) {
    this.refresh();
  }

  refresh(): void {
    this.api.getLoyaltySettings().subscribe(s => this.settings$.next({ ...DEFAULTS, ...s }));
  }

  get currencySnapshot(): string {
    return this.settings$.value.currency || 'AUD';
  }
}
