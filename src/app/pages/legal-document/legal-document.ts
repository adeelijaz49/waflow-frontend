import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
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

  constructor(private route: ActivatedRoute, private legalApi: LegalApiService, private sanitizer: DomSanitizer, private location: Location) {}

  goBack() {
    this.location.back();
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
    const blob = new Blob([this.doc.body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waflow-${this.doc.slug}-${this.doc.version}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
