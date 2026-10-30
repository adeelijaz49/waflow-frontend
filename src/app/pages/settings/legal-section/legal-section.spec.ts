import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LegalSection } from './legal-section';

// Settings -> Legal: every document with its date, a Draft badge only on the ones that are still drafts, the acceptance state of the ones
// that have an acceptance step (the Refund & Cancellation Policy has none), and a note that is only shown while a draft remains.
vi.setConfig({ testTimeout: 30000 });

const doc = (slug: string, title: string, status: 'draft' | 'final', effectiveDate: string, currentVersion = status === 'draft' ? 'draft-1' : 'v1') =>
  ({ slug, title, currentVersion, effectiveDate, status });

const ALL = [
  doc('terms_of_service', 'Terms of Service', 'draft', '2026-09-23'),
  doc('privacy_policy', 'Privacy Policy', 'draft', '2026-09-23'),
  doc('acceptable_use_policy', 'Acceptable Use Policy', 'draft', '2026-09-23'),
  doc('data_processing_agreement', 'Data Processing Agreement', 'draft', '2026-09-23'),
  doc('refund_cancellation_policy', 'Refund & Cancellation Policy', 'final', '2026-10-25'),
];

const STATUS = {
  requiresCombinedAcceptance: false, requiresDpaAcceptance: false,
  combined: { documents: ['terms_of_service', 'privacy_policy', 'acceptable_use_policy'].map((slug) => ({ slug, title: slug, currentVersion: 'draft-1', accepted: true, acceptedAt: '2026-10-01T09:00:00Z', acceptedVersion: 'draft-1' })) },
  dpa: { slug: 'data_processing_agreement', title: 'Data Processing Agreement', currentVersion: 'draft-1', summary: '', accepted: false, acceptedAt: null, acceptedVersion: null, acceptedByUserId: null },
};

async function show(documents: unknown[]) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(LegalSection);
  fixture.detectChanges();
  http.expectOne((r) => r.url.endsWith('/api/legal/documents')).flush(documents);
  http.expectOne((r) => r.url.endsWith('/api/legal/acceptance-status')).flush(STATUS);
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el.querySelectorAll('.legal-doc-row')) as HTMLElement[];
  const rowOf = (title: string) => rows().find((r) => (r.querySelector('.legal-doc-title')?.textContent || '').trim() === title)!;
  return { el, rows, rowOf, text: () => (el.textContent || '').replace(/\s+/g, ' ') };
}

describe('Settings: Legal', () => {
  it('lists the five documents with their dates; the Refund & Cancellation Policy has its own date and NO Draft badge, the other four keep theirs', async () => {
    const { rows, rowOf } = await show(ALL);
    expect(rows().length).toBe(5);
    const refund = rowOf('Refund & Cancellation Policy');
    expect((refund.textContent || '')).toContain('Last updated 25 Oct 2026');
    expect(refund.querySelector('.badge')).toBeNull();
    for (const title of ['Terms of Service', 'Privacy Policy', 'Acceptable Use Policy', 'Data Processing Agreement']) {
      expect((rowOf(title).querySelector('.badge')?.textContent || '').trim()).toBe('Draft');
      expect((rowOf(title).textContent || '')).toContain('Last updated 23 Sep 2026');
    }
  });

  it('the policy has no acceptance line (nobody has to accept it); the others show theirs', async () => {
    const { rowOf } = await show(ALL);
    expect(rowOf('Refund & Cancellation Policy').querySelector('.legal-doc-accepted, .legal-doc-pending')).toBeNull();
    expect((rowOf('Terms of Service').textContent || '')).toContain('You accepted this on');
    expect((rowOf('Data Processing Agreement').textContent || '')).toContain('Not yet accepted');
  });

  it('every document can be read: a Read link to /legal/<slug>', async () => {
    const { rows } = await show(ALL);
    const hrefs = rows().map((r) => r.querySelector('a.btn')?.getAttribute('href'));
    expect(hrefs).toEqual(ALL.map((d) => `/legal/${d.slug}`));
  });

  it('says the drafts are working drafts while at least one remains - and no longer says that ALL of them are', async () => {
    const { text } = await show(ALL);
    expect(text()).toContain('Documents marked Draft are working drafts');
    expect(text()).not.toContain('These documents are still marked DRAFT');
    expect(text()).toContain('Past acceptances of an earlier version always stay retrievable.');
  });

  it('with every document final the note about drafts disappears and the one about past acceptances stays', async () => {
    const { text } = await show(ALL.map((d) => ({ ...d, status: 'final', currentVersion: 'v1' })));
    expect(text()).not.toContain('working drafts');
    expect(text()).toContain('Past acceptances of an earlier version always stay retrievable.');
  });
});
