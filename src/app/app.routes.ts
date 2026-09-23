import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { legalAcceptanceGuard } from './guards/legal-acceptance.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login',       loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: 'auth/verify', loadComponent: () => import('./pages/auth-verify/auth-verify').then(m => m.AuthVerify) },
  { path: 'dashboard',  canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'ai-mode',    canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/ai-mode/ai-mode').then(m => m.AiMode) },
  { path: 'demo',       canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/demo/demo').then(m => m.Demo) },
  { path: 'products',   canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/products/products').then(m => m.Products) },
  { path: 'customers',  canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/customers/customers').then(m => m.Customers) },
  { path: 'inbox',      canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/inbox/inbox').then(m => m.Inbox) },
  { path: 'orders',     canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/orders/orders').then(m => m.Orders) },
  { path: 'promotions', canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/promotions/promotions').then(m => m.Promotions) },
  { path: 'flows',      canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/flows/flows').then(m => m.Flows) },
  { path: 'services',   canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/services/services').then(m => m.Services) },
  { path: 'settings',   canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },
  { path: 'usage-limits', canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/usage-limits/usage-limits').then(m => m.UsageLimits) },
  { path: 'support',    canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/support/support').then(m => m.Support) },
  { path: 'onboarding', canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/onboarding/onboarding').then(m => m.Onboarding) },
  { path: 'imports',    canActivate: [authGuard, legalAcceptanceGuard], loadComponent: () => import('./pages/imports/imports').then(m => m.Imports) },
  // Not gated by legalAcceptanceGuard — a user must be able to read the very
  // documents they're being asked to accept, and reach the acceptance flow
  // itself without an infinite redirect loop.
  { path: 'legal/:slug', canActivate: [authGuard], loadComponent: () => import('./pages/legal-document/legal-document').then(m => m.LegalDocument) },
  { path: 'legal-acceptance', canActivate: [authGuard], loadComponent: () => import('./pages/legal-acceptance/legal-acceptance').then(m => m.LegalAcceptance) },
];
