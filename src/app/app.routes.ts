import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard',  loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'demo',       loadComponent: () => import('./pages/demo/demo').then(m => m.Demo) },
  { path: 'products',   loadComponent: () => import('./pages/products/products').then(m => m.Products) },
  { path: 'customers',  loadComponent: () => import('./pages/customers/customers').then(m => m.Customers) },
  { path: 'orders',     loadComponent: () => import('./pages/orders/orders').then(m => m.Orders) },
  { path: 'promotions', loadComponent: () => import('./pages/promotions/promotions').then(m => m.Promotions) },
  { path: 'flows',      loadComponent: () => import('./pages/flows/flows').then(m => m.Flows) },
  { path: 'services',   loadComponent: () => import('./pages/services/services').then(m => m.Services) },
  { path: 'settings',  loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },
];
