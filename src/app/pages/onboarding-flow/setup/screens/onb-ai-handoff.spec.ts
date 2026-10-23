import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { I18nService } from '../../../../i18n/i18n.service';
import type { CatalogMap, TranslateParams } from '../../../../i18n/i18n.types';
import { OnbApiService } from '../../onb-api.service';
import { OnbAnnouncer } from '../../onb-focus';
import { OnbStateService } from '../../onb-state.service';
import type { OnbState } from '../../onb.types';
import { OnbAiNext, copyToClipboard } from './onb-ai-handoff';

vi.setConfig({ testTimeout: 30000 });

const catalog = (): CatalogMap =>
  new Proxy({} as CatalogMap, {
    get: (_t, k) => (typeof k === 'string' ? `[${k}]` : undefined),
    getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' ? { value: `[${k}]`, enumerable: true, configurable: true, writable: true } : undefined),
  });
// The text of a key shows its params, so the specs can assert exactly what goes into the sentence.
class FakeI18n extends I18nService {
  protected override fetchCatalog(): Promise<CatalogMap> {
    return Promise.resolve(catalog());
  }
  override t(key: string, params?: TranslateParams): string {
    return params ? `[${key} ${JSON.stringify(params)}]` : `[${key}]`;
  }
}

const setClipboard = (writeText: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
};

afterEach(() => {
  setClipboard(undefined);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('copyToClipboard (the Step 5 hand-off helper, shared)', () => {
  it('resolves true when the browser accepts the text, and passes the text through untouched', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    await expect(copyToClipboard('hello world')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('resolves false (never rejects) when the browser refuses', async () => {
    setClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });

  it('resolves false when there is no clipboard API, or no writeText', async () => {
    setClipboard(undefined);
    await expect(copyToClipboard('x')).resolves.toBe(false);
    Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });

  it('resolves false when writeText throws at once', async () => {
    setClipboard(vi.fn(() => {
      throw new Error('boom');
    }));
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });
});

describe('OnbAiNext (Ask AI Mode what to do next)', () => {
  @Component({ imports: [OnbAiNext], template: `<app-onb-ai-next [kind]="kind()" [count]="count()" />` })
  class Host {
    readonly kind = signal<'customers' | 'products'>('customers');
    readonly count = signal(5);
  }

  const unlocked = (over: Partial<OnbState> = {}): OnbState => ({ enrolled: true, view: 'setup', subscription: { state: 'active' }, locked: false, ...over });

  async function mount(state: OnbState = unlocked()): Promise<{ f: ComponentFixture<Host>; el: HTMLElement; state: OnbStateService; nav: ReturnType<typeof vi.fn> }> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Host }]),
        { provide: I18nService, useClass: FakeI18n },
        { provide: OnbApiService, useValue: { getState: () => new Subject<OnbState>() } },
      ],
    });
    await TestBed.inject(I18nService).init();
    const st = TestBed.inject(OnbStateService);
    st.state.set(state);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl') as unknown as ReturnType<typeof vi.fn>;
    const f = TestBed.createComponent(Host);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, state: st, nav };
  }
  const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const flush = async (f: ComponentFixture<unknown>): Promise<void> => {
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
  };

  it('offers ONE secondary action (a link-style button, never a primary button) while the app is unlocked', async () => {
    const { el } = await mount();
    const btn = el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!;
    expect(textOf(btn)).toBe('[onboarding.aiNext.cta]');
    expect(btn.classList.contains('onb-link')).toBe(true);
    expect(el.querySelectorAll('button')).toHaveLength(1);
    expect(el.querySelector('.onb-btn-primary')).toBeNull();
    expect(el.querySelector('[data-ai-prompt]')).toBeNull(); // nothing is shown before the click
  });

  it('is NOT offered while the app is locked (AI Mode would be veiled and inert); it appears when the app unlocks', async () => {
    const { f, el, state } = await mount(unlocked({ locked: true }));
    expect(el.querySelector('[data-ai-next]')).toBeNull();
    state.state.set(unlocked({ locked: false }));
    f.detectChanges();
    expect(el.querySelector('[data-ai-next]')).not.toBeNull();
  });

  it('click: copies ONE sentence naming what was added (the count only), says it is copied and offers the router link to AI Mode', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { f, el, nav } = await mount();
    f.componentInstance.count.set(128);
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
    await flush(f);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.customers {"n":128}]');
    expect(textOf(el.querySelector('[role="status"]')!)).toContain('[onboarding.promotion.first.aiCopied]');
    expect(el.querySelector('[data-ai-prompt]')).toBeNull();
    const link = el.querySelector<HTMLAnchorElement>('a[data-act="ai-open"]')!;
    expect(link.getAttribute('href')).toBe('/ai-mode');
    expect(textOf(link)).toBe('[onboarding.promotion.first.aiOpen]');
    expect(nav).not.toHaveBeenCalled(); // opening AI Mode is the merchant's tap on the link (a router link, never a page load)
    expect(TestBed.inject(OnbAnnouncer).message()).toContain('[onboarding.promotion.first.aiCopied]');
  });

  it('products: its own sentence with the count of items', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { f, el } = await mount();
    f.componentInstance.kind.set('products');
    f.componentInstance.count.set(3);
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
    await flush(f);
    expect(writeText).toHaveBeenCalledWith('[onboarding.aiNext.products {"n":3}]');
  });

  it('the sentence carries nothing but the count: no name, no phone, no email, whatever the screen knows', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { f, el } = await mount(unlocked({ business: { name: 'Sara Bakery', contactEmail: 'sara@example.com' }, prompts: { customers: { state: 'done' }, counts: { customers: 9 } } }));
    el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
    await flush(f);
    const sent = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(sent).toBe('[onboarding.aiNext.customers {"n":5}]');
    expect(sent).not.toMatch(/Sara|sara@|966|050/);
  });

  it('a count that is not a whole number >= 0 is cleaned (never "NaN" or a negative number in the sentence)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { f, el } = await mount();
    for (const [input, expected] of [[2.7, 2], [-4, 0], [Number.NaN, 0]] as const) {
      f.componentInstance.count.set(input);
      f.detectChanges();
      el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
      await flush(f);
      expect(String((writeText.mock.calls[writeText.mock.calls.length - 1] as unknown[])[0])).toBe(`[onboarding.aiNext.customers {"n":${expected}}]`);
    }
  });

  it('when the browser refuses the clipboard the sentence is shown for a manual copy, with the link', async () => {
    setClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    const { f, el } = await mount();
    el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
    await flush(f);
    expect(textOf(el.querySelector('[data-ai-prompt]')!)).toBe('[onboarding.aiNext.customers {"n":5}]');
    expect(el.querySelector('[data-ai-copied]')).toBeNull();
    expect(el.querySelector('a[data-act="ai-open"]')!.getAttribute('href')).toBe('/ai-mode');
  });

  it('without a clipboard API the sentence is shown as well', async () => {
    setClipboard(undefined);
    const { f, el } = await mount();
    el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!.click();
    await flush(f);
    expect(el.querySelector('[data-ai-prompt]')).not.toBeNull();
    expect(el.querySelector('a[data-act="ai-open"]')).not.toBeNull();
  });

  it('a second click copies again and starts from "not copied yet"', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { f, el } = await mount();
    const btn = el.querySelector<HTMLButtonElement>('[data-act="ai-next"]')!;
    btn.click();
    await flush(f);
    btn.click();
    await flush(f);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-ai-copied]')).not.toBeNull();
  });
});
