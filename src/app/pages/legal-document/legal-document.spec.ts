import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { LegalDocument } from './legal-document';

// The legal document viewer: the document is shown as the server sends it (Markdown), a final document carries no draft badge, an older
// version says so, and the links inside a document that point at another document of the app are followed inside the app.
vi.setConfig({ testTimeout: 30000 });

const POLICY_BODY = [
  '# WaFlow Refund & Cancellation Policy', '', '**Last updated:** 25 October 2026', '', '---', '',
  '## 1. Cancelling Your Subscription', '', 'You may cancel your WaFlow subscription at any time from **Settings → Billing**.', '', '---', '',
  '## 5. Data After Cancellation', '',
  'Following cancellation, your data is retained for 30 days, after which it will be deleted in accordance with our [Privacy Policy](/legal/privacy_policy) and [Data Processing Agreement](/legal/data_processing_agreement), except where retention is required by law.', '',
  '## 6. Contact', '', 'Questions can be directed to [Support@waflowtech.com](mailto:Support@waflowtech.com) or the [help centre](https://example.com/help).', '',
].join('\n');

const detail = (over: Record<string, unknown> = {}) => ({
  slug: 'refund_cancellation_policy', title: 'Refund & Cancellation Policy', version: 'v1', isCurrentVersion: true,
  effectiveDate: '2026-10-25', status: 'final', body: POLICY_BODY, ...over,
});

async function show(doc: Record<string, unknown> | null, { slug = 'refund_cancellation_policy', version = null as string | null } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug })), snapshot: { queryParamMap: convertToParamMap(version ? { version } : {}) } } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LegalDocument);
  fixture.detectChanges();
  const req = http.expectOne((r) => r.url.endsWith(`/api/legal/documents/${slug}`));
  expect(req.request.params.get('version')).toBe(version);
  if (doc) req.flush(doc); else req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, navigate, text: () => (el.textContent || '').replace(/\s+/g, ' ') };
}

// A click the component leaves alone would make the test DOM try to follow the link and complain that it cannot. So the click is cancelled at
// the very end of its path, after the component has had its say, and what the component decided is what comes back.
const click = (target: Element, init: MouseEventInit = {}) => {
  let decided = false;
  const finish = (event: Event) => { decided = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', finish, { once: true });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  document.removeEventListener('click', finish);
  return { defaultPrevented: decided };
};

describe('LegalDocument', () => {
  describe('what is shown', () => {
    it('shows a final document with its title, date and version, and NO draft badge', async () => {
      const { el, text } = await show(detail());
      expect(el.querySelector('.card-title')?.textContent).toContain('Refund & Cancellation Policy');
      expect(text()).toContain('Last updated 25 Oct 2026 · version v1');
      expect(text()).not.toContain('Draft — for legal review');
      expect(el.querySelector('.hint-box')).toBeNull(); // the current version: no "older version" note
    });

    it('renders the Markdown: headings, bold, rules and links', async () => {
      const { el } = await show(detail());
      expect(Array.from(el.querySelectorAll('.legal-doc-body h2')).map((h) => (h.textContent || '').trim())).toEqual(['1. Cancelling Your Subscription', '5. Data After Cancellation', '6. Contact']);
      expect(el.querySelector('.legal-doc-body strong')?.textContent).toBe('Last updated:');
      expect(el.querySelectorAll('.legal-doc-body hr').length).toBe(2);
      expect(Array.from(el.querySelectorAll('.legal-doc-body a')).map((a) => a.getAttribute('href'))).toEqual([
        '/legal/privacy_policy', '/legal/data_processing_agreement', 'mailto:Support@waflowtech.com', 'https://example.com/help',
      ]);
      expect((el.querySelector('.legal-doc-body')?.textContent || '')).not.toContain('](');
    });

    it('a draft document still carries the draft badge', async () => {
      const { text } = await show(detail({ slug: 'terms_of_service', title: 'Terms of Service', version: 'draft-1', status: 'draft', body: '# Terms\n\n**DRAFT**' }), { slug: 'terms_of_service' });
      expect(text()).toContain('Draft — for legal review');
    });

    it('an older version says so, and asks the server for exactly that version', async () => {
      const { text } = await show(detail({ version: 'draft-1', isCurrentVersion: false, status: 'draft' }), { version: 'draft-1' });
      expect(text()).toContain("You're viewing version draft-1, which is no longer the current version of this document.");
      expect(text()).toContain('Draft — for legal review');
    });

    it('a document that is not there says so instead of showing an empty page', async () => {
      const { text, el } = await show(null);
      expect(text()).toContain("This document couldn't be found.");
      expect(el.querySelector('.legal-doc-body')).toBeNull();
    });
  });

  describe('links inside a document', () => {
    it('a link to another document of the app is followed inside the app (no page reload)', async () => {
      const { el, navigate } = await show(detail());
      const event = click(el.querySelector('a[href="/legal/privacy_policy"]')!);
      expect(event.defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/legal/privacy_policy');
      click(el.querySelector('a[href="/legal/data_processing_agreement"]')!);
      expect(navigate).toHaveBeenLastCalledWith('/legal/data_processing_agreement');
    });

    it('a mailto: link and an outside link keep the browser\'s own behaviour', async () => {
      const { el, navigate } = await show(detail());
      for (const href of ['mailto:Support@waflowtech.com', 'https://example.com/help']) {
        const event = click(el.querySelector(`a[href="${href}"]`)!);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(navigate).not.toHaveBeenCalled();
    });

    it('a click with a modifier key (open in a new tab) or with another mouse button is left to the browser', async () => {
      const { el, navigate } = await show(detail());
      const link = el.querySelector('a[href="/legal/privacy_policy"]')!;
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        expect(click(link, init).defaultPrevented).toBe(false);
      }
      expect(navigate).not.toHaveBeenCalled();
    });

    it('a click on plain text, a heading or the card does nothing', async () => {
      const { el, navigate } = await show(detail());
      for (const target of [el.querySelector('.legal-doc-body h2')!, el.querySelector('.legal-doc-body strong')!, el.querySelector('.legal-doc-body')!]) {
        expect(click(target).defaultPrevented).toBe(false);
      }
      expect(navigate).not.toHaveBeenCalled();
    });

    it('only the app\'s own document links count: a look-alike address is not followed inside the app', async () => {
      const body = '[ok](/legal/refund_cancellation_policy) [other](/settings) [odd](/legal/../settings) [abs](https://evil.example/legal/privacy_policy) [deep](/legal/privacy_policy/extra)';
      const { el, navigate } = await show(detail({ body }));
      const hrefs = ['/legal/refund_cancellation_policy', '/settings', '/legal/../settings', 'https://evil.example/legal/privacy_policy', '/legal/privacy_policy/extra'];
      const results = hrefs.map((h) => click(el.querySelector(`a[href="${h}"]`)!).defaultPrevented);
      expect(results).toEqual([true, false, false, false, false]);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/legal/refund_cancellation_policy');
    });
  });

  // The same click with the real router: the page stays the same component and only the address changes, so the document of the new address
  // has to be loaded into it.
  describe('following a link to another document (real router)', () => {
    it('shows the other document in the same page and moves the address with it', async () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: 'legal/:slug', component: LegalDocument }]), provideHttpClient(), provideHttpClientTesting()],
      });
      const http = TestBed.inject(HttpTestingController);
      const router = TestBed.inject(Router);
      const harness = await RouterTestingHarness.create();
      const refresh = () => { harness.fixture.componentRef.changeDetectorRef.markForCheck(); harness.detectChanges(); };

      await harness.navigateByUrl('/legal/refund_cancellation_policy');
      http.expectOne((r) => r.url.endsWith('/api/legal/documents/refund_cancellation_policy')).flush(detail());
      refresh();
      const el = harness.routeNativeElement as HTMLElement;
      expect(el.querySelector('.card-title')?.textContent).toContain('Refund & Cancellation Policy');

      const navigate = vi.spyOn(router, 'navigateByUrl');
      expect(click(el.querySelector('a[href="/legal/privacy_policy"]')!).defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/legal/privacy_policy');
      await navigate.mock.results[0].value;
      http.expectOne((r) => r.url.endsWith('/api/legal/documents/privacy_policy'))
        .flush(detail({ slug: 'privacy_policy', title: 'Privacy Policy', version: 'draft-1', status: 'draft', body: '# Privacy Policy\n\nDRAFT' }));
      refresh();
      expect(router.url).toBe('/legal/privacy_policy');
      expect(el.querySelector('.card-title')?.textContent).toContain('Privacy Policy');
      expect(el.querySelector('.legal-doc-body h1')?.textContent).toBe('Privacy Policy');
      http.verify();
    });
  });

  // Saving a copy goes through a Blob, an object URL and a click on a temporary <a download>; the test DOM has no object URLs and would try to
  // navigate on the click, so both are replaced by recorders.
  describe('saving a copy', () => {
    const originals = { create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL') };
    let blobs: Blob[];
    let saves: { href: string; name: string }[];
    let revoke: ReturnType<typeof vi.fn>;
    let anchorClick: { mockRestore(): void };

    beforeEach(() => {
      blobs = []; saves = []; revoke = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (blob: Blob) => { blobs.push(blob); return 'blob:waflow-test'; } });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });
      anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saves.push({ href: this.href, name: this.download }); });
    });

    afterEach(() => {
      anchorClick.mockRestore();
      for (const [name, descriptor] of [['createObjectURL', originals.create], ['revokeObjectURL', originals.revoke]] as const) {
        if (descriptor) Object.defineProperty(URL, name, descriptor); else delete (URL as unknown as Record<string, unknown>)[name];
      }
    });

    const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

    const saveCopy = async (el: HTMLElement) => {
      (el.querySelectorAll('.legal-doc-header button')[1] as HTMLButtonElement).click();
      expect(blobs.length).toBe(1);
      return { text: await readBlob(blobs[0]), type: blobs[0].type };
    };

    it('links to the other documents become full addresses; everything else is saved exactly as the server sent it', async () => {
      const { el } = await show(detail());
      const { text, type } = await saveCopy(el);
      const origin = window.location.origin;
      expect(type).toBe('text/markdown');
      expect(text).toBe(POLICY_BODY
        .replace('](/legal/privacy_policy)', `](${origin}/legal/privacy_policy)`)
        .replace('](/legal/data_processing_agreement)', `](${origin}/legal/data_processing_agreement)`));
      expect(text).toContain('[Support@waflowtech.com](mailto:Support@waflowtech.com)');
      expect(text).toContain('[help centre](https://example.com/help)');
      expect(text).not.toMatch(/\]\(\/legal\//);
      expect(saves).toEqual([{ href: 'blob:waflow-test', name: 'waflow-refund_cancellation_policy-v1.md' }]);
      expect(revoke).toHaveBeenCalledWith('blob:waflow-test');
    });

    it('a link to an older version keeps its query', async () => {
      const { el } = await show(detail({ body: 'See [the draft](/legal/refund_cancellation_policy?version=draft-1) and [terms](/legal/terms_of_service).' }));
      const { text } = await saveCopy(el);
      const origin = window.location.origin;
      expect(text).toBe(`See [the draft](${origin}/legal/refund_cancellation_policy?version=draft-1) and [terms](${origin}/legal/terms_of_service).`);
    });

    it('a document with no link to another document is saved byte for byte (other relative links are left alone)', async () => {
      const body = '# Terms\n\n**DRAFT**\n\nSee [help](https://example.com/help), [settings](/settings), [odd](/legal/Privacy) and the plain text /legal/privacy_policy.\n';
      const { el } = await show(detail({ slug: 'terms_of_service', title: 'Terms of Service', version: 'draft-1', status: 'draft', body }), { slug: 'terms_of_service' });
      const { text } = await saveCopy(el);
      expect(text).toBe(body);
      expect(saves).toEqual([{ href: 'blob:waflow-test', name: 'waflow-terms_of_service-draft-1.md' }]);
    });
  });
});
