import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import { LocUiService } from '../shared/loc-ui.service';
import type {
  LocalizedTemplate, MessageLanguage, TemplateVariant, TemplatesUsage, VariantValidation,
} from '../localization.types';
import { TemplateEditor } from './template-editor';

const OK: VariantValidation = { ok: true, errors: [], warnings: [], positionalText: '', params: [] };

function variant(language: MessageLanguage, over: Partial<TemplateVariant> = {}): TemplateVariant {
  return {
    language, bilingualOrder: null, header: '', body: 'Hi {name}, we miss you', footer: '', buttons: [{ role: 'opt_out', text: 'Opt Out' }],
    metaTemplateName: null, metaStatus: 'NOT_CREATED', metaRejectedReason: null, metaCategory: null, metaPreviousCategory: null,
    metaFlagged: false, metaStatusRaw: null, metaLastCheckedAt: null, submittedAt: null, submissionCount: 0, lastError: null,
    reviewStatus: 'draft', reviewedBy: null, reviewedAt: null, source: 'merchant', validation: OK,
    sendable: false, notSendableReason: 'not_submitted', updatedAt: '2026-10-01T10:00:00.000Z', ...over,
  };
}

function template(variants: TemplateVariant[], over: Partial<LocalizedTemplate> = {}): LocalizedTemplate {
  return {
    id: 't1', key: 'win_back', name: 'Win back', useCase: 'comeback', category: 'MARKETING', archived: false, linkedMessageNodeId: null,
    variants, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', ...over,
  };
}

const AR_BODY = 'أهلاً {name}، اشتقنا لك';
const USAGE: TemplatesUsage = { used: 12, limit: 250, ceiling: 90, atCeiling: false };
// The server only keeps UTILITY for the transactional use cases; every other use case is stored (and returned) as MARKETING.
const TRANSACTIONAL = ['payment_reminder', 'booking_confirmation', 'booking_reminder', 'order_confirmation'];
const floored = (t: LocalizedTemplate): LocalizedTemplate => ({ ...t, category: TRANSACTIONAL.includes(t.useCase) ? t.category : 'MARKETING' });

describe('TemplateEditor', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<TemplateEditor>;
  let current: LocalizedTemplate;
  let ui: LocUiService;

  async function create(opts: { lang?: 'en' | 'ar'; tab?: MessageLanguage } = {}): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocalizationApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 't1' })),
            snapshot: { queryParamMap: convertToParamMap(opts.tab ? { lang: opts.tab } : {}) },
          },
        },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    ui = TestBed.inject(LocUiService);
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    await i18n.ensureLoaded('ar');
    if (opts.lang === 'ar') await i18n.use('ar', false);
    fixture = TestBed.createComponent(TemplateEditor);
    fixture.detectChanges();
    await settle();
    return fixture.nativeElement as HTMLElement;
  }
  async function settle(ms = 30): Promise<void> {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, ms));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  const q = <T extends HTMLElement>(sel: string): T => fixture.nativeElement.querySelector(sel) as T;
  const btn = (text: string, scope: ParentNode = fixture.nativeElement): HTMLButtonElement | undefined =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === text);
  async function typeInto(sel: string, value: string): Promise<void> {
    const el = q<HTMLInputElement | HTMLTextAreaElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle();
  }

  beforeEach(() => {
    localStorage.clear();
    current = template([variant('en')]);
    api = {
      getTemplate: vi.fn(() => of(current)),
      getTemplatesUsage: vi.fn(() => of(USAGE)),
      validateVariant: vi.fn(() => of(OK)),
      previewVariant: vi.fn((b: { variant: { body: string; language: MessageLanguage; header?: string; footer?: string; buttons?: [] } }) =>
        of({ language: b.variant.language, header: b.variant.header ?? '', body: b.variant.body.replace('{name}', 'Sara'), footer: '', buttons: [], usedValues: {}, missingFields: [] })),
      saveVariant: vi.fn(() => of(current)),
      submitVariant: vi.fn(() => of({ template: current, submission: { metaTemplateName: 'x', metaStatus: 'PENDING', dryRun: false } })),
      reviewVariant: vi.fn(() => of(current)),
      testSendVariant: vi.fn(() => of({ sent: true, dryRun: false })),
      refreshTemplateStatuses: vi.fn(() => of({ checked: 1, changed: 0 })),
      updateTemplate: vi.fn(() => of(current)),
      archiveTemplate: vi.fn(() => of({ ...current, archived: true })),
      aiTranslate: vi.fn(() => of({ text: 'أهلاً {name}', draft: true, from: 'en', to: 'ar', warnings: [], protectedTokens: { count: 1, verified: true } })),
      aiSaudiFriendly: vi.fn(),
    };
  });

  it('loads the template, selects the English tab and shows the missing Arabic version', async () => {
    const el = await create();
    expect(api['getTemplate']).toHaveBeenCalledWith('t1');
    const tabs = el.querySelectorAll<HTMLElement>('[role=tab]');
    expect(tabs.length).toBe(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toContain('Not added');
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('Hi {name}, we miss you');
    expect(q<HTMLInputElement>('#te-name').value).toBe('Win back');
  });

  it('language tabs follow the roving-tabindex keyboard pattern (arrows, Home, End; mirrored in Arabic)', async () => {
    const el = await create();
    const tabs = () => Array.from(el.querySelectorAll<HTMLElement>('[role=tab]'));
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const press = async (key: string): Promise<void> => {
      tabs()[tabs().findIndex((t) => t.getAttribute('tabindex') === '0')].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle();
    };
    await press('ArrowRight');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);
    await press('End');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    await press('ArrowRight'); // wraps to the first tab
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('renders the Arabic page in Arabic with an RTL phone for the Arabic version', async () => {
    current = template([variant('en'), variant('ar', { body: AR_BODY, buttons: [{ role: 'opt_out', text: 'إلغاء الاشتراك' }] })]);
    const el = await create({ lang: 'ar', tab: 'ar' });
    expect(TestBed.inject(I18nService).dir()).toBe('rtl');
    expect(el.textContent).toContain('حفظ التغييرات');
    expect(el.textContent).not.toMatch(/templates\.[a-z]/);
    expect(q('.ve-side .wap-frame').getAttribute('dir')).toBe('rtl');
    expect(q<HTMLTextAreaElement>('#ve-body').getAttribute('dir')).toBe('auto');
    expect(q<HTMLTextAreaElement>('#ve-body').getAttribute('lang')).toBe('ar');
  });

  it('saves an edited version with the right payload', async () => {
    const el = await create();
    const save = btn('Save changes')!;
    expect(save.disabled).toBe(true);
    await typeInto('#ve-body', 'Hello {name}, come back soon');
    expect(el.textContent).toContain('Unsaved changes');
    expect(btn('Save changes')!.disabled).toBe(false);
    current = template([variant('en', { body: 'Hello {name}, come back soon' })]);
    btn('Save changes')!.click();
    await settle();
    expect(api['saveVariant']).toHaveBeenCalledWith('t1', 'en', {
      header: '', body: 'Hello {name}, come back soon', footer: '', buttons: [{ role: 'opt_out', text: 'Opt Out' }], source: 'merchant',
    });
    expect(el.textContent).toContain('All changes saved');
    expect(btn('Save changes')!.disabled).toBe(true);
  });

  it('shows a localised error when saving fails and keeps the edits', async () => {
    const el = await create({ lang: 'ar' });
    await typeInto('#ve-body', 'Hello again');
    api['saveVariant'].mockReturnValueOnce(throwError(() => ({ status: 0 })));
    btn('حفظ التغييرات')!.click();
    await settle();
    expect(el.querySelector('.ve-edit .loc-error')?.textContent).toContain('تعذّر الاتصال بالخادم');
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('Hello again');
  });

  it('lists live validation issues in plain localised language, errors before warnings', async () => {
    api['validateVariant'].mockReturnValue(of({
      ok: false,
      errors: [{ code: 'body_starts_with_variable', field: 'body' }],
      warnings: [{ code: 'body_too_long', field: 'body', detail: { length: 1100, max: 1024 } }],
      positionalText: '', params: ['name'],
    } satisfies VariantValidation));
    const el = await create();
    await typeInto('#ve-body', '{name} we miss you');
    await settle(650);
    const errors = el.querySelector('.ve-checks .loc-error')!;
    expect(errors.textContent).toContain("can't start with a merge field");
    expect(errors.textContent).toContain('Add a few words before the field');
    expect(el.querySelector('.ve-checks .loc-warn')?.textContent).toContain('1100 of 1024');
    expect(api['validateVariant']).toHaveBeenCalledWith('t1', 'en', expect.objectContaining({ body: '{name} we miss you' }));
  });

  it('shows the validation messages in Arabic', async () => {
    api['validateVariant'].mockReturnValue(of({ ok: false, errors: [{ code: 'body_ends_with_variable' }], warnings: [], positionalText: '', params: [] }));
    const el = await create({ lang: 'ar' });
    await typeInto('#ve-body', 'مرحباً {name}');
    await settle(650);
    expect(el.querySelector('.ve-checks .loc-error')?.textContent).toContain('لا يمكن أن تنتهي الرسالة بحقل دمج');
  });

  it('treats a leading or trailing merge field as blocking even when the server only warns', async () => {
    current = template([variant('en', { metaStatus: 'NOT_CREATED', validation: { ...OK, warnings: [{ code: 'body_starts_with_variable', field: 'body' }] } })]);
    const el = await create();
    expect(el.querySelector('.ve-checks .loc-error')?.textContent).toContain("can't start with a merge field");
    expect(btn('Submit for approval')!.disabled).toBe(true);
    expect(el.textContent).toContain('Fix the problems listed in the checks first.');
  });

  it('keeps Submit off until the version is saved and valid, and only calls the API after confirmation', async () => {
    const el = await create();
    expect(btn('Submit for approval')!.disabled).toBe(false);
    await typeInto('#ve-body', 'Something new {name} here');
    expect(btn('Submit for approval')!.disabled).toBe(true);
    expect(el.textContent).toContain('Save your changes before submitting.');
    current = template([variant('en', { body: 'Something new {name} here' })]);
    btn('Save changes')!.click();
    await settle();
    const submit = btn('Submit for approval')!;
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();
    expect(ui.confirmState()?.message).toContain('English');
    expect(api['submitVariant']).not.toHaveBeenCalled();
    ui.respond(false);
    await settle();
    expect(api['submitVariant']).not.toHaveBeenCalled();
    submit.click();
    await settle();
    ui.respond(true);
    await settle();
    expect(api['submitVariant']).toHaveBeenCalledWith('t1', 'en');
    expect(ui.toasts().map((t) => t.message)).toContain('Submitted. WhatsApp is reviewing it.');
  });

  it('shows the dry-run notice when the backend did not really submit', async () => {
    api['submitVariant'].mockReturnValue(of({ template: current, submission: { metaTemplateName: 'x', metaStatus: 'NOT_CREATED', dryRun: true } }));
    await create();
    btn('Submit for approval')!.click();
    await settle();
    ui.respond(true);
    await settle();
    expect(ui.toasts().some((t) => t.message.includes('Test mode'))).toBe(true);
  });

  it('disables Submit everywhere when WhatsApp template space is at the ceiling', async () => {
    api['getTemplatesUsage'].mockReturnValue(of({ used: 90, limit: 250, ceiling: 90, atCeiling: true }));
    const el = await create();
    expect(btn('Submit for approval')!.disabled).toBe(true);
    expect(el.textContent).toContain('Submissions are paused');
  });

  it('does not allow resubmitting a pending or approved version', async () => {
    current = template([variant('en', { metaStatus: 'PENDING' })]);
    const el = await create();
    expect(btn('Submit for approval')!.disabled).toBe(true);
    expect(el.textContent).toContain('Already submitted and waiting for WhatsApp.');
  });

  it('marks an Arabic version as reviewed only after confirmation, and explains why', async () => {
    current = template([variant('en'), variant('ar', { body: AR_BODY, buttons: [{ role: 'opt_out', text: 'إلغاء الاشتراك' }] })]);
    const el = await create({ tab: 'ar' });
    expect(el.textContent).toContain('A native Arabic reader must confirm this wording');
    btn('Mark as reviewed')!.click();
    await settle();
    expect(api['reviewVariant']).not.toHaveBeenCalled();
    ui.respond(true);
    await settle();
    expect(api['reviewVariant']).toHaveBeenCalledWith('t1', 'ar', 'reviewed');
  });

  it('goes back to draft from reviewed, showing the reviewer', async () => {
    current = template([variant('en', { reviewStatus: 'reviewed', reviewedBy: 'Nora', reviewedAt: '2026-10-03T08:00:00.000Z' })]);
    const el = await create();
    expect(el.textContent).toContain('Reviewed by Nora');
    btn('Back to draft')!.click();
    await settle();
    ui.respond(true);
    await settle();
    expect(api['reviewVariant']).toHaveBeenCalledWith('t1', 'en', 'draft');
  });

  it('only offers a test message for approved versions and confirms before sending', async () => {
    let el = await create();
    expect(q<HTMLInputElement>('#ap-phone-en').disabled).toBe(true);
    expect(btn('Send test')!.disabled).toBe(true);
    expect(el.textContent).toContain('once WhatsApp has approved this version');
    fixture.destroy();
    TestBed.resetTestingModule();

    current = template([variant('en', { metaStatus: 'APPROVED', sendable: true, notSendableReason: null })]);
    el = await create();
    expect(el.textContent).toContain('Yes. This version is approved and ready to send.');
    const phone = q<HTMLInputElement>('#ap-phone-en');
    expect(phone.disabled).toBe(false);
    expect(phone.getAttribute('dir')).toBe('ltr');
    phone.value = '+966501234567';
    phone.dispatchEvent(new Event('input'));
    btn('Send test')!.click();
    await settle();
    expect(ui.confirmState()?.message).toContain('+966501234567');
    expect(api['testSendVariant']).not.toHaveBeenCalled();
    ui.respond(true);
    await settle();
    expect(api['testSendVariant']).toHaveBeenCalledWith('t1', 'en', '+966501234567');
  });

  it('explains why a version cannot be sent and hides a placeholder rejection reason', async () => {
    current = template([variant('en', { metaStatus: 'REJECTED', metaRejectedReason: 'NONE', notSendableReason: 'rejected' })]);
    let el = await create();
    expect(el.textContent).toContain('No: WhatsApp rejected this version.');
    expect(el.textContent).not.toContain('Reason from WhatsApp');
    fixture.destroy();
    TestBed.resetTestingModule();

    current = template([variant('en', { metaStatus: 'REJECTED', metaRejectedReason: 'INVALID_FORMAT', notSendableReason: 'rejected' })]);
    el = await create();
    expect(el.textContent).toContain('Reason from WhatsApp');
    expect(el.textContent).toContain('INVALID_FORMAT');
  });

  it('notes when WhatsApp re-classified the category', async () => {
    current = template([variant('en', { metaStatus: 'APPROVED', metaCategory: 'MARKETING' })], { useCase: 'payment_reminder', category: 'UTILITY' });
    const el = await create();
    expect(el.textContent).toContain('WhatsApp classified this version as Marketing, so it will only be sent to customers who opted in');
  });

  it('inserts a merge field at the caret of the body', async () => {
    await create();
    const body = q<HTMLTextAreaElement>('#ve-body');
    await typeInto('#ve-body', 'Hello  there');
    body.focus();
    body.setSelectionRange(6, 6);
    const chip = Array.from(fixture.nativeElement.querySelectorAll('.ve-chip') as NodeListOf<HTMLButtonElement>).find((c) => c.textContent?.includes('Customer first name'))!;
    chip.click();
    await settle();
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('Hello {name} there');
    expect(chip.className).toContain('used');
  });

  it('adds an opt-out button in the version language for marketing templates', async () => {
    current = template([variant('en', { buttons: [] })]);
    const el = await create();
    expect(el.textContent).toContain('need an opt-out button');
    btn('Add opt-out button')!.click();
    await settle();
    const label = el.querySelector<HTMLInputElement>('.ve-btn-label input')!;
    expect(label.value).toBe('Opt Out');
    expect(btn('Add opt-out button')).toBeUndefined();
  });

  it('starts an Arabic version from the English one with the Arabic opt-out label', async () => {
    const el = await create({ tab: 'ar' });
    expect(el.textContent).toContain('no Arabic version yet');
    btn('Start from the English version')!.click();
    await settle();
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('Hi {name}, we miss you');
    expect(q<HTMLInputElement>('.ve-btn-label input').value).toBe('إلغاء الاشتراك');
    current = template([variant('en'), variant('ar')]);
    btn('Save changes')!.click();
    await settle();
    expect(api['saveVariant']).toHaveBeenCalledWith('t1', 'ar', expect.objectContaining({
      body: 'Hi {name}, we miss you', buttons: [{ role: 'opt_out', text: 'إلغاء الاشتراك' }], source: 'merchant',
    }));
  });

  it('applies an AI draft only when the user accepts it, and saves it as source ai', async () => {
    current = template([variant('en'), variant('ar', { body: AR_BODY, buttons: [{ role: 'opt_out', text: 'إلغاء الاشتراك' }] })]);
    const el = await create({ tab: 'ar' });
    btn('Translate to Arabic', q('.ve-edit'))!.click();
    await settle();
    expect(api['aiTranslate']).toHaveBeenCalledWith(expect.objectContaining({ text: AR_BODY, to: 'ar', context: 'template_body' }));
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe(AR_BODY); // not applied yet
    expect(api['saveVariant']).not.toHaveBeenCalled();
    btn('Use this draft')!.click();
    await settle();
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('أهلاً {name}');
    expect(el.textContent).toContain('AI draft: review before using');
    btn('Save changes')!.click();
    await settle();
    expect(api['saveVariant']).toHaveBeenCalledWith('t1', 'ar', expect.objectContaining({ body: 'أهلاً {name}', source: 'ai' }));
  });

  it('switches the phone direction with the preview toggle', async () => {
    current = template([variant('en')]);
    await create();
    expect(q('.ve-side .wap-frame').getAttribute('dir')).toBe('ltr');
    btn('Arabic customer')!.click();
    await settle();
    expect(q('.ve-side .wap-frame').getAttribute('dir')).toBe('rtl');
    btn('English customer')!.click();
    await settle();
    expect(q('.ve-side .wap-frame').getAttribute('dir')).toBe('ltr');
  });

  it('previews through the server (sample values) and falls back to the typed text', async () => {
    await create();
    await settle(450);
    expect(api['previewVariant']).toHaveBeenCalled();
    expect(q('.ve-side .wap-text').textContent).toContain('Hi Sara');
    api['previewVariant'].mockReturnValue(throwError(() => ({ status: 500 })));
    await typeInto('#ve-body', 'Typed {name} text here');
    await settle(450);
    expect(q('.ve-side .wap-text').textContent).toContain('Typed {name} text here');
  });

  it('shows both languages side by side when both versions exist', async () => {
    current = template([variant('en'), variant('ar', { body: AR_BODY })]);
    await create();
    btn('Side by side')!.click();
    await settle(450);
    const frames = fixture.nativeElement.querySelectorAll('.ve-side .wap-frame');
    expect(frames.length).toBe(2);
    expect(frames[0].getAttribute('dir')).toBe('ltr');
    expect(frames[1].getAttribute('dir')).toBe('rtl');
  });

  it('asks before leaving a language tab with unsaved edits', async () => {
    const el = await create();
    await typeInto('#ve-body', 'Unsaved words');
    el.querySelectorAll<HTMLElement>('[role=tab]')[1].click();
    await settle();
    expect(ui.confirmState()).not.toBeNull();
    ui.respond(false);
    await settle();
    expect(el.querySelectorAll('[role=tab]')[0].getAttribute('aria-selected')).toBe('true');
    expect(q<HTMLTextAreaElement>('#ve-body').value).toBe('Unsaved words');
    el.querySelectorAll<HTMLElement>('[role=tab]')[1].click();
    await settle();
    ui.respond(true);
    await settle();
    expect(el.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')).toBe('true');
    expect(el.textContent).toContain('no Arabic version yet');
  });

  it('asks before changing the category and warns about approval and pricing', async () => {
    current = template([variant('en')], { useCase: 'payment_reminder' });
    const el = await create();
    expect(el.textContent).toContain('affects WhatsApp approval and pricing');
    const select = q<HTMLSelectElement>('#te-category');
    select.value = 'UTILITY';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(ui.confirmState()).not.toBeNull();
    expect(api['updateTemplate']).not.toHaveBeenCalled();
    ui.respond(true);
    await settle();
    expect(api['updateTemplate']).toHaveBeenCalledWith('t1', { category: 'UTILITY' });
  });

  describe('category follows the use case (only transactional use cases may be Utility)', () => {
    const categoryOptions = (): string[] => Array.from(q<HTMLSelectElement>('#te-category').options).map((o) => o.value);
    async function pickUseCase(value: string): Promise<void> {
      const select = q<HTMLSelectElement>('#te-usecase');
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
    }

    it('shows Marketing, disabled, with a helper line for a non-transactional use case', async () => {
      const el = await create(); // use case "comeback"
      const select = q<HTMLSelectElement>('#te-category');
      expect(select.disabled).toBe(true);
      expect(categoryOptions()).toEqual(['MARKETING']);
      expect(select.value).toBe('MARKETING');
      expect(select.getAttribute('aria-describedby')).toBe('te-category-note');
      expect(q('#te-category-note').textContent).toContain('Marketing and promotional messages are always sent as Marketing, which means only to customers who opted in.');
      expect(el.textContent).not.toContain('affects WhatsApp approval and pricing');
    });

    it('never shows Utility for a non-transactional use case, even if the stored category says so', async () => {
      current = template([variant('en')], { useCase: 'promotion', category: 'UTILITY' });
      await create();
      expect(q<HTMLSelectElement>('#te-category').value).toBe('MARKETING');
      expect(q<HTMLSelectElement>('#te-category').disabled).toBe(true);
      expect(categoryOptions()).toEqual(['MARKETING']);
    });

    it('offers both categories, enabled and without the helper line, for a transactional use case', async () => {
      current = template([variant('en')], { useCase: 'booking_reminder', category: 'UTILITY' });
      const el = await create();
      const select = q<HTMLSelectElement>('#te-category');
      expect(select.disabled).toBe(false);
      expect(categoryOptions()).toEqual(['MARKETING', 'UTILITY']);
      expect(select.value).toBe('UTILITY');
      expect(select.hasAttribute('aria-describedby')).toBe(false);
      expect(el.textContent).not.toContain('always sent as Marketing');
      expect(el.textContent).toContain('Order, payment and booking updates.');
    });

    it('shows the helper line in Arabic', async () => {
      const el = await create({ lang: 'ar' });
      expect(q<HTMLSelectElement>('#te-category').disabled).toBe(true);
      expect(q('#te-category-note').textContent).toContain('الرسائل التسويقية والترويجية تُرسل دائماً كرسائل تسويقية');
      expect(el.textContent).not.toMatch(/templates\.[a-z]/);
    });

    it('moving from a transactional use case to another sets the category to Marketing in the same save', async () => {
      current = template([variant('en')], { useCase: 'payment_reminder', category: 'UTILITY' });
      api['updateTemplate'].mockImplementation((_id: string, patch: Partial<LocalizedTemplate>) => {
        current = floored({ ...current, ...patch });
        return of(current);
      });
      await create();
      expect(q<HTMLSelectElement>('#te-category').value).toBe('UTILITY');
      await pickUseCase('promotion');
      expect(api['updateTemplate']).toHaveBeenCalledTimes(1);
      expect(api['updateTemplate']).toHaveBeenCalledWith('t1', { useCase: 'promotion', category: 'MARKETING' });
      expect(ui.confirmState()).toBeNull(); // Marketing is the only option now, so there is nothing to confirm
      expect(q<HTMLSelectElement>('#te-category').value).toBe('MARKETING');
      expect(q<HTMLSelectElement>('#te-category').disabled).toBe(true);
      expect(categoryOptions()).toEqual(['MARKETING']);
      expect(q('#te-category-note').textContent).toContain('always sent as Marketing');
    });

    it('keeps the category untouched when the use case change does not need it, and unlocks the choice again', async () => {
      current = template([variant('en')], { useCase: 'payment_reminder', category: 'MARKETING' });
      api['updateTemplate'].mockImplementation((_id: string, patch: Partial<LocalizedTemplate>) => {
        current = floored({ ...current, ...patch });
        return of(current);
      });
      await create();
      await pickUseCase('greeting'); // already Marketing: nothing to move
      expect(api['updateTemplate']).toHaveBeenLastCalledWith('t1', { useCase: 'greeting' });
      expect(q<HTMLSelectElement>('#te-category').disabled).toBe(true);
      await pickUseCase('order_confirmation'); // back to a transactional one
      expect(api['updateTemplate']).toHaveBeenLastCalledWith('t1', { useCase: 'order_confirmation' });
      expect(q<HTMLSelectElement>('#te-category').disabled).toBe(false);
      expect(q<HTMLSelectElement>('#te-category').value).toBe('MARKETING');
      expect(categoryOptions()).toEqual(['MARKETING', 'UTILITY']);
      expect(q('#te-category-note').textContent).toContain('affects WhatsApp approval and pricing');
    });
  });

  it('renames the template on blur', async () => {
    await create();
    const name = q<HTMLInputElement>('#te-name');
    name.value = 'Win back 2';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new Event('blur'));
    await settle();
    expect(api['updateTemplate']).toHaveBeenCalledWith('t1', { name: 'Win back 2' });
  });

  it('locks flow buttons on a template linked to an automated flow', async () => {
    current = template([variant('en', { buttons: [{ role: 'flow_button', text: 'Book now' }] })], { linkedMessageNodeId: 'n1' });
    const el = await create();
    expect(q<HTMLInputElement>('.ve-btn-label input').disabled).toBe(true);
    expect(q<HTMLSelectElement>('.ve-btn select').disabled).toBe(true);
    expect(el.querySelector('.ve-x')).toBeNull();
    expect(el.textContent).toContain('managed by the flow');
  });

  it('shows a localised retryable error when the template cannot be loaded', async () => {
    api['getTemplate'].mockReturnValueOnce(throwError(() => ({ status: 404, error: { code: 'TEMPLATE_NOT_FOUND' } })));
    const el = await create({ lang: 'ar' });
    expect(el.querySelector('.loc-error')?.textContent).toContain('لم نعثر على هذا القالب');
    el.querySelector<HTMLButtonElement>('.loc-error button')!.click();
    await settle();
    expect(api['getTemplate']).toHaveBeenCalledTimes(2);
    expect(el.querySelector('#ve-body')).toBeTruthy();
  });

  it('refreshes the status of one template version', async () => {
    await create();
    current = template([variant('en', { metaStatus: 'APPROVED' })]);
    btn('Refresh status')!.click();
    await settle();
    expect(api['refreshTemplateStatuses']).toHaveBeenCalledWith('t1');
    expect(api['getTemplate']).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Approved by WhatsApp.');
  });
});
