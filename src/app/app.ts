import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './shared/auth.service';
import { Dialog } from './shared/dialog/dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, Dialog],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Off-canvas sidebar state — only meaningful <=1024px (see app.css), where
  // the sidebar becomes a slide-in drawer instead of a permanent column.
  // Unused above that width; toggling it there is harmless (no visual effect).
  sidebarOpen = false;

  constructor(public auth: AuthService, private router: Router) {
    // Auto-close the drawer on every navigation so tapping a nav link on
    // mobile doesn't leave it open over the new page.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.sidebarOpen = false;
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  navItems = [
    { path: '/dashboard',  label: 'Dashboard',   icon: '◈' },
    { path: '/ai-mode',    label: 'AI Mode',      icon: '✦' },
    { path: '/demo',       label: 'Demo Mode',    icon: '▶' },
    { path: '/products',   label: 'Products',     icon: '⊞' },
    { path: '/customers',  label: 'Customers',    icon: '◎' },
    { path: '/orders',     label: 'Orders',       icon: '▤' },
    { path: '/promotions', label: 'Promotions',   icon: '◈' },
    { path: '/flows',      label: 'Automated Flows', icon: '⟳' },
    { path: '/services',   label: 'Services',     icon: '✂' },
    { path: '/settings',   label: 'Settings',     icon: '⚙' },
    { path: '/support',    label: 'Support',      icon: '❓' },
  ];
}

