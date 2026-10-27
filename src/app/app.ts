import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './shared/auth.service';
import { Dialog } from './shared/dialog/dialog';
import { ActingAsBanner } from './pages/platform-admin/acting-as-banner/acting-as-banner';

interface NavItem { path: string; label: string; icon: string; superAdminOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',  label: 'Dashboard',   icon: '◈' },
  { path: '/ai-mode',    label: 'AI Mode',      icon: '✦' },
  { path: '/demo',       label: 'Demo Mode',    icon: '▶' },
  { path: '/products',   label: 'Products',     icon: '⊞' },
  { path: '/customers',  label: 'Customers',    icon: '◎' },
  { path: '/inbox',      label: 'WhatsApp Inbox', icon: '💬' },
  { path: '/orders',     label: 'Orders',       icon: '▤' },
  { path: '/promotions', label: 'Promotions',   icon: '◈' },
  { path: '/referrals',  label: 'Referral Promotions', icon: '🤝' },
  { path: '/instagram-promotions', label: 'Instagram Promotions', icon: '📷' },
  { path: '/flows',      label: 'Automated Flows', icon: '⟳' },
  { path: '/services',   label: 'Services',     icon: '✂' },
  { path: '/settings',   label: 'Settings',     icon: '⚙' },
  { path: '/usage-limits', label: 'Usage & Limits', icon: '📊' },
  { path: '/arabic',    label: 'Arabic',      icon: '🌐' },
  { path: '/support',    label: 'Support',      icon: '❓' },
  // Platform staff only: filtered out unless the session says superAdmin (see the App constructor).
  { path: '/platform',   label: 'Platform',     icon: '🛡', superAdminOnly: true },
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, Dialog, ActingAsBanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Off-canvas sidebar state — only meaningful <=1024px (see app.css), where
  // the sidebar becomes a slide-in drawer instead of a permanent column.
  // Unused above that width; toggling it there is harmless (no visual effect).
  sidebarOpen = false;

  // The sidebar list for the current session. Rebuilt only when the session changes (not on every change
  // detection pass) so the @for keeps stable identity.
  navItems: NavItem[] = NAV_ITEMS.filter(i => !i.superAdminOnly);

  constructor(public auth: AuthService, private router: Router) {
    // Auto-close the drawer on every navigation so tapping a nav link on
    // mobile doesn't leave it open over the new page.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.sidebarOpen = false;
    });
    // "Platform" is for super admins who are not currently inside a customer: the console is closed to an act-as
    // session (the guard sends it away), so a link there would just bounce; the banner's button is the way back.
    this.auth.session.subscribe((s) => {
      const showPlatform = s?.superAdmin === true && !s.actingAs;
      this.navItems = NAV_ITEMS.filter(i => !i.superAdminOnly || showPlatform);
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  roleLabel(s: { role: string; superAdmin?: boolean; actingAs?: unknown }): string {
    if (s.superAdmin && !s.actingAs) return 'Super admin';
    return s.role === 'owner' ? 'Owner' : 'Member';
  }
}
