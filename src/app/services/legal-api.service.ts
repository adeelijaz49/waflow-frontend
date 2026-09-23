import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const API  = `${BASE}/api/legal`;

export type LegalDocumentSlug =
  | 'terms_of_service'
  | 'privacy_policy'
  | 'acceptable_use_policy'
  | 'data_processing_agreement'
  | 'refund_cancellation_policy';

export interface LegalDocumentSummary {
  slug: LegalDocumentSlug;
  title: string;
  currentVersion: string;
  effectiveDate: string;
  status: 'draft' | 'final';
}

export interface LegalDocumentDetail {
  slug: LegalDocumentSlug;
  title: string;
  version: string;
  isCurrentVersion: boolean;
  effectiveDate: string;
  status: 'draft' | 'final';
  body: string;
}

export interface LegalDocumentAcceptanceInfo {
  slug: LegalDocumentSlug;
  title: string;
  currentVersion: string;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
}

export interface DpaAcceptanceInfo extends LegalDocumentAcceptanceInfo {
  summary: string;
  acceptedByUserId: string | null;
}

export interface LegalAcceptanceStatus {
  requiresCombinedAcceptance: boolean;
  requiresDpaAcceptance: boolean;
  combined: { documents: LegalDocumentAcceptanceInfo[] };
  dpa: DpaAcceptanceInfo;
}

// Dedicated client for the Legal Documents feature — kept separate from
// ApiService so it stays entirely in its own set of files, same as
// EntitlementsApiService/InboxApiService do for their own features.
@Injectable({ providedIn: 'root' })
export class LegalApiService {
  constructor(private http: HttpClient) {}

  getDocuments(): Observable<LegalDocumentSummary[]> {
    return this.http.get<LegalDocumentSummary[]>(`${API}/documents`);
  }

  getDocument(slug: LegalDocumentSlug, version?: string): Observable<LegalDocumentDetail> {
    return this.http.get<LegalDocumentDetail>(`${API}/documents/${slug}`, { params: version ? { version } : {} });
  }

  getAcceptanceStatus(): Observable<LegalAcceptanceStatus> {
    return this.http.get<LegalAcceptanceStatus>(`${API}/acceptance-status`);
  }

  acceptCombined(): Observable<LegalAcceptanceStatus> {
    return this.http.post<LegalAcceptanceStatus>(`${API}/accept/combined`, {});
  }

  acceptDpa(): Observable<LegalAcceptanceStatus> {
    return this.http.post<LegalAcceptanceStatus>(`${API}/accept/dpa`, {});
  }
}
