import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { OnbStateService } from '../onb-state.service';
import type { OnbState, OnbStepKey } from '../onb.types';
import { OnbResume } from './onb-resume';
import { OnbSetupShell } from './onb-setup-shell';

const isDone = (s: OnbState, k: OnbStepKey): boolean => {
  const status = s.steps?.[k]?.status;
  return status === 'done' || status === 'skipped';
};

// Prerequisites per step (DF 2.1): the server enforces the same with 409 STEP_PREREQUISITE; this only avoids a dead screen.
const PREREQ: Record<OnbStepKey, OnbStepKey | null> = {
  business: null, number: 'business', connect: 'number', approvals: 'connect', promotion: 'connect',
};

/** Where to send a merchant who opened a step that is not open yet; null = let them in. Pure. */
export function stepRedirect(s: OnbState | null | undefined, step: OnbStepKey, requestedUrl: string, landing: string | null): string | null {
  if (!s || s.enrolled !== true) return null; // unknown: fail open (the parent guard already handled non-enrolled)
  const sub = s.subscription?.state ?? 'none';
  if (sub === 'none' || sub === 'pending' || s.view === 'billing') return '/setup/billing';
  const need = PREREQ[step];
  if (!need || !s.steps || isDone(s, need)) return null;
  const target = landing ?? '/dashboard';
  // never redirect to the page being opened (inconsistent state would loop)
  return target.split('?')[0] === requestedUrl.split('?')[0] ? null : target;
}

export function stepGuard(step: OnbStepKey): CanActivateFn {
  return (_route, routerState) => {
    const state = inject(OnbStateService);
    const router = inject(Router);
    try {
      const to = stepRedirect(state.state(), step, routerState.url, state.landingUrl());
      return to ? router.parseUrl(to) : true;
    } catch {
      return true;
    }
  };
}

export const SETUP_ROUTES: Routes = [
  {
    path: '',
    component: OnbSetupShell,
    children: [
      { path: '', pathMatch: 'full', component: OnbResume },
      { path: 'billing', loadComponent: () => import('./screens/billing').then((m) => m.BillingScreen) },
      {
        path: 'business', canActivate: [stepGuard('business')],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'name' },
          { path: 'name', loadComponent: () => import('./screens/business-name').then((m) => m.BusinessNameScreen) },
          { path: 'industry', loadComponent: () => import('./screens/business-industry').then((m) => m.BusinessIndustryScreen) },
          { path: 'links', loadComponent: () => import('./screens/business-links').then((m) => m.BusinessLinksScreen) },
          { path: 'cr', loadComponent: () => import('./screens/business-cr').then((m) => m.BusinessCrScreen) },
        ],
      },
      {
        path: 'number', canActivate: [stepGuard('number')],
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./screens/number-question').then((m) => m.NumberQuestionScreen) },
          { path: 'not-sure', loadComponent: () => import('./screens/number-not-sure').then((m) => m.NumberNotSureScreen) },
          { path: 'where', loadComponent: () => import('./screens/number-where').then((m) => m.NumberWhereScreen) },
          { path: 'personal', loadComponent: () => import('./screens/number-personal').then((m) => m.NumberPersonalScreen) },
          { path: 'business-app', loadComponent: () => import('./screens/number-business-app').then((m) => m.NumberBusinessAppScreen) },
          { path: 'migrate', loadComponent: () => import('./screens/number-migrate').then((m) => m.NumberMigrateScreen) },
          { path: 'landline', loadComponent: () => import('./screens/number-landline').then((m) => m.NumberLandlineScreen) },
          { path: 'get-one', loadComponent: () => import('./screens/number-get-one').then((m) => m.NumberGetOneScreen) },
          { path: 'help', loadComponent: () => import('./screens/number-help').then((m) => m.NumberHelpScreen) },
          { path: 'paused', loadComponent: () => import('./screens/number-paused').then((m) => m.NumberPausedScreen) },
        ],
      },
      {
        path: 'connect', canActivate: [stepGuard('connect')],
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./screens/connect').then((m) => m.ConnectScreen) },
          { path: 'no-facebook', loadComponent: () => import('./screens/connect-no-facebook').then((m) => m.ConnectNoFacebookScreen) },
        ],
      },
      { path: 'approvals', canActivate: [stepGuard('approvals')], loadComponent: () => import('./screens/approvals').then((m) => m.ApprovalsScreen) },
      {
        path: 'customers', canActivate: [stepGuard('approvals')],
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./screens/customers-method').then((m) => m.CustomersMethodScreen) },
          { path: 'upload', loadComponent: () => import('./screens/customers-upload').then((m) => m.CustomersUploadScreen) },
          { path: 'paste', loadComponent: () => import('./screens/customers-paste').then((m) => m.CustomersPasteScreen) },
          { path: 'one', loadComponent: () => import('./screens/customers-one').then((m) => m.CustomersOneScreen) },
          { path: 'optin', loadComponent: () => import('./screens/customers-optin').then((m) => m.CustomersOptinScreen) },
          { path: 'preview', loadComponent: () => import('./screens/customers-preview').then((m) => m.CustomersPreviewScreen) },
          { path: 'result', loadComponent: () => import('./screens/customers-result').then((m) => m.CustomersResultScreen) },
        ],
      },
      { path: 'products', canActivate: [stepGuard('approvals')], loadComponent: () => import('./screens/products').then((m) => m.ProductsScreen) },
      {
        path: 'promotion', canActivate: [stepGuard('promotion')],
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./screens/promotion').then((m) => m.PromotionScreen) },
          { path: 'test', loadComponent: () => import('./screens/promotion-test').then((m) => m.PromotionTestScreen) },
        ],
      },
      { path: 'done', canActivate: [stepGuard('promotion')], loadComponent: () => import('./screens/done').then((m) => m.DoneScreen) },
      { path: 'notifications', loadComponent: () => import('../shell/onb-notifications').then((m) => m.OnbNotificationsPage) },
      { path: '**', redirectTo: '' },
    ],
  },
];
