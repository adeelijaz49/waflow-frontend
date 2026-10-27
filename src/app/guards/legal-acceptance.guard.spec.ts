import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { AuthService } from '../shared/auth.service';
import { LegalService } from '../shared/legal.service';
import { legalAcceptanceGuard } from './legal-acceptance.guard';

function setup(session: unknown, status: unknown) {
  const legal = { status: vi.fn().mockReturnValue(of(status)) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { sessionSnapshot: session } },
      { provide: LegalService, useValue: legal },
    ],
  });
  return { legal, router: TestBed.inject(Router) };
}

function run(url = '/dashboard'): Promise<boolean | UrlTree> {
  const obs = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
    legalAcceptanceGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  ) as Observable<boolean | UrlTree>;
  return new Promise((resolve) => obs.subscribe(resolve));
}

describe('legalAcceptanceGuard', () => {
  it('passes without even asking the server while a super admin is acting inside a customer', async () => {
    const { legal } = setup({ actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } }, { requiresDpaAcceptance: true, requiresCombinedAcceptance: true });
    expect(await run()).toBe(true);
    expect(legal.status).not.toHaveBeenCalled();
  });

  it('still redirects an ordinary owner who has not accepted the DPA', async () => {
    const { router } = setup({ role: 'owner' }, { requiresDpaAcceptance: true, requiresCombinedAcceptance: false });
    const res = await run('/products');
    expect(res).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(res as UrlTree)).toBe('/legal-acceptance?returnUrl=%2Fproducts');
  });

  it('still redirects when the combined documents are required', async () => {
    setup(null, { requiresDpaAcceptance: false, requiresCombinedAcceptance: true });
    expect(await run()).toBeInstanceOf(UrlTree);
  });

  it('passes a user who has accepted everything', async () => {
    setup({ role: 'member' }, { requiresDpaAcceptance: false, requiresCombinedAcceptance: false });
    expect(await run()).toBe(true);
  });

  it('a super admin NOT acting (no actingAs) is treated like anyone else', async () => {
    const { legal } = setup({ role: 'owner', superAdmin: true }, { requiresDpaAcceptance: false, requiresCombinedAcceptance: false });
    expect(await run()).toBe(true);
    expect(legal.status).toHaveBeenCalledTimes(1);
  });
});
