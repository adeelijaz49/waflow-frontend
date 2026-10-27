import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../shared/auth.service';

// How long the guard waits for GET /api/auth/me on a hard refresh of /platform before giving up and denying.
export const PLATFORM_GUARD_TIMEOUT_MS = 5000;

// The platform console is for super admins who are NOT currently inside a customer. authGuard only checks that a
// token exists, and the session fills asynchronously, so this waits for the first real session instead of reading a
// snapshot (a snapshot would wrongly deny a super admin who reloads the page). Anything else, including a timeout,
// is a deny. The backend re-checks every /api/platform call, so this is a courtesy, not the security boundary.
export const platformAdminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const session = await auth.whenSession(PLATFORM_GUARD_TIMEOUT_MS);
  if (session?.superAdmin === true && !session.actingAs) return true;
  return router.parseUrl('/dashboard');
};
