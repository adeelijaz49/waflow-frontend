import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './shared/auth.service';
import { Dialog } from './shared/dialog/dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, Dialog],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor(public auth: AuthService, private router: Router) {}

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

