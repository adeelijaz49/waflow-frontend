import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { LegalApiService, LegalDocumentDetail, LegalDocumentSlug } from '../../services/legal-api.service';

// The first use of [innerHTML]/DomSanitizer in this app — deliberately scoped
// to exactly one source: our own authored Markdown in
// waflow-backend/shared/legalDocuments.js, never user input.
@Component({
  selector: 'app-legal-document',
  imports: [CommonModule, DatePipe],
  templateUrl: './legal-document.html',
  styleUrl: './legal-document.css',
})
export class LegalDocument implements OnInit {
  doc: LegalDocumentDetail | null = null;
  html: SafeHtml | null = null;
  loading = false;
  notFound = false;
  requestedVersion: string | null = null;

  constructor(private route: ActivatedRoute, private router: Router, private legalApi: LegalApiService, private sanitizer: DomSanitizer, private location: Location) {}

  goBack() {
    this.location.back();
  }

  // The body is HTML made from Markdown, so its links are plain <a href>. A link to another document of the app ("/legal/privacy_policy",
  // as the Refund & Cancellation Policy has) is followed inside the app, without reloading the page; everything else (mailto:, https:, a
  // click with a modifier key) keeps the browser's own behaviour.
  onBodyClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a');
    const href = anchor?.getAttribute('href') || '';
    if (!anchor || !/^\/legal\/[a-z_]+(\?.*)?$/.test(href)) return;
    event.preventDefault();
    this.router.navigateByUrl(href);
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') as LegalDocumentSlug;
      this.requestedVersion = this.route.snapshot.queryParamMap.get('version');
      this.load(slug, this.requestedVersion || undefined);
    });
  }

  private load(slug: LegalDocumentSlug, version?: string) {
    this.loading = true;
    this.notFound = false;
    this.doc = null;
    this.legalApi.getDocument(slug, version).subscribe({
      next: (doc) => {
        this.doc = doc;
        this.html = this.sanitizer.bypassSecurityTrustHtml(marked.parse(doc.body, { async: false }) as string);
        this.loading = false;
      },
      error: () => { this.loading = false; this.notFound = true; },
    });
  }

  download() {
    if (!this.doc) return;
    // A saved copy is read outside the app, where "/legal/privacy_policy" leads nowhere: the links to the other documents become full addresses.
    const body = this.doc.body.replace(/\]\((\/legal\/[a-z_]+(?:\?[^)\s]*)?)\)/g, (_link, path: string) => `](${window.location.origin}${path})`);
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waflow-${this.doc.slug}-${this.doc.version}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
