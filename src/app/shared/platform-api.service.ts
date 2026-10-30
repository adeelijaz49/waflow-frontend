import { HttpClient, HttpContext, HttpContextToken, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Set on a request that must NOT sign the person out when it answers 401 (the best-effort "exit customer" call:
// an expired act-as token must not also throw away the parked home token). Read by the auth interceptor.
export const SKIP_AUTO_LOGOUT = new HttpContextToken<boolean>(() => false);

export interface WhatsAppStatus {
  mode: 'platform' | 'own';
  phoneIdLast4: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  tokenConfigured: boolean;
  // Optional: shown as "Token saved ending 1234" when the server provides it. The token itself is never returned.
  tokenLast4?: string | null;
  tokenIsValid: boolean | null;
  checkedAt: string | null;
  enabled: boolean;
}

// Whether Meta has the number registered on the WhatsApp Business Platform. `status` is Meta's own word (CONNECTED,
// PENDING, ...) or null when it did not say; `registered` is true/false only when we know, null otherwise.
export interface Registration { status: string | null; registered: boolean | null }

// The one shared WaFlow number that customers without their own number send from.
export interface PlatformNumber {
  phoneIdLast4: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  registered: boolean | null;
  // A plain sentence about a problem with the number, or null when there is none.
  message: string | null;
  checkedAt: string;
}

export interface TenantOwner { userId: string; name: string; contactMasked: string }

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
  isPlatformDefault: boolean;
  owners: TenantOwner[];
  memberCount: number;
  customerCount: number;
  plan: { code: string; status: string } | null;
  arabicEnabled: boolean;
  whatsapp: WhatsAppStatus;
}

export interface TenantMember { userId: string; name: string; contactMasked: string; role: 'owner' | 'member'; createdAt: string }

export interface TenantCounts { customers: number; products: number; services: number; promotions: number }

export interface CreateTenantBody {
  name: string;
  ownerContactType: 'phone' | 'email';
  ownerContact: string;
  ownerName?: string;
  currency?: string;
  defaultCountryCode?: string;
}

export interface CreateTenantResult {
  tenant: Tenant;
  owner: { userId: string; created: boolean };
  signInHint?: string;
}

export interface AddMemberBody { contactType: 'phone' | 'email'; contact: string; name?: string; role: 'owner' | 'member' }

export interface SetWhatsAppBody { phoneId: string; wabaId?: string; accessToken?: string; verify?: boolean }

export interface EnterTenantResult { token: string; workspace: { id: string; name: string }; expiresAt: string }

export interface AuditEntry {
  id?: string;
  _id?: string;
  actorLabel?: string;
  action: string;
  workspaceId?: string | null;
  detail?: Record<string, unknown> | null;
  createdAt: string;
}

// The platform (super admin) API, section 4.2 of the build contract. Everything here answers 403 unless the
// signed-in person is a super admin who is not currently inside a customer.
@Injectable({ providedIn: 'root' })
export class PlatformApiService {
  private readonly base = `${environment.apiBaseUrl}/api/platform`;

  constructor(private http: HttpClient) {}

  listTenants(search?: string): Observable<{ tenants: Tenant[] }> {
    let params = new HttpParams();
    const q = (search || '').trim();
    if (q) params = params.set('search', q);
    return this.http.get<{ tenants: Tenant[] }>(`${this.base}/tenants`, { params });
  }

  createTenant(body: CreateTenantBody): Observable<CreateTenantResult> {
    return this.http.post<CreateTenantResult>(`${this.base}/tenants`, body);
  }

  getTenant(id: string): Observable<{ tenant: Tenant; members: TenantMember[]; counts: TenantCounts }> {
    return this.http.get<{ tenant: Tenant; members: TenantMember[]; counts: TenantCounts }>(`${this.base}/tenants/${encodeURIComponent(id)}`);
  }

  renameTenant(id: string, name: string): Observable<{ tenant: Tenant }> {
    return this.http.patch<{ tenant: Tenant }>(`${this.base}/tenants/${encodeURIComponent(id)}`, { name });
  }

  addMember(id: string, body: AddMemberBody): Observable<{ member: TenantMember; created: boolean }> {
    return this.http.post<{ member: TenantMember; created: boolean }>(`${this.base}/tenants/${encodeURIComponent(id)}/members`, body);
  }

  // The token travels in the request body only (HTTPS, never in a URL) and is never returned.
  // `registration` is present whenever Meta was asked; `message` is a warning worth showing (see verifyWhatsApp).
  setWhatsApp(id: string, body: SetWhatsAppBody): Observable<{ whatsapp: WhatsAppStatus; registration?: Registration; message?: string }> {
    return this.http.put<{ whatsapp: WhatsAppStatus; registration?: Registration; message?: string }>(`${this.base}/tenants/${encodeURIComponent(id)}/whatsapp`, body);
  }

  // `message` is why a check failed (the token expired, the number was not found, ...) or that the number is not
  // registered with WhatsApp yet; absent when all is well.
  verifyWhatsApp(id: string): Observable<{ whatsapp: WhatsAppStatus; registration?: Registration; message?: string }> {
    return this.http.post<{ whatsapp: WhatsAppStatus; registration?: Registration; message?: string }>(`${this.base}/tenants/${encodeURIComponent(id)}/whatsapp/verify`, {});
  }

  // The shared platform number's state; `fresh` asks the server to look at Meta again (for "Check again").
  platformNumber(fresh = false): Observable<{ number: PlatformNumber }> {
    let params = new HttpParams();
    if (fresh) params = params.set('fresh', '1');
    return this.http.get<{ number: PlatformNumber }>(`${this.base}/whatsapp/platform-number`, { params });
  }

  clearWhatsApp(id: string): Observable<{ whatsapp: WhatsAppStatus }> {
    return this.http.delete<{ whatsapp: WhatsAppStatus }>(`${this.base}/tenants/${encodeURIComponent(id)}/whatsapp`);
  }

  enter(id: string): Observable<EnterTenantResult> {
    return this.http.post<EnterTenantResult>(`${this.base}/tenants/${encodeURIComponent(id)}/enter`, {});
  }

  // Needs the act-as token (the interceptor attaches whatever token is stored at the time).
  exit(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/exit`, {}, { context: new HttpContext().set(SKIP_AUTO_LOGOUT, true) });
  }

  audit(opts: { tenantId?: string; limit?: number } = {}): Observable<{ entries: AuditEntry[] }> {
    let params = new HttpParams();
    if (opts.tenantId) params = params.set('tenantId', opts.tenantId);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http.get<{ entries: AuditEntry[] }>(`${this.base}/audit`, { params });
  }
}
