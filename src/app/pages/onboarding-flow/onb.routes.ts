import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, Routes } from '@angular/router';
import { authGuard } from '../../guards/auth.guard';
import { legalAcceptanceGuard } from '../../guards/legal-acceptance.guard';
import { ONB_UI_ENABLED_TOKEN } from './onb-links';
import { OnbStateService } from './onb-state.service';

// Upper bound the router ever waits for the state answer before falling through to today's route.
export const ONB_GUARD_WAIT_MS = 1200;
const SETUP_GUARD_WAIT_MS = 4000;

// canMatch on the two shadow routes. `false` = "not mine": the router continues with the EXISTING route.
// Any error, timeout, missing token or unknown answer -> false (fail-open to today's behaviour).
const hostMatch: CanMatchFn = async () => {
  if (!inject(ONB_UI_ENABLED_TOKEN)) return false;
  const state = inject(OnbStateService); // inject BEFORE the first await
  const router = inject(Router);
  try {
    const s = await state.resolveForGuard(ONB_GUARD_WAIT_MS);
    if (!s || s.enrolled !== true || !state.hostNeeded()) return false;
    const target = state.landingUrl();
    if (target && state.firstLandingThisSession()) {
      return router.parseUrl(target); // spec 1b.3: first login after payment -> straight into the step
    }
    return true;
  } catch {
    return false;
  }
};

// /onboarding shadow: only enrolled workspaces; everyone else gets the old wizard untouched.
const enrolledMatch: CanMatchFn = async () => {
  if (!inject(ONB_UI_ENABLED_TOKEN)) return false;
  const state = inject(OnbStateService);
  try {
    const s = await state.resolveForGuard(ONB_GUARD_WAIT_MS);
    return !!s && s.enrolled === true;
  } catch {
    return false;
  }
};

// /setup/**: not enrolled -> back to the dashboard.
const enrolledGuard: CanActivateFn = async () => {
  const state = inject(OnbStateService);
  const router = inject(Router);
  const enabled = inject(ONB_UI_ENABLED_TOKEN);
  try {
    if (!enabled) return router.parseUrl('/dashboard');
    const s = await state.resolveForGuard(SETUP_GUARD_WAIT_MS);
    return s && s.enrolled === true ? true : router.parseUrl('/dashboard');
  } catch {
    return router.parseUrl('/dashboard');
  }
};

export const ONBOARDING_FLOW_ROUTES: Routes = [
  {
    path: 'dashboard', canMatch: [hostMatch], canActivate: [authGuard, legalAcceptanceGuard],
    loadComponent: () => import('./setup/onb-dashboard-host').then((m) => m.OnbDashboardHost),
  },
  {
    path: 'onboarding', canMatch: [enrolledMatch], canActivate: [authGuard, legalAcceptanceGuard],
    loadComponent: () => import('./setup/onb-entry').then((m) => m.OnbEntry),
  },
  {
    path: 'setup', canActivate: [authGuard, legalAcceptanceGuard, enrolledGuard],
    loadChildren: () => import('./setup/setup.routes').then((m) => m.SETUP_ROUTES),
  },
];
