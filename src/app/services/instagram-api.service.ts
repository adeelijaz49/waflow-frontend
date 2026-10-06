import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE = environment.apiBaseUrl;
const POSTS_API = `${BASE}/api/instagram-posts`;
const MEDIA_API = `${BASE}/api/instagram-media`;
const SOCIAL_API = `${BASE}/api/social-accounts`;

// Dedicated client for the Instagram Promotion Scheduler feature — kept
// separate from ApiService, same pattern as the other recent features.
@Injectable({ providedIn: 'root' })
export class InstagramApiService {
  constructor(private http: HttpClient) {}

  // ── Entitlement ──────────────────────────────────────────────────────────
  getEntitlement(): Observable<{ enabled: boolean; grantedAt: string | null }> {
    return this.http.get<{ enabled: boolean; grantedAt: string | null }>(`${POSTS_API}/entitlement`);
  }

  // ── Social account ────────────────────────────────────────────────────────
  getAccountStatus(): Observable<any> {
    return this.http.get(`${SOCIAL_API}/instagram/status`);
  }
  getConnectUrl(): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${SOCIAL_API}/instagram/connect-url`);
  }
  disconnect(): Observable<any> {
    return this.http.post(`${SOCIAL_API}/instagram/disconnect`, {});
  }

  // ── Posts ─────────────────────────────────────────────────────────────────
  getPosts(status?: string): Observable<any[]> {
    return this.http.get<any[]>(`${POSTS_API}/posts`, { params: status ? { status } : {} });
  }
  createPost(data: any): Observable<any> {
    return this.http.post(`${POSTS_API}/posts`, data);
  }
  getPost(id: string): Observable<any> {
    return this.http.get(`${POSTS_API}/posts/${id}`);
  }
  updatePost(id: string, data: any): Observable<any> {
    return this.http.put(`${POSTS_API}/posts/${id}`, data);
  }
  duplicatePost(id: string): Observable<any> {
    return this.http.post(`${POSTS_API}/posts/${id}/duplicate`, {});
  }
  cancelPost(id: string): Observable<any> {
    return this.http.post(`${POSTS_API}/posts/${id}/cancel`, {});
  }
  schedulePost(id: string, scheduledAt: string): Observable<any> {
    return this.http.post(`${POSTS_API}/posts/${id}/schedule`, { scheduledAt });
  }
  publishNow(id: string): Observable<any> {
    return this.http.post(`${POSTS_API}/posts/${id}/publish-now`, {});
  }

  // ── AI content ────────────────────────────────────────────────────────────
  generateContent(id: string, businessName?: string): Observable<{ caption: string; shortCaption: string; hashtags: string[]; whatsappCta: string }> {
    return this.http.post<{ caption: string; shortCaption: string; hashtags: string[]; whatsappCta: string }>(`${POSTS_API}/posts/${id}/generate-content`, { businessName });
  }
  refineContent(currentCaption: string, instruction: string): Observable<{ caption: string }> {
    return this.http.post<{ caption: string }>(`${POSTS_API}/refine-content`, { currentCaption, instruction });
  }

  // ── Reporting ─────────────────────────────────────────────────────────────
  getReport(id: string): Observable<any> {
    return this.http.get(`${POSTS_API}/posts/${id}/report`);
  }
  getJobs(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${POSTS_API}/posts/${id}/jobs`);
  }

  // ── Media upload ──────────────────────────────────────────────────────────
  uploadMedia(file: File): Observable<{ url: string; mediaType: 'image' | 'video' }> {
    const form = new FormData();
    form.append('media', file);
    return this.http.post<{ url: string; mediaType: 'image' | 'video' }>(`${MEDIA_API}/upload`, form);
  }
}
