import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LegalApiService, LegalDocumentSummary, LegalAcceptanceStatus, LegalDocumentSlug } from '../../../services/legal-api.service';

@Component({
  selector: 'app-legal-section',
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './legal-section.html',
  styleUrl: './legal-section.css',
})
export class LegalSection implements OnInit {
  documents: LegalDocumentSummary[] = [];
  loading = false;
  status: LegalAcceptanceStatus | null = null;

  constructor(private legalApi: LegalApiService) {}

  ngOnInit() {
    this.loading = true;
    this.legalApi.getDocuments().subscribe({
      next: (docs) => { this.documents = docs; this.loading = false; },
      error: () => { this.loading = false; },
    });
    this.legalApi.getAcceptanceStatus().subscribe({
      next: (s) => { this.status = s; },
      error: () => {},
    });
  }

  // Personal acceptance (ToS/Privacy/AUP) — null for a document this page
  // doesn't track acceptance for (currently just the Refund & Cancellation
  // Policy, which has no acceptance step per the spec).
  combinedInfoFor(slug: LegalDocumentSlug) {
    return this.status?.combined.documents.find((d) => d.slug === slug) || null;
  }

  isDpa(slug: LegalDocumentSlug): boolean {
    return slug === 'data_processing_agreement';
  }
}
