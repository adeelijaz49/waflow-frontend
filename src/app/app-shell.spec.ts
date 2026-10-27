import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

// The shell parts added for the platform (super admin) area: the nav entry, the footer role label and the
// "acting as" banner. (app.spec.ts is a stale scaffold and is left alone.)
vi.setConfig({ testTimeout: 30000 });

const ME = /\/api\/auth\/me$/;
const base = {
  user: { id: 'u1', name: 'Staff Person', phone: '', email: 'staff@example.com' },
  workspace: { id: 'w1', name: 'Home Workspace', onboarding: { completed: true, currentStep: 5 } },
  role: 'owner',
};

async function settle(fixture: ComponentFixture<App>) {
  for (let i = 0; i < 3; i++) {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function boot(session: unknown | null, token: string | null = 'tok') {
  localStorage.clear();
  if (token) localStorage.setItem('waflow_auth_token', token);
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  if (token && session) http.expectOne((r) => ME.test(r.url)).flush(session);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const nav = () => Array.from(el.querySelectorAll('.sidebar-nav a')).map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim());
  return { fixture, el, http, nav };
}

describe('App shell: platform entry, role label and acting-as banner', () => {
  afterEach(() => localStorage.clear());

  it('shows no Platform entry and no banner to an ordinary owner', async () => {
    const { el, nav } = await boot(base);
    expect(nav().some((t) => t.includes('Platform'))).toBe(false);
    expect(nav().some((t) => t.includes('Dashboard'))).toBe(true);
    expect(el.querySelector('.acting-banner')).toBeNull();
    expect(el.querySelector('.store-sub')?.textContent).toContain('Owner');
  });

  it('shows no Platform entry when superAdmin is false', async () => {
    const { nav } = await boot({ ...base, superAdmin: false });
    expect(nav().some((t) => t.includes('Platform'))).toBe(false);
  });

  it('shows the Platform entry and the Super admin label to a super admin', async () => {
    const { el, nav } = await boot({ ...base, superAdmin: true });
    expect(nav().some((t) => t.includes('Platform'))).toBe(true);
    const link = Array.from(el.querySelectorAll('.sidebar-nav a')).find((a) => (a.textContent || '').includes('Platform'));
    expect(link?.getAttribute('href')).toBe('/platform');
    expect(el.querySelector('.store-sub')?.textContent).toContain('Super admin');
    expect(el.querySelector('.acting-banner')).toBeNull();
  });

  it('while acting inside a customer: banner with the customer name and a Back to Platform button, no Platform entry', async () => {
    const { el, nav } = await boot({
      ...base, superAdmin: true, workspace: { id: 'w2', name: 'MegaSun', onboarding: { completed: true, currentStep: 5 } },
      actingAs: { customerName: 'MegaSun', workspaceId: 'w2' },
    });
    const banner = el.querySelector('.acting-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('You are viewing');
    expect(banner?.textContent).toContain('MegaSun');
    expect(banner?.textContent).toContain('as a super admin');
    expect(banner?.querySelector('button')?.textContent).toContain('Back to Platform');
    expect(nav().some((t) => t.includes('Platform'))).toBe(false);
    expect(el.querySelector('.store-sub')?.textContent).toContain('Owner');
    // it lives inside the main column, above the page outlet
    expect(el.querySelector('main.main-content')?.firstElementChild?.tagName.toLowerCase()).toBe('app-acting-as-banner');
  });

  it('shows no sidebar and no banner when logged out', async () => {
    const { el } = await boot(null, null);
    expect(el.querySelector('.sidebar')).toBeNull();
    expect(el.querySelector('.acting-banner')).toBeNull();
  });
});
