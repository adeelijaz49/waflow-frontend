import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { FlowMessageRow, LocalizedTemplate } from '../localization.types';
import { FlowsTab } from './flows-tab';

const FLOWS: FlowMessageRow[] = [{
  flowId: 'f1', flowName: 'Win-back', triggerType: 'inactive_customer', status: 'active', promotionId: null,
  nodes: [
    {
      messageNodeId: 'n1', bodyText: 'We miss you!', buttons: [{ position: 0, label: 'Shop now' }],
      templateStatus: 'approved', localizedTemplateId: null, variantStatus: [],
    },
    {
      messageNodeId: 'n2', bodyText: 'Points reminder', buttons: [],
      templateStatus: 'pending', localizedTemplateId: 't2',
      variantStatus: [{ language: 'ar', metaStatus: 'PENDING', reviewStatus: 'draft' }],
    },
  ],
}];

const TEMPLATE = {
  id: 't2', variants: [{
    language: 'ar', header: '', body: 'نفتقدك كثيرًا', footer: '', buttons: [], bilingualOrder: null,
  }],
} as unknown as LocalizedTemplate;

function fakeApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    listFlowMessages: vi.fn(() => of({ items: FLOWS })),
    localizeFlowMessage: vi.fn(() => of({ id: 't9' })),
    getTemplate: vi.fn(() => of(TEMPLATE)),
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
  const fixture = TestBed.createComponent(FlowsTab);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, i18n };
}

const btn = (el: HTMLElement, re: RegExp) =>
  Array.from(el.querySelectorAll<HTMLElement>('button, a')).find((b) => re.test(b.textContent ?? ''))!;

describe('FlowsTab', () => {
  it('renders the matrix in English', async () => {
    const { el } = await setup(fakeApi());
    expect(el.textContent).toContain('Win-back');
    expect(el.textContent).toContain('Inactive customer');
    expect(el.textContent).toContain('We miss you!');
    expect(el.textContent).toContain('Not added');
    expect(el.textContent).not.toMatch(/(flows|common|status)\.[a-zA-Z]/);
  });

  it('renders Arabic (rtl) with no raw keys', async () => {
    const { el, i18n } = await setup(fakeApi(), 'ar');
    expect(i18n.dir()).toBe('rtl');
    expect(el.textContent).toContain('المسارات الآلية');
    expect(el.textContent).not.toMatch(/(flows|common|status)\.[a-zA-Z]/);
  });

  it('localizes then navigates to the template editor', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    btn(el, /Add Arabic version/).click();
    fixture.detectChanges();
    expect(api.localizeFlowMessage).toHaveBeenCalledWith('n1');
    expect(nav).toHaveBeenCalledWith(['/arabic/templates', 't9']);
  });

  it('shows a localised error when localizing fails', async () => {
    const api = fakeApi({ localizeFlowMessage: vi.fn(() => throwError(() => ({ status: 500 }))) });
    const { fixture, el } = await setup(api);
    btn(el, /Add Arabic version/).click();
    fixture.detectChanges();
    expect(el.querySelector('.loc-error')?.textContent).toContain('Something went wrong');
  });

  it('previews: missing Arabic hint, then loaded Arabic version, toggle to English', async () => {
    const api = fakeApi();
    const { fixture, el } = await setup(api);
    btn(el, /^\s*Preview\s*$/).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('No Arabic version yet');
    expect(api.getTemplate).not.toHaveBeenCalled();
    btn(el, /Hide preview/).click();
    fixture.detectChanges();
    const previews = Array.from(el.querySelectorAll<HTMLElement>('.fl-actions button')).filter((b) => /Preview/.test(b.textContent ?? ''));
    previews[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.getTemplate).toHaveBeenCalledWith('t2');
    expect(el.textContent).toContain('نفتقدك كثيرًا');
    btn(el, /English customer/).click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('نفتقدك كثيرًا');
    expect(el.textContent).toContain('Points reminder');
  });

  it('shows the empty state and the error state', async () => {
    const empty = await setup(fakeApi({ listFlowMessages: vi.fn(() => of({ items: [] })) }));
    expect(empty.el.querySelector('a[href="/flows"]')).toBeTruthy();
    TestBed.resetTestingModule();
    const failed = await setup(fakeApi({ listFlowMessages: vi.fn(() => throwError(() => ({ status: 0 }))) }));
    expect(failed.el.querySelector('.loc-error')).toBeTruthy();
  });
});
