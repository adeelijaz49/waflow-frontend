import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import { ActingAsBanner } from './acting-as-banner';

function setup(session: unknown, exitTenant: () => Promise<void> = () => Promise.resolve()) {
  const subject = new BehaviorSubject<unknown>(session);
  const auth = { session: subject.asObservable(), exitTenant: vi.fn(exitTenant) };
  const dialog = { error: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: auth }, { provide: DialogService, useValue: dialog }],
  });
  const fixture = TestBed.createComponent(ActingAsBanner);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const refresh = async () => { fixture.componentRef.changeDetectorRef.markForCheck(); fixture.detectChanges(); await fixture.whenStable(); };
  return { fixture, el, auth, dialog, subject, refresh };
}

describe('ActingAsBanner', () => {
  it('renders nothing for a normal session or no session', () => {
    expect(setup(null).el.querySelector('.acting-banner')).toBeNull();
    TestBed.resetTestingModule();
    expect(setup({ role: 'owner', superAdmin: true }).el.querySelector('.acting-banner')).toBeNull();
  });

  it('says who the super admin is viewing and offers Back to Platform', () => {
    const { el } = setup({ actingAs: { customerName: 'MegaSun', workspaceId: 'w2' } });
    expect(el.querySelector('.acting-banner')?.textContent).toContain('You are viewing MegaSun as a super admin');
    expect(el.querySelector('button')?.textContent).toContain('Back to Platform');
  });

  it('escapes the customer name (no markup injection)', () => {
    const { el } = setup({ actingAs: { customerName: '<img src=x onerror=alert(1)>', workspaceId: 'w2' } });
    expect(el.querySelector('.acting-banner img')).toBeNull();
    expect(el.textContent).toContain('<img src=x');
  });

  it('appears and disappears with the session', async () => {
    const { el, subject, refresh } = setup(null);
    subject.next({ actingAs: { customerName: 'A', workspaceId: 'w' } });
    await refresh();
    expect(el.querySelector('.acting-banner')).not.toBeNull();
    subject.next({ role: 'owner' });
    await refresh();
    expect(el.querySelector('.acting-banner')).toBeNull();
  });

  it('Back to Platform calls exitTenant once, even when clicked twice', async () => {
    let finish!: () => void;
    const { el, auth, refresh } = setup({ actingAs: { customerName: 'A', workspaceId: 'w' } }, () => new Promise<void>((r) => { finish = r; }));
    const btn = el.querySelector('button') as HTMLButtonElement;
    btn.click();
    btn.click();
    await refresh();
    expect(auth.exitTenant).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    finish();
  });

  it('tells the person when going back fails, and lets them try again', async () => {
    const { el, auth, dialog, refresh } = setup({ actingAs: { customerName: 'A', workspaceId: 'w' } }, () => Promise.reject(new Error('x')));
    (el.querySelector('button') as HTMLButtonElement).click();
    await refresh();
    await refresh();
    expect(dialog.error).toHaveBeenCalledTimes(1);
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    expect(auth.exitTenant).toHaveBeenCalledTimes(1);
  });
});
