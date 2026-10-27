import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { AuthService } from '../shared/auth.service';
import { LegalService } from '../shared/legal.service';

// Fully independent of the onboarding wizard's own gating (workspace.onboarding
// .completed) — this runs for every guarded route, for every user, so an
// invited teammate who never sees the wizard still gets asked, and a
// document-version bump re-prompts an existing user on their next navigation.
export const legalAcceptanceGuard: CanActivateFn = (route, state) => {
  const legal = inject(LegalService);
  const router = inject(Router);
  const auth = inject(AuthService);

  // A super admin acting inside a customer must never be asked to accept (or be able to accept) that customer's
  // legal documents; the backend reports nothing required for act-as tokens too.
  if (auth.sessionSnapshot?.actingAs) return of(true);

  return legal.status().pipe(
    map((status) => {
      if (status.requiresCombinedAcceptance || status.requiresDpaAcceptance) {
        return router.createUrlTree(['/legal-acceptance'], { queryParams: { returnUrl: state.url } });
      }
      return true;
    }),
  );
};
