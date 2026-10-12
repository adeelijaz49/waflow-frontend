import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import type { LibraryEntry, LocalizedTemplate, MessageLanguage, TemplateVariant, TemplatesUsage } from '../localization.types';
import { TemplatesTab } from './templates-tab';

function variant(language: MessageLanguage, over: Partial<TemplateVariant> = {}): TemplateVariant {
  return {
    language, bilingualOrder: null, header: '', body: 'Hi {name}, we miss you', footer: '', buttons: [{ role: 'opt_out', text: 'Opt Out' }],
    metaTemplateName: null, metaStatus: 'NOT_CREATED', metaRejectedReason: null, metaCategory: null, metaPreviousCategory: null,
    metaFlagged: false, metaStatusRaw: null, metaLastCheckedAt: null, submittedAt: null, submissionCount: 0, lastError: null,
    reviewStatus: 'draft', reviewedBy: null, reviewedAt: null, source: 'merchant',
    validation: { ok: true, errors: [], warnings: [], positionalText: '', params: [] },
    sendable: false, notSendableReason: 'not_submitted', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
  };
}

function template(id: string, name: string, variants: TemplateVariant[], over: Partial<LocalizedTemplate> = {}): LocalizedTemplate {
  return {
    id, key: id, name, useCase: 'comeback', category: 'MARKETING', archived: false, linkedMessageNodeId: null, variants,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', ...over,
  };
}

const LIBRARY: LibraryEntry[] = [
  {
    key: 'comeback', useCase: 'comeback', category: 'MARKETING', name: { en: 'We miss you', ar: 'اشتقنا لك' }, fields: ['name'],
    variants: {
      en: { body: 'Hi {name}, we miss you!', buttons: [{ role: 'opt_out', text: 'Opt Out' }] },
      ar: { body: 'أهلاً {name}، اشتقنا لك!', buttons: [{ role: 'opt_out', text: 'إلغاء الاشتراك' }] },
    },
  },
  {
    key: 'welcome_optin', useCase: 'welcome_optin', category: 'MARKETING', name: { en: 'Welcome', ar: 'ترحيب' }, fields: [],
    variants: { en: { body: 'Welcome to {business}' }, ar: { body: 'أهلاً بك في {business}' } },
  },
];

const USAGE: TemplatesUsage = { used: 12, limit: 250, ceiling: 90, atCeiling: false };

describe('TemplatesTab', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<TemplatesTab>;
  let items: LocalizedTemplate[];
  let navigate: ReturnType<typeof vi.spyOn>;

  async function create(lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    if (lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(TemplatesTab);
    fixture.detectChanges();
    await settle();
    return fixture.nativeElement as HTMLElement;
  }
  async function settle(ms = 20): Promise<void> {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, ms));
    fixture.detectChanges();
  }
  const buttonByText = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

  beforeEach(() => {
    localStorage.clear();
    items = [
      template('t1', 'Win back', [variant('en', { metaStatus: 'APPROVED' }), variant('ar', { metaStatus: 'PENDING' })]),
      template('t2', 'Payment reminder', [variant('en')], { useCase: 'payment_reminder', category: 'UTILITY' }),
    ];
    api = {
      listTemplates: vi.fn(() => of({ items })),
      getTemplatesUsage: vi.fn(() => of(USAGE)),
      getTemplateLibrary: vi.fn(() => of({ items: LIBRARY })),
      createTemplateFromLibrary: vi.fn(() => of(template('n1', 'We miss you', [variant('en'), variant('ar')]))),
      createTemplate: vi.fn(() => of(template('n2', 'Blank', []))),
      archiveTemplate: vi.fn((id: string, archived: boolean) => of({ ...items.find((t) => t.id === id)!, archived })),
      refreshTemplateStatuses: vi.fn(() => of({ checked: 5, changed: 2 })),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it('renders the language matrix with one approval badge per version and the add-Arabic shortcut', async () => {
    const el = await create('en');
    const rows = el.querySelectorAll('.tl-item');
    expect(rows.length).toBe(2);
    const first = rows[0].textContent ?? '';
    expect(first).toContain('Win back');
    expect(first).toContain('Approved');
    expect(first).toContain('Pending');
    expect(rows[0].textContent).not.toContain('Add Arabic version');
    expect(rows[1].textContent).toContain('Add Arabic version');
    expect(rows[1].textContent).toContain('Not added');
    expect(rows[1].querySelectorAll('.tl-add').length).toBe(2); // Arabic + bilingual both offer an add button
  });

  it('shows the WhatsApp template slot meter and explains slots once', async () => {
    const el = await create('en');
    expect(el.textContent).toContain('12 of 250 WhatsApp template slots used');
    expect(el.textContent).toContain('pause at 90');
    expect(el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('12');
    expect(el.textContent).toContain("Slots can't be reclaimed");
  });

  it('warns when the template ceiling is reached', async () => {
    api['getTemplatesUsage'].mockReturnValue(of({ used: 90, limit: 250, ceiling: 90, atCeiling: true }));
    const el = await create('en');
    expect(el.querySelector('.tl-usage-warn')?.textContent).toContain('submitting for approval is paused');
  });

  it('renders in Arabic with Arabic labels and no raw keys', async () => {
    const el = await create('ar');
    expect(TestBed.inject(I18nService).dir()).toBe('rtl');
    expect(el.textContent).toContain('قوالب الرسائل');
    expect(el.textContent).toContain('إضافة نسخة عربية');
    expect(el.textContent).not.toMatch(/templates\.[a-z]/);
  });

  it('creates a template from the library, previewing both languages, and opens the editor', async () => {
    const el = await create('en');
    buttonByText(el, 'From library')!.click();
    await settle();
    expect(api['getTemplateLibrary']).toHaveBeenCalledTimes(1);
    const frames = el.querySelectorAll('.lp-previews .wap-frame');
    expect(frames.length).toBe(2);
    expect(frames[0].getAttribute('dir')).toBe('ltr');
    expect(frames[1].getAttribute('dir')).toBe('rtl');
    expect(el.textContent).toContain('needs a native reader');
    buttonByText(el, 'Use this template')!.click();
    await settle();
    expect(api['createTemplateFromLibrary']).toHaveBeenCalledWith('comeback');
    expect(navigate).toHaveBeenCalledWith(['/arabic/templates', 'n1'], {});
  });

  it('lets the merchant pick another library message', async () => {
    const el = await create('en');
    buttonByText(el, 'From library')!.click();
    await settle();
    const items2 = Array.from(el.querySelectorAll<HTMLButtonElement>('.lp-item'));
    expect(items2.length).toBe(2);
    items2[1].click();
    await settle();
    buttonByText(el, 'Use this template')!.click();
    await settle();
    expect(api['createTemplateFromLibrary']).toHaveBeenCalledWith('welcome_optin');
  });

  it('archives only after confirmation', async () => {
    const el = await create('en');
    const ui = TestBed.inject(LocUiService);
    const archive = buttonByText(el.querySelectorAll<HTMLElement>('.tl-item')[0], 'Archive')!;
    archive.click();
    await settle();
    expect(ui.confirmState()).not.toBeNull();
    expect(api['archiveTemplate']).not.toHaveBeenCalled();
    ui.respond(false);
    await settle();
    expect(api['archiveTemplate']).not.toHaveBeenCalled();
    archive.click();
    await settle();
    ui.respond(true);
    await settle();
    expect(api['archiveTemplate']).toHaveBeenCalledWith('t1', true);
    expect(el.querySelectorAll('.tl-item').length).toBe(1);
  });

  it('refreshes statuses and reports what changed', async () => {
    const el = await create('en');
    buttonByText(el, 'Refresh statuses')!.click();
    await settle();
    expect(api['refreshTemplateStatuses']).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(LocUiService).toasts()[0].message).toBe('Statuses refreshed. Checked: 5, changed: 2.');
  });

  it('shows an empty state with a call to action when there are no templates', async () => {
    items = [];
    const el = await create('en');
    expect(el.textContent).toContain('No templates yet');
    expect(buttonByText(el, 'Browse the library')).toBeTruthy();
  });

  it('creates a blank template and opens the editor', async () => {
    const el = await create('en');
    buttonByText(el, 'New template')!.click();
    await settle();
    const name = el.querySelector<HTMLInputElement>('#tl-new-name')!;
    name.value = 'Blank';
    name.dispatchEvent(new Event('input'));
    buttonByText(el.querySelector<HTMLElement>('.modal')!, 'Create template')!.click();
    await settle();
    expect(api['createTemplate']).toHaveBeenCalledWith({ name: 'Blank', useCase: 'custom', category: 'MARKETING' });
    expect(navigate).toHaveBeenCalled();
  });

  describe('new template: the category follows the use case (only transactional use cases may be Utility)', () => {
    let el: HTMLElement;
    const useCase = (): HTMLSelectElement => el.querySelector<HTMLSelectElement>('#tl-new-usecase')!;
    const category = (): HTMLSelectElement => el.querySelector<HTMLSelectElement>('#tl-new-category')!;
    const categoryOptions = (): string[] => Array.from(category().options).map((o) => o.value);
    const hint = (): string => el.querySelector('#tl-new-category-hint')!.textContent ?? '';
    async function pick(select: HTMLSelectElement, value: string): Promise<void> {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
    }
    async function createNamed(name: string): Promise<void> {
      const input = el.querySelector<HTMLInputElement>('#tl-new-name')!;
      input.value = name;
      input.dispatchEvent(new Event('input'));
      buttonByText(el.querySelector<HTMLElement>('.modal')!, 'Create template')!.click();
      await settle();
    }
    async function openForm(lang: 'en' | 'ar' = 'en'): Promise<void> {
      el = await create(lang);
      el.querySelector<HTMLButtonElement>('.page-header .btn-primary')!.click();
      await settle();
    }

    it('shows Marketing, disabled, with a helper line for a non-transactional use case', async () => {
      await openForm();
      expect(useCase().value).toBe('custom');
      expect(category().disabled).toBe(true);
      expect(category().value).toBe('MARKETING');
      expect(categoryOptions()).toEqual(['MARKETING']);
      expect(category().getAttribute('aria-describedby')).toBe('tl-new-category-hint');
      expect(hint()).toContain('Marketing and promotional messages are always sent as Marketing, which means only to customers who opted in.');
    });

    it('shows the helper line in Arabic', async () => {
      await openForm('ar');
      expect(category().disabled).toBe(true);
      expect(hint()).toContain('الرسائل التسويقية والترويجية تُرسل دائماً كرسائل تسويقية');
      expect(el.textContent).not.toMatch(/templates\.[a-z]/);
    });

    it('offers Utility for a transactional use case and creates it with that category', async () => {
      await openForm();
      await pick(useCase(), 'payment_reminder');
      expect(category().disabled).toBe(false);
      expect(categoryOptions()).toEqual(['MARKETING', 'UTILITY']);
      expect(hint()).toContain('Promotions and offers.');
      await pick(category(), 'UTILITY');
      expect(category().value).toBe('UTILITY');
      expect(hint()).toContain('Order, payment and booking updates.');
      await createNamed('Pay soon');
      expect(api['createTemplate']).toHaveBeenCalledWith({ name: 'Pay soon', useCase: 'payment_reminder', category: 'UTILITY' });
    });

    it('moving back to a non-transactional use case resets the category to Marketing in the form state', async () => {
      await openForm();
      await pick(useCase(), 'booking_confirmation');
      await pick(category(), 'UTILITY');
      expect(category().value).toBe('UTILITY');
      await pick(useCase(), 'promotion');
      expect(category().value).toBe('MARKETING');
      expect(category().disabled).toBe(true);
      expect(categoryOptions()).toEqual(['MARKETING']);
      expect(hint()).toContain('always sent as Marketing');
      await createNamed('Big sale');
      expect(api['createTemplate']).toHaveBeenCalledWith({ name: 'Big sale', useCase: 'promotion', category: 'MARKETING' });
    });
  });

  it('shows a localised, retryable error when loading fails', async () => {
    api['listTemplates'].mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const el = await create('ar');
    const err = el.querySelector('.loc-error');
    expect(err?.textContent).toContain('تعذّر الاتصال بالخادم');
    err!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(api['listTemplates']).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.tl-item')).toBeTruthy();
  });
});
