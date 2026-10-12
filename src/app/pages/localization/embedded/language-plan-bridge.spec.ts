import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { I18nService } from '../../../i18n';
import { LocalizationFlagService } from '../../../services/localization-flag.service';
import type { PromotionSendPlan } from '../localization.types';
import { LanguagePlanBridge } from './language-plan-bridge';

// Loading the real catalogues (and, for the Arabic cases, a second one) is slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const plan = (over: Partial<PromotionSendPlan> = {}): PromotionSendPlan => ({
  promotionId: 'p1', promotionName: 'Eid', sendFormat: 'separate', selected: 41, eligible: 38,
  skipped: { noConsent: 2, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 0 },
  byLanguage: { ar: 12, en: 26 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 6 }], blocked: [],
  variant: null, warnings: [], canSend: true, needsAcknowledgement: true, ...over,
});

async function setup(flagged: boolean, uiLang: 'en' | 'ar' = 'en') {
  localStorage.clear();
  const enabled = signal(flagged);
  TestBed.configureTestingModule({ providers: [{ provide: LocalizationFlagService, useValue: { arabicEnabled: enabled } }] });
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  if (uiLang === 'ar') await i18n.use('ar', false);
  return { bridge: TestBed.inject(LanguagePlanBridge), enabled };
}

describe('LanguagePlanBridge', () => {
  it('returns an empty string for an unflagged merchant even with a plan published', async () => {
    const { bridge } = await setup(false);
    bridge.publish({ promotionId: 'p1', selectedSize: 41, plan: plan() });
    expect(bridge.confirmNote('p1', 41)).toBe('');
  });

  it('returns an empty string for another promotion, another selection size, or no plan', async () => {
    const { bridge } = await setup(true);
    expect(bridge.confirmNote('p1', 41)).toBe('');
    bridge.publish({ promotionId: 'p1', selectedSize: 41, plan: plan() });
    expect(bridge.confirmNote('p2', 41)).toBe('');
    expect(bridge.confirmNote('p1', 40)).toBe('');
    bridge.publish(null);
    expect(bridge.confirmNote('p1', 41)).toBe('');
  });

  it('writes the language counts and the fallback sentence in English', async () => {
    const { bridge } = await setup(true);
    bridge.publish({ promotionId: 'p1', selectedSize: 41, plan: plan() });
    expect(bridge.confirmNote('p1', 41)).toBe(
      '\n\nLanguage: 12 Arabic, 26 English. 6 of the English messages replace an Arabic version that is not ready.',
    );
  });

  it('uses the singular fallback sentence for one customer and omits it when there is no fallback', async () => {
    const { bridge } = await setup(true);
    bridge.publish({ promotionId: 'p1', selectedSize: 3, plan: plan({ byLanguage: { ar: 1, en: 2 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 1 }] }) });
    expect(bridge.confirmNote('p1', 3)).toContain('1 of the English messages replaces an Arabic version');
    bridge.publish({ promotionId: 'p1', selectedSize: 3, plan: plan({ byLanguage: { ar: 2, en: 1 }, fallbacks: [] }) });
    expect(bridge.confirmNote('p1', 3)).toBe('\n\nLanguage: 2 Arabic, 1 English.');
  });

  it('says nothing when nobody involved speaks Arabic (the dialog stays exactly as today)', async () => {
    const { bridge } = await setup(true);
    bridge.publish({ promotionId: 'p1', selectedSize: 3, plan: plan({ byLanguage: { ar: 0, en: 3 }, fallbacks: [] }) });
    expect(bridge.confirmNote('p1', 3)).toBe('');
  });

  it('stays English even when the stored UI language is Arabic', async () => {
    const { bridge } = await setup(true, 'ar');
    bridge.publish({ promotionId: 'p1', selectedSize: 41, plan: plan() });
    const note = bridge.confirmNote('p1', 41);
    expect(note).toContain('Language: 12 Arabic, 26 English.');
    expect(note).not.toMatch(/\p{Script=Arabic}/u);
  });

  it('never throws', async () => {
    const { bridge, enabled } = await setup(true);
    bridge.publish({ promotionId: 'p1', selectedSize: 41, plan: { byLanguage: null } as unknown as PromotionSendPlan });
    expect(() => bridge.confirmNote('p1', 41)).not.toThrow();
    expect(bridge.confirmNote('p1', 41)).toBe('');
    enabled.set(false);
    expect(bridge.confirmNote('p1', 41)).toBe('');
  });
});
