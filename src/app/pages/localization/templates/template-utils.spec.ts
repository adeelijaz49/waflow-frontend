import {
  USE_CASES, canSubmitStatus, categoryFor, insertAtCaret, isRealRejectionReason, isTransactionalUseCase, libraryGroupOf, sameForm, splitIssues,
} from './template-utils';

describe('template utils', () => {
  it('inserts at the caret, replaces a selection and falls back to the end', () => {
    expect(insertAtCaret('Hello  there', 6, 6, '{name}')).toEqual({ value: 'Hello {name} there', caret: 12 });
    expect(insertAtCaret('Hello XXX', 6, 9, '{name}').value).toBe('Hello {name}');
    expect(insertAtCaret('Hi', null, null, '{name}').value).toBe('Hi{name}');
    expect(insertAtCaret('Hi', 99, 99, '{name}').value).toBe('Hi{name}');
  });

  it('promotes the rejected-by-WhatsApp codes to errors, and the no-Arabic check only for Arabic versions', () => {
    const warn = [{ code: 'body_starts_with_variable' }, { code: 'repeated_field' }, { code: 'arabic_variant_has_no_arabic' }];
    const ar = splitIssues([], warn, 'ar');
    expect(ar.errors.map((i) => i.code)).toEqual(['body_starts_with_variable', 'arabic_variant_has_no_arabic']);
    expect(ar.warnings.map((i) => i.code)).toEqual(['repeated_field']);
    const en = splitIssues([{ code: 'body_required' }], warn, 'en');
    expect(en.errors.map((i) => i.code)).toEqual(['body_required', 'body_starts_with_variable']);
  });

  it('ignores the literal NONE rejection reason', () => {
    expect(isRealRejectionReason('NONE')).toBe(false);
    expect(isRealRejectionReason('none')).toBe(false);
    expect(isRealRejectionReason('')).toBe(false);
    expect(isRealRejectionReason(null)).toBe(false);
    expect(isRealRejectionReason('INVALID_FORMAT')).toBe(true);
  });

  it('allows (re)submission only from statuses a merchant can act on', () => {
    expect(['NOT_CREATED', 'REJECTED', 'ERROR'].every(canSubmitStatus)).toBe(true);
    expect(['PENDING', 'APPROVED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'DELETED'].some(canSubmitStatus)).toBe(false);
  });

  it('treats only the four transactional use cases as able to be Utility; everything else is Marketing', () => {
    const transactional = ['payment_reminder', 'booking_confirmation', 'booking_reminder', 'order_confirmation'];
    expect(USE_CASES.filter((u) => isTransactionalUseCase(u))).toEqual(['payment_reminder', 'booking_confirmation', 'booking_reminder', 'order_confirmation']);
    for (const u of USE_CASES) {
      expect(categoryFor(u, 'UTILITY')).toBe(transactional.includes(u) ? 'UTILITY' : 'MARKETING');
      expect(categoryFor(u, 'MARKETING')).toBe('MARKETING');
    }
    expect(isTransactionalUseCase(null)).toBe(false);
    expect(isTransactionalUseCase('something_new')).toBe(false);
  });

  it('compares forms structurally and groups use cases for the library', () => {
    const a = { header: '', body: 'x', footer: '', buttons: [{ role: 'url' as const, text: 'Go', url: 'https://a.sa' }], bilingualOrder: 'ar_first' as const };
    expect(sameForm(a, { ...a, buttons: [{ ...a.buttons[0] }] }, false)).toBe(true);
    expect(sameForm(a, { ...a, bilingualOrder: 'en_first' }, false)).toBe(true);
    expect(sameForm(a, { ...a, bilingualOrder: 'en_first' }, true)).toBe(false);
    expect(sameForm(a, { ...a, body: 'y' }, false)).toBe(false);
    expect(libraryGroupOf('points_expiring')).toBe('loyalty');
    expect(libraryGroupOf('order_confirmation')).toBe('payments');
    expect(libraryGroupOf('custom')).toBe('other');
  });
});
