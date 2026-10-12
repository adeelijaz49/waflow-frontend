import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../../i18n';
import type { ImportLocalizationSummary } from '../localization.types';
import { ImportLanguageSummary } from './import-language-summary';

vi.setConfig({ testTimeout: 30000 });

@Component({ imports: [ImportLanguageSummary], template: `<app-import-language-summary [summary]="summary()" [entity]="entity()" />` })
class Host {
  summary = signal<ImportLocalizationSummary | null>(null);
  entity = signal<string | null>(null);
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

async function setup(summary: ImportLocalizationSummary | null, entity: string | null, uiLang?: 'ar') {
  localStorage.clear();
  if (uiLang) localStorage.setItem('waflow_ui_language', uiLang);
  await TestBed.inject(I18nService).init();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.summary.set(summary);
  fixture.componentInstance.entity.set(entity);
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

// What the backend sends for any import (all counters present, the irrelevant ones are zero).
const ALL: ImportLocalizationSummary = {
  languagesSet: 12, languagesProtected: 2, languagesUnchanged: 3, languagesFailed: 0,
  translationsSaved: 5, translationsUnchanged: 1, translationsFailed: 0,
};

describe('ImportLanguageSummary', () => {
  it('renders nothing without a summary', async () => {
    expect(text(await setup(null, 'customer'))).toBe('');
  });

  describe('customer import: only the language counters', () => {
    it('shows languages set / unchanged / protected and never the Arabic text counters', async () => {
      const el = await setup(ALL, 'customer');
      const t = text(el);
      expect(t).toContain('Languages set: 12. Languages unchanged: 3.');
      expect(t).toContain('Customers who chose their own language were left unchanged: 2.');
      expect(t).not.toMatch(/Arabic texts|drafts|texts/i);
      expect(t).not.toContain('could not be saved');
      expect(t).not.toMatch(/embedded\./);
    });

    it('warns about failed languages only, with the language count', async () => {
      const t = text(await setup({ languagesSet: 0, languagesFailed: 3, translationsFailed: 9 }, 'customer'));
      expect(t).toContain('Some customer languages could not be saved (3).');
      expect(t).not.toContain('Arabic texts');
      expect(t).not.toContain('(9)');
      expect(t).not.toContain('left unchanged');
    });

    it('prints a zero summary as zeros (a language-less import) without Arabic text counters', async () => {
      const t = text(await setup({ languagesSet: 0, languagesUnchanged: 0 }, 'customer'));
      expect(t).toBe('Languages set: 0. Languages unchanged: 0.');
    });
  });

  describe.each(['product', 'service'])('%s import: only the Arabic text counters', (entity) => {
    it('shows drafts saved / unchanged and never the language counters', async () => {
      const t = text(await setup(ALL, entity));
      expect(t).toContain('Arabic texts saved as drafts: 5. Unchanged: 1.');
      expect(t).not.toMatch(/Languages|language/);
      expect(t).not.toContain('could not be saved');
    });

    it('warns about failed texts only, with the text count', async () => {
      const t = text(await setup({ translationsSaved: 1, translationsFailed: 2, languagesFailed: 7, languagesProtected: 4 }, entity));
      expect(t).toContain('Some Arabic texts could not be saved (2).');
      expect(t).not.toContain('(7)');
      expect(t).not.toMatch(/language/i);
    });
  });

  it('tells the entity from the shape of the summary when the host does not say', async () => {
    expect(text(await setup({ translationsSaved: 4 }, null))).toBe('Arabic texts saved as drafts: 4. Unchanged: 0.');
    expect(text(await setup({ languagesSet: 4 }, null))).toBe('Languages set: 4. Languages unchanged: 0.');
  });

  it('stays English when the stored UI language is Arabic', async () => {
    const el = await setup({ languagesSet: 1 }, 'customer', 'ar');
    expect(text(el)).toContain('Languages set: 1.');
    expect(text(el)).not.toMatch(/\p{Script=Arabic}/u);
  });
});
