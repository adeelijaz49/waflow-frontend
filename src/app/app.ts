import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  navItems = [
    { path: '/dashboard',  label: 'Dashboard',   icon: '◈' },
    { path: '/products',   label: 'Products',     icon: '⊞' },
    { path: '/customers',  label: 'Customers',    icon: '◎' },
    { path: '/orders',     label: 'Orders',       icon: '▤' },
    { path: '/promotions', label: 'Promotions',   icon: '◈' },
  ];
}

