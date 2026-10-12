import { Routes } from '@angular/router';

// Lazy route group for the Arabic localisation area, mounted ONCE in
// app.routes.ts as /arabic. Every tab is its own lazy chunk; the hub shell
// provides lang/dir, the tab bar and the "not enabled" state.
export const LOCALIZATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./hub/hub').then((m) => m.Hub),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', loadComponent: () => import('./overview/overview').then((m) => m.Overview) },
      { path: 'customers', loadComponent: () => import('./customers/customers-tab').then((m) => m.CustomersTab) },
      { path: 'templates', loadComponent: () => import('./templates/templates-tab').then((m) => m.TemplatesTab) },
      { path: 'templates/:id', loadComponent: () => import('./templates/template-editor').then((m) => m.TemplateEditor) },
      { path: 'campaigns', loadComponent: () => import('./campaigns/campaigns-tab').then((m) => m.CampaignsTab) },
      { path: 'campaigns/new', loadComponent: () => import('./campaigns/campaign-composer').then((m) => m.CampaignComposer) },
      { path: 'campaigns/:id', loadComponent: () => import('./campaigns/campaign-detail').then((m) => m.CampaignDetail) },
      { path: 'catalog', loadComponent: () => import('./catalog/catalog-tab').then((m) => m.CatalogTab) },
      { path: 'inbox', loadComponent: () => import('./inbox/inbox-ar').then((m) => m.InboxAr) },
      { path: 'ai-mode', loadComponent: () => import('./ai-mode/ai-mode-ar').then((m) => m.AiModeAr) },
      { path: 'flows', loadComponent: () => import('./flows/flows-tab').then((m) => m.FlowsTab) },
      { path: 'captions', loadComponent: () => import('./captions/captions-tab').then((m) => m.CaptionsTab) },
      { path: 'review', loadComponent: () => import('./review/review-tab').then((m) => m.ReviewTab) },
    ],
  },
];
