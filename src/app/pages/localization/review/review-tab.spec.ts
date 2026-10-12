import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { ReviewSummary } from '../localization.types';
import { ReviewTab } from './review-tab';

const SUMMARY: ReviewSummary = {
  templates: { draft: 3, reviewed: 1 },
  catalog: { draft: 4, reviewed: 2, missing: 5 },
  backendStrings: { total: 30, draft: 20, reviewed: 10, needsLegalApproval: 6 },
};

describe('ReviewTab', () => {
  let api: { getReviewSummary: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ReviewTab>;

  async function create(lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(ReviewTab);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    api = { getReviewSummary: vi.fn(() => of(SUMMARY)) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }],
    });
  });

  it('shows the totals from the API and the screen-text file', async () => {
    const el = await create('en');
    expect(api.getReviewSummary).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid=tpl-draft]')?.textContent?.trim()).toBe('3');
    expect(el.querySelector('[data-testid=cat-draft]')?.textContent?.trim()).toBe('4');
    expect(el.querySelector('[data-testid=be-draft]')?.textContent?.trim()).toBe('20');
    const scr = Number(el.querySelector('[data-testid=scr-draft]')?.textContent?.replace(/,/g, '').trim());
    expect(scr).toBeGreaterThan(0);
    const waiting = Number(el.querySelector('[data-testid=waiting]')?.textContent?.replace(/,/g, '').trim());
    expect(waiting).toBe(3 + 4 + 20 + scr);
    expect(el.querySelector('[role=progressbar]')).toBeTruthy();
  });

  it('links to the Templates and Catalog tabs', async () => {
    const el = await create('en');
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.endsWith('templates'))).toBe(true);
    expect(hrefs.some((h) => h.endsWith('catalog'))).toBe(true);
  });

  it('keeps the commands left-to-right inside an RTL page', async () => {
    const el = await create('ar');
    expect(TestBed.inject(I18nService).dir()).toBe('rtl');
    const cmds = Array.from(el.querySelectorAll('.rv-cmd code'));
    expect(cmds.length).toBe(4);
    for (const c of cmds) expect(c.getAttribute('dir')).toBe('ltr');
    expect(cmds[0].textContent).toContain('i18n-review.mjs export');
    expect(el.textContent).toContain('بانتظار متحدث أصلي للعربية');
  });

  it('keeps the developer commands in a collapsed "for your technical contact" section', async () => {
    const el = await create('en');
    const tech = el.querySelector<HTMLDetailsElement>('details.rv-tech')!;
    expect(tech).toBeTruthy();
    expect(tech.open).toBe(false);
    expect(tech.querySelector('summary')?.textContent).toContain('For your technical contact');
    expect(tech.querySelectorAll('.rv-cmd code').length).toBe(4);
    // nothing outside the collapsed section shows a shell command
    expect(Array.from(el.querySelectorAll('.rv-cmd code')).every((c) => tech.contains(c))).toBe(true);
    const steps = Array.from(el.querySelectorAll('section')).map((s) => s.textContent ?? '').join(' ');
    expect(steps).not.toContain('node scripts');
    expect(steps).not.toContain('--dry-run');
  });

  it('copies a command to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = await create('en');
    el.querySelector<HTMLButtonElement>('.rv-cmd button')!.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('node scripts/i18n-review.mjs export --out review.csv');
  });

  it('shows a localised error and retries', async () => {
    api.getReviewSummary.mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const el = await create('ar');
    const err = el.querySelector('.loc-error');
    expect(err).toBeTruthy();
    expect(err?.textContent).not.toMatch(/[A-Za-z]{6,} [A-Za-z]{3,}/);
    err!.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.getReviewSummary).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.loc-error')).toBeNull();
  });
});
