import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService, Lang } from '../../../i18n';
import { ApprovalBadge } from './approval-badge';
import { errorText } from './loc-errors';
import { WaPreview } from './wa-preview';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

// The optional language overrides added so the EXISTING (English) screens can reuse the hub's small components
// without Arabic labels leaking in when the owner's stored UI language is Arabic.

@Component({
  imports: [ApprovalBadge, WaPreview],
  template: `
    <app-approval-badge status="APPROVED" review="reviewed" [uiLang]="lang()" />
    <app-wa-preview language="en" [uiLang]="lang()" />
  `,
})
class Host {
  lang = signal<Lang | undefined>(undefined);
}

async function boot(active: Lang) {
  localStorage.clear();
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  await i18n.use('ar', false);
  await i18n.use(active, false);
  return i18n;
}

describe('uiLang overrides', () => {
  it('ApprovalBadge and WaPreview follow the active UI language by default (hub unchanged)', async () => {
    await boot('ar');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const t = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('معتمد');
    expect(t).toContain('تمت المراجعة');
  });

  it('ApprovalBadge and WaPreview render the forced language when asked, whatever the UI language', async () => {
    await boot('ar');
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.lang.set('en');
    fixture.detectChanges();
    const t = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(t).toContain('Approved');
    expect(t).toContain('Reviewed');
    expect(t).not.toMatch(/\p{Script=Arabic}/u);
    expect(t).toContain('Nothing to preview yet.'); // the empty-preview label, in English
  });

  it('errorText keeps today\'s behaviour by default and honours a forced language', async () => {
    const i18n = await boot('ar');
    const err = { status: 404 };
    expect(errorText(i18n, err)).toBe(i18n.t('errors.notFound'));
    expect(errorText(i18n, err, undefined, 'en')).toBe(i18n.t('errors.notFound', undefined, 'en'));
    expect(errorText(i18n, err, undefined, 'en')).not.toBe(errorText(i18n, err));
    const coded = { status: 402, error: { code: 'ARABIC_NOT_ENABLED' } };
    expect(errorText(i18n, coded, undefined, 'en')).toBe(i18n.t('errors.ARABIC_NOT_ENABLED', undefined, 'en'));
  });
});
