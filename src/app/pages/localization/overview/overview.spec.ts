import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { HubStateService } from '../hub/hub-state.service';
import { LocalizationSettings, MyLanguagePrefs, OverviewSummary } from '../localization.types';
import { Overview } from './overview';

const SETTINGS: LocalizationSettings = {
  arabicEnabled: true,
  arabicEnabledAt: '2026-09-01T10:00:00.000Z',
  defaultCustomerLanguage: 'en',
  bilingualOrder: 'ar_first',
};
const OVERVIEW: OverviewSummary = {
  customers: { total: 12, en: 5, ar: 4, unknown: 3 },
  templates: { total: 8, withArabic: 3, arabicApproved: 1, arabicPending: 1, arabicRejected: 0, arabicNotSubmitted: 1, arabicOther: 0 },
  campaigns: { total: 0, lastSentAt: null },
  review: { templatesDraft: 2, catalogDraft: 0, backendStringsDraft: 0 },
};
const PREFS: MyLanguagePrefs = { uiLanguage: 'en', aiLanguage: 'auto' };

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    getOverview: vi.fn(() => of(OVERVIEW)),
    getMyPrefs: vi.fn(() => of(PREFS)),
    updateSettings: vi.fn((p: object) => of({ ...SETTINGS, ...p })),
    updateMyPrefs: vi.fn((p: object) => of({ ...PREFS, ...p })),
    ...over,
  };
}

async function setup(api: ReturnType<typeof fakeApi>, lang: 'en' | 'ar' = 'en') {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.use(lang, false);
  TestBed.inject(HubStateService).settings.set(SETTINGS);
  const fixture = TestBed.createComponent(Overview);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, i18n };
}

function pick(el: HTMLElement, id: string, value: string): void {
  const select = el.querySelector<HTMLSelectElement>('#' + id)!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('Overview (localisation landing tab)', () => {
  it('renders English with real strings and the counts', async () => {
    const { el } = await setup(fakeApi());
    expect(el.textContent).toContain('Arabic is on for your workspace');
    expect(el.textContent).toContain('3 customers have no language yet');
    expect(el.textContent).not.toMatch(/settings\.[a-z]/);
  });

  it('renders Arabic with draft strings and no raw keys', async () => {
    const { el, i18n } = await setup(fakeApi(), 'ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('إعدادات اللغة');
    expect(el.textContent).toMatch(/3\W+ عملاء بلا لغة بعد/u);
    expect(el.textContent).not.toMatch(/(settings|common|status)\.[a-zA-Z]/);
  });

  it('saves the workspace settings with the right payload and updates the hub', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    const save = () => el.querySelector<HTMLButtonElement>('.ov-actions button')!;
    expect(save().disabled).toBe(true);
    pick(el, 'ov-default', 'ar');
    pick(el, 'ov-order', 'en_first');
    fixture.detectChanges();
    expect(save().disabled).toBe(false);
    save().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.updateSettings).toHaveBeenCalledWith({ defaultCustomerLanguage: 'ar', bilingualOrder: 'en_first' });
    expect(TestBed.inject(HubStateService).settings()?.defaultCustomerLanguage).toBe('ar');
  });

  it('shows a localised error when saving fails', async () => {
    const api = fakeApi({ updateSettings: vi.fn(() => throwError(() => ({ status: 0 }))) });
    const { fixture, el, i18n } = await setup(api);
    pick(el, 'ov-default', 'ar');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.ov-actions button')!.click();
    fixture.detectChanges();
    const err = el.querySelector('.loc-error')!;
    expect(err.textContent).toContain(i18n.t('errors.network'));
  });

  it('switching my screen language flips the page and saves it', async () => {
    const api = fakeApi();
    const { fixture, el, i18n } = await setup(api);
    pick(el, 'ov-screen', 'ar');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('ar');
    expect(api.updateMyPrefs).toHaveBeenCalledWith({ uiLanguage: 'ar' });
    i18n.use('en', false);
  });

  it('saves the AI reply language', async () => {
    const api = fakeApi();
    const { el } = await setup(api);
    pick(el, 'ov-ai', 'ar');
    expect(api.updateMyPrefs).toHaveBeenCalledWith({ aiLanguage: 'ar' });
  });

  it('shows a retry when the overview fails to load', async () => {
    let fail = true;
    const api = fakeApi({
      getOverview: vi.fn((): Observable<OverviewSummary> => (fail ? throwError(() => ({ status: 0 })) : of(OVERVIEW))),
    });
    const { fixture, el } = await setup(api);
    expect(el.querySelector('.loc-error')).toBeTruthy();
    fail = false;
    el.querySelector<HTMLButtonElement>('.loc-error button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.ov-tiles')).toBeTruthy();
  });

  it('derives the checklist from the overview numbers', async () => {
    const { el } = await setup(fakeApi());
    const done = Array.from(el.querySelectorAll('.ov-step')).map((li) => li.classList.contains('ov-step-done'));
    // default still English + not saved; ar customers; arabic templates; submitted; drafts remain; no campaigns
    expect(done).toEqual([false, true, true, true, false, false]);
  });
});
