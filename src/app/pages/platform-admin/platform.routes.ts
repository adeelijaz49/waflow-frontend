import { Routes } from '@angular/router';

// Lazy area behind /platform (guarded by platformAdminGuard in app.routes.ts). English only by owner decision, and
// deliberately outside the i18n-checked folders.
export const PLATFORM_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./tenants-list/tenants-list').then(m => m.TenantsList) },
  { path: ':id', loadComponent: () => import('./tenant-detail/tenant-detail').then(m => m.TenantDetail) },
];
