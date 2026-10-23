import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import type { CatalogMap } from '../../i18n/i18n.types';
import { OnbAnalyticsService } from './onb-analytics.service';
import { OnbAnnouncer, OnbFocus } from './onb-focus';

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
}

@Component({ imports: [OnbFocus], template: `<h1 tabindex="-1" [onbFocus]="titleKey" [onbStep]="step">Q</h1>` })
class Host {
  titleKey = 'onboarding.step.connect';
  step: 'connect' | '' = 'connect';
}
@Component({ template: '' }) class Blank {}

async function mount(over: Partial<Host> = {}) {
  const track = vi.fn(() => true);
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'a', component: Blank }, { path: 'b', component: Blank }]), { provide: I18nService, useClass: FakeI18n }, { provide: OnbAnalyticsService, useValue: { track } }],
  });
  await TestBed.inject(I18nService).init();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const f = TestBed.createComponent(Host);
  Object.assign(f.componentInstance, over);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  return { f, h1: (f.nativeElement as HTMLElement).querySelector('h1') as HTMLElement, track };
}

describe('onbFocus', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('moves focus to the heading on entry (next task) and scrolls to the top', async () => {
    const { h1 } = await mount();
    expect(document.activeElement).not.toBe(h1);
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('refocuses on every route change', async () => {
    const { h1 } = await mount();
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
    (document.activeElement as HTMLElement).blur();
    await TestBed.inject(Router).navigateByUrl('/a');
    await vi.waitFor(() => expect(document.activeElement).toBe(h1));
  });

  it('sets the document title and restores the previous one on destroy', async () => {
    const title = () => TestBed.inject(Title);
    TestBed.configureTestingModule({});
    const { f } = await mount();
    expect(title().getTitle()).toBe('[onboarding.title] - [onboarding.step.connect]');
    f.destroy();
    expect(title().getTitle()).not.toContain('[onboarding.title]');
  });

  it('fires step_enter once for its step; no step, no event; no title key, no title change', async () => {
    const a = await mount();
    expect(a.track).toHaveBeenCalledWith('step_enter', 'connect');
    TestBed.resetTestingModule();
    const b = await mount({ step: '', titleKey: '' });
    expect(b.track).not.toHaveBeenCalled();
    expect(TestBed.inject(Title).getTitle()).not.toContain('[onboarding');
  });

  it('adds tabindex=-1 when the heading has none', async () => {
    TestBed.configureTestingModule({});
    @Component({ imports: [OnbFocus], template: `<h1 onbFocus>Q</h1>` })
    class Bare {}
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: I18nService, useClass: FakeI18n }, { provide: OnbAnalyticsService, useValue: { track: () => true } }],
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const f = TestBed.createComponent(Bare);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    const h1 = (f.nativeElement as HTMLElement).querySelector('h1')!;
    await vi.waitFor(() => expect(h1.getAttribute('tabindex')).toBe('-1'));
    expect(document.activeElement).toBe(h1);
  });
});

describe('OnbAnnouncer', () => {
  it('writes localised text and re-announces an identical message', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: I18nService, useClass: FakeI18n }] });
    await TestBed.inject(I18nService).init();
    const a = TestBed.inject(OnbAnnouncer);
    a.say('onboarding.billing.confirmed');
    const first = a.message();
    expect(first).toContain('[onboarding.billing.confirmed]');
    a.say('onboarding.billing.confirmed');
    expect(a.message()).not.toBe(first); // the zero-width toggle makes the live region announce again
    expect(a.message()).toContain('[onboarding.billing.confirmed]');
    a.clear();
    expect(a.message()).toBe('');
  });
});
