import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { CampaignStatus, LocalizedCampaignView } from '../localization.types';
import { CampaignsTab } from './campaigns-tab';

function campaign(id: string, status: CampaignStatus, sent: number, name = 'عرض الجمعة'): LocalizedCampaignView {
  return {
    id, name, templateId: 't1', templateName: 'Win-back', languageMode: 'per_customer', audience: { kind: 'all_eligible' },
    fieldValues: {}, status, plan: null, stats: { total: 10, sent, failed: 0, skipped: 0, byLanguage: { en: 4, ar: 6, bilingual: 0 } },
    startedAt: '2026-10-10T10:00:00Z', finishedAt: status === 'sent' ? '2026-10-10T10:05:00Z' : null, lastError: null,
    createdAt: '2026-10-10T09:00:00Z', updatedAt: '2026-10-10T10:00:00Z',
  };
}

describe('CampaignsTab', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let i18n: I18nService;
  let fixture: ComponentFixture<CampaignsTab>;
  let el: HTMLElement;

  const tick = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    fixture.detectChanges();
  };

  async function create(lang: 'en' | 'ar' = 'en'): Promise<void> {
    i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    vi.useFakeTimers();
    fixture = TestBed.createComponent(CampaignsTab);
    fixture.detectChanges();
    await tick();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    api = {
      listCampaigns: vi.fn(() => of({ items: [campaign('a', 'sent', 10), campaign('b', 'draft', 0, 'Spring promo')], total: 2, page: 1, limit: 20 })),
      getSettings: vi.fn(() => of({ arabicEnabled: true, arabicEnabledAt: null, defaultCustomerLanguage: 'ar', bilingualOrder: 'ar_first' })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LocalizationApiService, useValue: api }, provideRouter([])] });
  });

  afterEach(() => vi.useRealTimers());

  it('renders the campaigns in English with links to the detail page and the New campaign button', async () => {
    await create('en');
    expect(i18n.dir()).toBe('ltr');
    expect(el.textContent).toContain('Campaigns');
    expect(el.textContent).toContain('New campaign');
    expect(el.textContent).toContain('Spring promo');
    expect(el.textContent).toContain('10 / 10');
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
    expect(el.querySelector('a.ct-name')?.getAttribute('href')).toBe('/arabic/campaigns/a');
    expect(el.querySelector('a.btn-primary')?.getAttribute('href')).toBe('/arabic/campaigns/new');
    expect(el.querySelector('a.ct-name')?.getAttribute('dir')).toBe('auto');
    expect(api['listCampaigns']).toHaveBeenCalledWith({ status: undefined, page: 1, limit: 20 });
  });

  it('renders in Arabic (rtl)', async () => {
    await create('ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('الحملات');
    expect(el.textContent).toContain('حملة جديدة');
    expect(el.textContent).toContain('تم الإرسال');
    expect(el.textContent).not.toMatch(/campaigns\.[a-z]|status\.[a-z]/);
  });

  it('filters by status through the API', async () => {
    await create();
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.ct-chip'));
    chips[1].click(); // draft
    await tick();
    expect(api['listCampaigns']).toHaveBeenLastCalledWith({ status: 'draft', page: 1, limit: 20 });
    expect(el.querySelectorAll<HTMLButtonElement>('.ct-chip')[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('auto-refreshes every 5 seconds while a campaign is sending, then stops', async () => {
    const seq = [
      [campaign('a', 'sending', 2)], [campaign('a', 'sending', 6)], [campaign('a', 'sent', 10)],
    ];
    let i = 0;
    api['listCampaigns'].mockImplementation(() => of({ items: seq[Math.min(i++, seq.length - 1)], total: 1, page: 1, limit: 20 }));
    await create();
    expect(api['listCampaigns']).toHaveBeenCalledTimes(1);
    await tick(4900);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(1);
    await tick(200);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('6 / 10');
    await tick(5000);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(3);
    expect(el.textContent).toContain('10 / 10');
    await tick(20000);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(3);
  });

  it('does not auto-refresh when nothing is sending, and stops on destroy', async () => {
    await create();
    await tick(30000);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(1);

    api['listCampaigns'].mockReturnValue(of({ items: [campaign('a', 'sending', 1)], total: 1, page: 1, limit: 20 }));
    fixture.destroy();
    fixture = TestBed.createComponent(CampaignsTab);
    fixture.detectChanges();
    await tick();
    api['listCampaigns'].mockClear();
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api['listCampaigns']).not.toHaveBeenCalled();
  });

  it('a refresh still in flight when the tab is left does not re-arm the timer', async () => {
    const inFlight = new Subject<{ items: LocalizedCampaignView[]; total: number; page: number; limit: number }>();
    let n = 0;
    api['listCampaigns'].mockImplementation(() => (n++ === 1 ? inFlight : of({ items: [campaign('a', 'sending', 2)], total: 1, page: 1, limit: 20 })));
    await create();
    await tick(5100); // the second request is now pending
    expect(api['listCampaigns']).toHaveBeenCalledTimes(2);
    fixture.destroy();
    inFlight.next({ items: [campaign('a', 'sending', 3)], total: 1, page: 1, limit: 20 });
    inFlight.complete();
    await vi.advanceTimersByTimeAsync(30000);
    expect(api['listCampaigns']).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state and a localised error with retry', async () => {
    api['listCampaigns'].mockReturnValue(of({ items: [], total: 0, page: 1, limit: 20 }));
    await create();
    expect(el.textContent).toContain('No campaigns yet.');
    api['listCampaigns'].mockReturnValue(throwError(() => ({ status: 0 })));
    (el.querySelector('.ct-chip:nth-child(2)') as HTMLButtonElement).click();
    await tick();
    expect(el.querySelector('.loc-error')?.textContent).toContain('We couldn\'t reach the server');
    api['listCampaigns'].mockReturnValue(of({ items: [campaign('a', 'sent', 10)], total: 1, page: 1, limit: 20 }));
    (el.querySelector('.loc-error .btn') as HTMLButtonElement).click();
    await tick();
    expect(el.querySelector('.loc-error')).toBeNull();
    expect(el.textContent).toContain('عرض الجمعة');
  });
});
