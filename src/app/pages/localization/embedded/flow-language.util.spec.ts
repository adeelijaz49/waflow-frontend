import {
  FlowTreeItem, TreeNode, TreeVersion, arabicStateOf, arabicVersion, buttonText, englishNotApproved, parentButtonLabel, splitAppUrl,
  summarizeFlow,
} from './flow-language.util';
import { knownWarnings, planCounts, skippedTotal, splitReason } from './plan-summary.util';
import type { PromotionSendPlan } from '../localization.types';

function ver(over: Partial<TreeVersion> = {}): TreeVersion {
  return {
    language: 'ar', body: 'مرحباً {name}', buttons: [{ position: 0, role: 'flow_button', text: 'نعم' }],
    metaStatus: 'APPROVED', reviewStatus: 'reviewed', stale: false, sendable: true, contentVersion: 1,
    editUrl: '/arabic/templates/t1', ...over,
  };
}
function node(over: Partial<TreeNode> = {}, versions: TreeVersion[] = []): TreeNode {
  return {
    messageNodeId: 'n1', parentNodeId: null, parentButtonPosition: null, depth: 0, isEntry: true, bodyText: 'Hi',
    buttons: [{ position: 0, label: 'Yes', action: 'send_message', targetNodeId: 'n2' }], templateStatus: 'approved',
    versions, canAddArabic: true, addArabicUrl: '/arabic/flows?node=n1', ...over,
  };
}

describe('arabicStateOf', () => {
  it('walks the state matrix', () => {
    expect(arabicStateOf(node(), 'default_template')).toBe('english_only');
    expect(arabicStateOf(node())).toBe('none');
    expect(arabicStateOf(node({}, [ver({ stale: true })]))).toBe('stale');
    expect(arabicStateOf(node({}, [ver({ metaStatus: 'NOT_CREATED', reviewStatus: 'draft', sendable: false })]))).toBe('not_submitted');
    expect(arabicStateOf(node({}, [ver({ metaStatus: 'PENDING', sendable: false })]))).toBe('waiting');
    expect(arabicStateOf(node({}, [ver({ metaStatus: 'IN_APPEAL', sendable: false })]))).toBe('waiting');
    for (const m of ['REJECTED', 'DISABLED', 'PAUSED', 'DELETED', 'LIMIT_EXCEEDED', 'ERROR'] as const) {
      expect(arabicStateOf(node({}, [ver({ metaStatus: m, sendable: false })]))).toBe('unusable');
    }
    expect(arabicStateOf(node({}, [ver({ reviewStatus: 'draft', sendable: false })]))).toBe('needs_review');
    expect(arabicStateOf(node({ isEntry: false }, [ver({ metaStatus: 'NOT_REQUIRED', reviewStatus: 'reviewed', sendable: true })]))).toBe('sends');
    expect(arabicStateOf(node({ isEntry: false }, [ver({ metaStatus: 'NOT_REQUIRED', reviewStatus: 'draft', sendable: false })]))).toBe('needs_review');
    expect(arabicStateOf(node({}, [ver()]))).toBe('sends');
    expect(arabicStateOf(node({}, [ver({ sendable: false })]))).toBe('not_ready');
    expect(arabicStateOf(null)).toBe('none');
  });

  it('a sendable Arabic ENTRY version does not "send" while its English message is not approved (the backend sends English then)', () => {
    for (const st of ['pending', 'not_created', 'rejected'] as const) {
      expect(arabicStateOf(node({ templateStatus: st }, [ver()]))).toBe('english_pending');
      expect(summarizeFlow({ messageSource: 'promotion', nodes: [node({ templateStatus: st }, [ver()])] }).kind).toBe('not_ready');
    }
    expect(arabicStateOf(node({ templateStatus: null }, [ver()]))).toBe('sends'); // promotion without a custom message
    expect(arabicStateOf(node({ isEntry: false, templateStatus: null }, [ver({ metaStatus: 'NOT_REQUIRED' })]))).toBe('sends');
    expect(arabicStateOf(node({ templateStatus: 'pending' }, [ver({ sendable: false })]))).toBe('not_ready');
  });

  it('stale wins over everything else', () => {
    expect(arabicStateOf(node({}, [ver({ stale: true, metaStatus: 'REJECTED' })]))).toBe('stale');
  });

  it('englishNotApproved applies to entry nodes with a non-approved English status only', () => {
    expect(englishNotApproved(node({ templateStatus: 'pending' }))).toBe(true);
    expect(englishNotApproved(node({ templateStatus: 'approved' }))).toBe(false);
    expect(englishNotApproved(node({ isEntry: false, templateStatus: null }))).toBe(false);
  });

  it('arabicVersion picks the ar row and ignores en/bilingual', () => {
    const n = node({}, [ver({ language: 'bilingual' }), ver({ language: 'ar', body: 'x' })]);
    expect(arabicVersion(n)?.body).toBe('x');
    expect(arabicVersion(node({}, [ver({ language: 'bilingual' })]))).toBeNull();
  });
});

describe('summarizeFlow', () => {
  const row = (nodes: TreeNode[], messageSource: FlowTreeItem['messageSource'] = 'promotion') => ({ messageSource, nodes });
  it('default templates are English only', () => {
    expect(summarizeFlow(row([], 'default_template')).kind).toBe('english_only');
  });
  it('counts follow-ups that send in Arabic', () => {
    const entry = node({}, [ver()]);
    const f1 = node({ messageNodeId: 'n2', isEntry: false }, [ver({ metaStatus: 'NOT_REQUIRED' })]);
    const f2 = node({ messageNodeId: 'n3', isEntry: false }, []);
    expect(summarizeFlow(row([entry, f1, f2]))).toEqual({ kind: 'ready', entryState: 'sends', followUpsReady: 1, followUpsTotal: 2 });
  });
  it('not ready when the entry is waiting, none when it has no Arabic', () => {
    expect(summarizeFlow(row([node({}, [ver({ metaStatus: 'PENDING', sendable: false })])])).kind).toBe('not_ready');
    expect(summarizeFlow(row([node()])).kind).toBe('none');
    expect(summarizeFlow(row([])).kind).toBe('none');
  });
});

describe('buttonText / parentButtonLabel / splitAppUrl', () => {
  it('matches buttons by position and ignores position null', () => {
    const v = ver({ buttons: [{ position: 0, role: 'flow_button', text: 'نعم' }, { position: null, role: 'opt_out', text: 'إلغاء الاشتراك' }, { position: 1, role: 'flow_button', text: 'لاحقاً' }] });
    expect(buttonText(v, 0)).toBe('نعم');
    expect(buttonText(v, 1)).toBe('لاحقاً');
    expect(buttonText(v, 2)).toBeNull();
    expect(buttonText(null, 0)).toBeNull();
  });
  it('finds the parent button label of a follow-up', () => {
    const entry = node();
    const child = node({ messageNodeId: 'n2', parentNodeId: 'n1', parentButtonPosition: 0, isEntry: false });
    expect(parentButtonLabel([entry, child], child)).toBe('Yes');
    expect(parentButtonLabel([entry, child], entry)).toBe('');
  });
  it('splits in-app links into commands and query params and rejects anything else', () => {
    expect(splitAppUrl('/arabic/flows?node=abc')).toEqual({ commands: ['/arabic/flows'], queryParams: { node: 'abc' } });
    expect(splitAppUrl('/arabic/templates/t1')).toEqual({ commands: ['/arabic/templates/t1'], queryParams: {} });
    expect(splitAppUrl('https://evil.example/x')).toBeNull();
    expect(splitAppUrl('//evil.example/x')).toBeNull();
    expect(splitAppUrl(null)).toBeNull();
  });
});

describe('plan summary helpers', () => {
  const plan = (over: Partial<PromotionSendPlan> = {}): PromotionSendPlan => ({
    promotionId: 'p', promotionName: 'P', sendFormat: 'separate', selected: 41, eligible: 38,
    skipped: { noConsent: 2, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 0 },
    byLanguage: { ar: 12, en: 26 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 6 }], blocked: [],
    variant: null, warnings: [], canSend: true, needsAcknowledgement: true, ...over,
  });
  it('derives plain English from byLanguage.en minus the fallbacks and never goes negative', () => {
    expect(planCounts(plan())).toEqual({ ar: 12, fallback: 6, en: 20, notMessaged: 3 });
    expect(planCounts(plan({ byLanguage: { ar: 1, en: 2 }, fallbacks: [{ from: 'ar', to: 'en', reason: 'pending', count: 9 }] })).en).toBe(0);
  });
  it('adds blocked rows to the not-messaged total', () => {
    expect(planCounts(plan({ blocked: [{ reason: 'template_unusable', count: 4 }] })).notMessaged).toBe(7);
    expect(skippedTotal(plan())).toBe(3);
  });
  it('counts a same-phone opt-out once although the backend reports it as skipped AND as a blocked row', () => {
    const both = plan({ skipped: { noConsent: 1, optedOut: 1, demoSimulated: 0, optedOutSamePhone: 2 }, blocked: [{ reason: 'opted_out_same_phone', count: 2 }] });
    expect(planCounts(both).notMessaged).toBe(4); // 1 + 1 + 2, not 6
    expect(skippedTotal(both)).toBe(2);
    // a backend that only reports it under skipped is still counted
    expect(planCounts(plan({ skipped: { noConsent: 0, optedOut: 0, demoSimulated: 0, optedOutSamePhone: 2 } })).notMessaged).toBe(2);
  });
  it('splitReason fills the field after a colon', () => {
    expect(splitReason('field_values_missing:date')).toEqual({ code: 'field_values_missing', field: 'date' });
    expect(splitReason('pending')).toEqual({ code: 'pending', field: '' });
  });
  it('keeps only known warnings and drops the arabic_fallback duplicate', () => {
    const w = knownWarnings([{ code: 'large_audience' }, { code: 'arabic_fallback' }, { code: 'mystery' }]);
    expect(w.map((x) => x.code)).toEqual(['large_audience']);
  });
});
