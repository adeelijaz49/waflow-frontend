import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard',  loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'products',   loadComponent: () => import('./pages/products/products').then(m => m.Products) },
  { path: 'customers',  loadComponent: () => import('./pages/customers/customers').then(m => m.Customers) },
  { path: 'orders',     loadComponent: () => import('./pages/orders/orders').then(m => m.Orders) },
  { path: 'promotions', loadComponent: () => import('./pages/promotions/promotions').then(m => m.Promotions) },
];
