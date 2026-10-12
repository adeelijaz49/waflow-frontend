import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { I18nService } from '../../../i18n';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { LocalizedTemplate, TemplateButton } from '../localization.types';
import { TemplatesTab } from './templates-tab';
import { VariantEditor } from './variant-editor';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const created = { id: 'n9', key: 'n9', name: 'Eid sale', useCase: 'promotion', category: 'MARKETING', archived: false, linkedMessageNodeId: null, linkedPromotionId: 'a'.repeat(24), variants: [] } as unknown as LocalizedTemplate;

async function openTab(query: Record<string, string>) {
  localStorage.clear();
  const api = {
    listTemplates: vi.fn(() => of({ items: [] })),
    getTemplatesUsage: vi.fn(() => of({ used: 1, limit: 250, ceiling: 90, atCeiling: false })),
    getTemplateLibrary: vi.fn(() => of({ items: [] })),
    createTemplate: vi.fn(() => of(created)),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocalizationApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await TestBed.inject(I18nService).init();
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(TemplatesTab);
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 20));
  fixture.detectChanges();
  return { fixture, api, nav, el: fixture.nativeElement as HTMLElement, comp: fixture.componentInstance };
}

describe('Templates tab: ?forPromotion deep link', () => {
  const id = 'a'.repeat(24);

  it('opens the new-template dialog for the promotion (use case Promotion, Marketing, name prefilled) and links the template', async () => {
    const { fixture, api, nav, el } = await openTab({ forPromotion: id, name: 'Eid sale' });
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    expect((el.querySelector('#tl-new-name') as HTMLInputElement).value).toBe('Eid sale');
    expect((el.querySelector('#tl-new-usecase') as HTMLSelectElement).value).toBe('promotion');
    expect((el.querySelector('#tl-new-category') as HTMLSelectElement).value).toBe('MARKETING');
    expect(el.textContent).toContain('This template belongs to a promotion.');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(api.createTemplate).toHaveBeenCalledWith({ name: 'Eid sale', useCase: 'promotion', category: 'MARKETING', linkedPromotionId: id });
    expect(nav).toHaveBeenCalledWith(['/arabic/templates', 'n9'], {});
  });

  it('does nothing without the parameter or with an invalid id', async () => {
    const cases: Array<Record<string, string>> = [{}, { forPromotion: 'not-an-id', name: 'x' }, { forPromotion: '<script>', name: 'x' }];
    for (const q of cases) {
      const { el } = await openTab(q);
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('caps the prefilled name and does not link a template created through the normal New button', async () => {
    const { fixture, api, comp, el } = await openTab({ forPromotion: id, name: 'x'.repeat(200) });
    expect(comp.newName().length).toBe(80);
    comp.openNew(); // the merchant starts a plain new template instead
    comp.newName.set('Plain');
    fixture.detectChanges();
    expect(el.textContent).not.toContain('This template belongs to a promotion.');
    comp.createNew();
    expect(api.createTemplate).toHaveBeenCalledWith({ name: 'Plain', useCase: 'custom', category: 'MARKETING' });
  });
});

describe('Variant editor: shop_now button role', () => {
  const arabicVariant = {
    language: 'ar', bilingualOrder: null, header: '', body: 'hello {name}', footer: '', buttons: [], metaTemplateName: null, metaStatus: 'NOT_CREATED',
    metaRejectedReason: null, metaCategory: null, metaPreviousCategory: null, metaFlagged: false, metaStatusRaw: null, metaLastCheckedAt: null,
    submittedAt: null, submissionCount: 0, lastError: null, reviewStatus: 'draft', reviewedBy: null, reviewedAt: null, source: 'merchant',
    validation: { ok: true, errors: [], warnings: [], positionalText: '', params: [] }, sendable: false, notSendableReason: 'not_submitted',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  async function editor(linkedPromotionId: string | null, buttons: TemplateButton[] = []) {
    localStorage.clear();
    const api = { validateVariant: vi.fn(() => of({ ok: true, errors: [], warnings: [], positionalText: '', params: [] })), previewVariant: vi.fn(() => of({})) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: LocalizationApiService, useValue: api }] });
    await TestBed.inject(I18nService).init();
    const tpl = { id: 't1', key: 't1', name: 'Eid', useCase: 'promotion', category: 'MARKETING', archived: false, linkedMessageNodeId: null, linkedPromotionId, variants: [arabicVariant] } as unknown as LocalizedTemplate;
    const fixture = TestBed.createComponent(VariantEditor);
    fixture.componentRef.setInput('template', tpl);
    fixture.componentRef.setInput('language', 'ar');
    fixture.detectChanges();
    return { comp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, buttons };
  }

  it('offers shop_now only for a template linked to a promotion', async () => {
    const linked = await editor('a'.repeat(24));
    expect(linked.comp.rolesFor({ role: 'url', text: 'x', url: '' })).toEqual(['opt_out', 'opt_in', 'decline', 'url', 'shop_now']);
    TestBed.resetTestingModule();
    const plain = await editor(null);
    expect(plain.comp.rolesFor({ role: 'url', text: 'x', url: '' })).toEqual(['opt_out', 'opt_in', 'decline', 'url']);
  });

  it('keeps showing shop_now for a button that already has that role, and flow buttons stay locked', async () => {
    const plain = await editor(null);
    expect(plain.comp.rolesFor({ role: 'shop_now', text: 'تسوق الآن' })).toContain('shop_now');
    expect(plain.comp.rolesFor({ role: 'flow_button', text: 'Yes' })).toEqual(['flow_button']);
  });

  it('shows the linked-promotion hint only for a linked template', async () => {
    const linked = await editor('a'.repeat(24));
    expect(linked.el.textContent).toContain('This template belongs to a promotion.');
    TestBed.resetTestingModule();
    const plain = await editor(null);
    expect(plain.el.textContent).not.toContain('This template belongs to a promotion.');
  });
});
