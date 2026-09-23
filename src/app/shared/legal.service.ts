import { Injectable } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';
import { LegalApiService, LegalAcceptanceStatus } from '../services/legal-api.service';

// Caches GET /api/legal/acceptance-status for the life of a session — one
// call per navigation burst, not one per guarded route. Invalidated on every
// AuthService.session emission (login, logout, or a post-accept refresh())
// so a stale "already accepted" read can never survive a session change, and
// again explicitly via refresh() right after an accept call.
@Injectable({ providedIn: 'root' })
export class LegalService {
  private cached$: Observable<LegalAcceptanceStatus> | null = null;

  constructor(private legalApi: LegalApiService, private auth: AuthService) {
    this.auth.session.subscribe(() => { this.cached$ = null; });
  }

  status(): Observable<LegalAcceptanceStatus> {
    if (!this.cached$) {
      this.cached$ = this.legalApi.getAcceptanceStatus().pipe(shareReplay(1));
    }
    return this.cached$;
  }

  refresh(): void {
    this.cached$ = null;
  }
}
