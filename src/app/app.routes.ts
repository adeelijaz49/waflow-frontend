import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login',       loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: 'auth/verify', loadComponent: () => import('./pages/auth-verify/auth-verify').then(m => m.AuthVerify) },
  { path: 'dashboard',  canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'ai-mode',    canActivate: [authGuard], loadComponent: () => import('./pages/ai-mode/ai-mode').then(m => m.AiMode) },
  { path: 'demo',       canActivate: [authGuard], loadComponent: () => import('./pages/demo/demo').then(m => m.Demo) },
  { path: 'products',   canActivate: [authGuard], loadComponent: () => import('./pages/products/products').then(m => m.Products) },
  { path: 'customers',  canActivate: [authGuard], loadComponent: () => import('./pages/customers/customers').then(m => m.Customers) },
  { path: 'orders',     canActivate: [authGuard], loadComponent: () => import('./pages/orders/orders').then(m => m.Orders) },
  { path: 'promotions', canActivate: [authGuard], loadComponent: () => import('./pages/promotions/promotions').then(m => m.Promotions) },
  { path: 'flows',      canActivate: [authGuard], loadComponent: () => import('./pages/flows/flows').then(m => m.Flows) },
  { path: 'services',   canActivate: [authGuard], loadComponent: () => import('./pages/services/services').then(m => m.Services) },
  { path: 'settings',   canActivate: [authGuard], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },
];
