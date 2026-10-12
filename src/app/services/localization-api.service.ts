import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AiAssistContext, AiInboundTranslation, AiLanguagePref, AiModeConfirmResult, AiModeInsight, AiModeSession,
  AiModeTurn, AiProductSuggestion, AiSaudiFriendlyResult, AiTextResult, BilingualOrder, CampaignCreateRequest,
  CampaignPlan, CampaignPlanRequest, CampaignRecipientRow, CampaignReport, CampaignStatus, CatalogImportResult,
  CatalogKind, CatalogList, CatalogTranslation, CatalogTranslationLookup, CustomerLang, CustomerLanguageList, CustomerLanguageRow,
  FlowMessageRow, FlowOwnerTree, FlowOwnerType, FlowTreeRow, FollowUpSaveInput, FollowUpView, InboxActionResult, InboxContext, InboxConversation, LanguageImportResult, LibraryEntry, Lang,
  LocalizationSettings, LocalizedCampaignView, LocalizedTemplate, MessageLanguage, MyLanguagePrefs, OverviewSummary,
  Page, PromotionSendPlan, PromotionTestSendResult, PromotionTreesResponse, RenderedPreview, ReviewStatus, ReviewSummary, SegmentOption, SendStatus,
  SenderKind, SenderSendPlan, SubmitResult, TemplateButton, TemplateCategory, TemplateUseCase, TemplatesUsage, VariantInput,
  VariantValidation,
} from '../pages/localization/localization.types';

const API = `${environment.apiBaseUrl}/api/localization`;

// Every id/key that ends up inside a URL path is encoded, so a stray / ? # in a value can never change which route is hit.
const seg = (v: string): string => encodeURIComponent(v);

function query(params: Record<string, string | number | boolean | null | undefined>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  }
  return p;
}

// Dedicated client for the Arabic localisation feature — kept separate from
// ApiService so the feature stays entirely in its own set of files (same
// pattern as inbox-api / entitlements-api / referrals-api / instagram-api).
// Every endpoint except /settings answers 402 { code: 'ARABIC_NOT_ENABLED' }
// until Waflow staff switch the merchant on.
@Injectable({ providedIn: 'root' })
export class LocalizationApiService {
  constructor(private http: HttpClient) {}

  // ── Settings & overview ──────────────────────────────────────────────────
  getSettings(): Observable<LocalizationSettings> {
    return this.http.get<LocalizationSettings>(`${API}/settings`);
  }
  updateSettings(patch: { defaultCustomerLanguage?: Lang; bilingualOrder?: BilingualOrder }): Observable<LocalizationSettings> {
    return this.http.put<LocalizationSettings>(`${API}/settings`, patch);
  }
  getMyPrefs(): Observable<MyLanguagePrefs> {
    return this.http.get<MyLanguagePrefs>(`${API}/settings/me`);
  }
  updateMyPrefs(patch: { uiLanguage?: Lang; aiLanguage?: AiLanguagePref }): Observable<MyLanguagePrefs> {
    return this.http.put<MyLanguagePrefs>(`${API}/settings/me`, patch);
  }
  getOverview(): Observable<OverviewSummary> {
    return this.http.get<OverviewSummary>(`${API}/settings/overview`);
  }

  // ── Customers' languages ─────────────────────────────────────────────────
  listCustomers(params: { search?: string; language?: CustomerLang | 'all'; page?: number; limit?: number } = {}): Observable<CustomerLanguageList> {
    return this.http.get<CustomerLanguageList>(`${API}/customers`, { params: query(params) });
  }
  setCustomerLanguage(customerId: string, language: CustomerLang): Observable<CustomerLanguageRow> {
    return this.http.put<CustomerLanguageRow>(`${API}/customers/${seg(customerId)}/language`, { language });
  }
  bulkSetCustomerLanguage(customerIds: string[], language: CustomerLang): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>(`${API}/customers/language/bulk`, { customerIds, language });
  }
  importCustomerLanguages(file: File, dryRun: boolean): Observable<LanguageImportResult> {
    const form = new FormData();
    form.append('dryRun', String(dryRun));
    form.append('file', file);
    return this.http.post<LanguageImportResult>(`${API}/customers/language/import`, form);
  }
  languageTemplateCsv(): Observable<Blob> {
    return this.http.get(`${API}/customers/language/template.csv`, { responseType: 'blob' });
  }
  exportCustomerLanguagesCsv(): Observable<Blob> {
    return this.http.get(`${API}/customers/language/export.csv`, { responseType: 'blob' });
  }

  // ── Templates (one variant per language, each with its own Meta approval) ─
  listTemplates(params: { search?: string; useCase?: TemplateUseCase; archived?: boolean } = {}): Observable<{ items: LocalizedTemplate[] }> {
    return this.http.get<{ items: LocalizedTemplate[] }>(`${API}/templates`, { params: query(params) });
  }
  // How many of WhatsApp's 250 template slots are used and the ceiling at which we stop submitting.
  getTemplatesUsage(): Observable<TemplatesUsage> {
    return this.http.get<TemplatesUsage>(`${API}/templates/meta-usage`);
  }
  getTemplateLibrary(): Observable<{ items: LibraryEntry[] }> {
    return this.http.get<{ items: LibraryEntry[] }>(`${API}/templates/library`);
  }
  createTemplate(body: {
    name: string; useCase?: TemplateUseCase; category?: TemplateCategory; linkedPromotionId?: string;
    variants?: Array<VariantInput & { language: MessageLanguage }>;
  }): Observable<LocalizedTemplate> {
    return this.http.post<LocalizedTemplate>(`${API}/templates`, body);
  }
  createTemplateFromLibrary(libraryKey: string, name?: string): Observable<LocalizedTemplate> {
    return this.http.post<LocalizedTemplate>(`${API}/templates/from-library`, { libraryKey, name });
  }
  getTemplate(id: string): Observable<LocalizedTemplate> {
    return this.http.get<LocalizedTemplate>(`${API}/templates/${seg(id)}`);
  }
  updateTemplate(id: string, patch: { name?: string; useCase?: TemplateUseCase; category?: TemplateCategory }): Observable<LocalizedTemplate> {
    return this.http.put<LocalizedTemplate>(`${API}/templates/${seg(id)}`, patch);
  }
  archiveTemplate(id: string, archived = true): Observable<LocalizedTemplate> {
    return this.http.post<LocalizedTemplate>(`${API}/templates/${seg(id)}/${archived ? 'archive' : 'unarchive'}`, {});
  }
  saveVariant(id: string, language: MessageLanguage, variant: VariantInput): Observable<LocalizedTemplate> {
    return this.http.put<LocalizedTemplate>(`${API}/templates/${seg(id)}/variants/${seg(language)}`, variant);
  }
  validateVariant(id: string, language: MessageLanguage, variant?: VariantInput): Observable<VariantValidation> {
    return this.http.post<VariantValidation>(`${API}/templates/${seg(id)}/variants/${seg(language)}/validate`, variant ?? {});
  }
  submitVariant(id: string, language: MessageLanguage): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(`${API}/templates/${seg(id)}/variants/${seg(language)}/submit`, {});
  }
  reviewVariant(id: string, language: MessageLanguage, status: ReviewStatus): Observable<LocalizedTemplate> {
    return this.http.post<LocalizedTemplate>(`${API}/templates/${seg(id)}/variants/${seg(language)}/review`, { status });
  }
  testSendVariant(id: string, language: MessageLanguage, phone: string): Observable<{ sent: boolean; dryRun: boolean }> {
    return this.http.post<{ sent: boolean; dryRun: boolean }>(`${API}/templates/${seg(id)}/variants/${seg(language)}/test-send`, { phone });
  }
  refreshTemplateStatuses(templateId?: string): Observable<{ checked: number; changed: number }> {
    return this.http.post<{ checked: number; changed: number }>(`${API}/templates/refresh-status`, templateId ? { templateId } : {});
  }
  // Server-rendered preview (exactly what would be sent: merge fields, bidi marks, bilingual order).
  previewVariant(body: {
    variant: VariantInput & { language: MessageLanguage }; fieldValues?: Record<string, string>; customerId?: string;
  }): Observable<RenderedPreview> {
    return this.http.post<RenderedPreview>(`${API}/templates/preview`, body);
  }

  // ── Campaigns ────────────────────────────────────────────────────────────
  getSegments(): Observable<{ items: SegmentOption[] }> {
    return this.http.get<{ items: SegmentOption[] }>(`${API}/campaigns/segments`);
  }
  planCampaign(body: CampaignPlanRequest): Observable<CampaignPlan> {
    return this.http.post<CampaignPlan>(`${API}/campaigns/plan`, body);
  }
  createCampaign(body: CampaignCreateRequest): Observable<LocalizedCampaignView> {
    return this.http.post<LocalizedCampaignView>(`${API}/campaigns`, body);
  }
  listCampaigns(params: { status?: CampaignStatus; page?: number; limit?: number } = {}): Observable<Page<LocalizedCampaignView>> {
    return this.http.get<Page<LocalizedCampaignView>>(`${API}/campaigns`, { params: query(params) });
  }
  getCampaign(id: string): Observable<LocalizedCampaignView> {
    return this.http.get<LocalizedCampaignView>(`${API}/campaigns/${seg(id)}`);
  }
  sendCampaign(id: string, acknowledge: { fallbacks?: boolean; blocked?: boolean } = {}): Observable<{ campaign: LocalizedCampaignView }> {
    return this.http.post<{ campaign: LocalizedCampaignView }>(`${API}/campaigns/${seg(id)}/send`, { acknowledge });
  }
  cancelCampaign(id: string): Observable<LocalizedCampaignView> {
    return this.http.post<LocalizedCampaignView>(`${API}/campaigns/${seg(id)}/cancel`, {});
  }
  getCampaignRecipients(id: string, params: { status?: SendStatus; language?: MessageLanguage; page?: number; limit?: number } = {}): Observable<Page<CampaignRecipientRow>> {
    return this.http.get<Page<CampaignRecipientRow>>(`${API}/campaigns/${seg(id)}/recipients`, { params: query(params) });
  }
  getCampaignReport(id: string): Observable<CampaignReport> {
    return this.http.get<CampaignReport>(`${API}/campaigns/${seg(id)}/report`);
  }

  // ── AI assist: DRAFTS only — never auto-applied, never auto-sent ──────────
  aiTranslate(body: { text: string; from?: Lang | 'auto'; to: Lang; context?: AiAssistContext; maxLength?: number }): Observable<AiTextResult> {
    return this.http.post<AiTextResult>(`${API}/ai/translate`, body);
  }
  aiSaudiFriendly(body: { text: string; buttons?: string[]; context?: AiAssistContext; maxLength?: number }): Observable<AiSaudiFriendlyResult> {
    return this.http.post<AiSaudiFriendlyResult>(`${API}/ai/saudi-friendly`, body);
  }
  aiReplyInArabic(body: { englishText: string; customerMessage?: string; customerName?: string }): Observable<AiTextResult> {
    return this.http.post<AiTextResult>(`${API}/ai/reply-in-arabic`, body);
  }
  aiTranslateInbound(text: string): Observable<AiInboundTranslation> {
    return this.http.post<AiInboundTranslation>(`${API}/ai/translate-inbound`, { text });
  }
  aiSuggestProductTranslation(body: { name: string; description?: string }): Observable<AiProductSuggestion> {
    return this.http.post<AiProductSuggestion>(`${API}/ai/suggest-product-translation`, body);
  }

  // ── Catalogue translations ───────────────────────────────────────────────
  listCatalogItems(params: { kind?: CatalogKind | 'all'; search?: string; status?: 'missing' | 'draft' | 'reviewed' | 'all'; page?: number; limit?: number } = {}): Observable<CatalogList> {
    return this.http.get<CatalogList>(`${API}/catalog/items`, { params: query(params) });
  }
  saveCatalogTranslation(kind: CatalogKind, refId: string, body: { name: string; description?: string; source?: 'merchant' | 'ai' }): Observable<CatalogTranslation> {
    return this.http.put<CatalogTranslation>(`${API}/catalog/${seg(kind)}/${seg(refId)}/translation`, body);
  }
  reviewCatalogTranslation(kind: CatalogKind, refId: string, status: ReviewStatus): Observable<CatalogTranslation> {
    return this.http.post<CatalogTranslation>(`${API}/catalog/${seg(kind)}/${seg(refId)}/translation/review`, { status });
  }
  exportCatalogCsv(): Observable<Blob> {
    return this.http.get(`${API}/catalog/export.csv`, { responseType: 'blob' });
  }
  importCatalogCsv(file: File, dryRun: boolean): Observable<CatalogImportResult> {
    const form = new FormData();
    form.append('dryRun', String(dryRun));
    form.append('file', file);
    return this.http.post<CatalogImportResult>(`${API}/catalog/import`, form);
  }

  // ── Inbox (the list/thread/snapshot reuse InboxApiService unchanged) ──────
  searchConversations(params: { filter?: string; search?: string } = {}): Observable<{ conversations: InboxConversation[] }> {
    return this.http.get<{ conversations: InboxConversation[] }>(`${API}/inbox/conversations`, { params: query(params) });
  }
  getInboxContext(customerId: string): Observable<InboxContext> {
    return this.http.get<InboxContext>(`${API}/inbox/conversations/${seg(customerId)}/context`);
  }
  sendLocalizedPaymentLink(customerId: string, amount: number): Observable<InboxActionResult> {
    return this.http.post<InboxActionResult>(`${API}/inbox/conversations/${seg(customerId)}/payment-link`, { amount });
  }
  sendLocalizedLoyaltyReminder(customerId: string): Observable<InboxActionResult> {
    return this.http.post<InboxActionResult>(`${API}/inbox/conversations/${seg(customerId)}/loyalty-reminder`, {});
  }

  // ── AI Mode (Arabic) ─────────────────────────────────────────────────────
  aiModeMessage(body: { sessionId: string; message: string; language?: AiLanguagePref }): Observable<AiModeTurn> {
    return this.http.post<AiModeTurn>(`${API}/ai-mode/message`, body);
  }
  aiModeConfirm(body: { sessionId: string; actionId: string; confirm: boolean }): Observable<AiModeConfirmResult> {
    return this.http.post<AiModeConfirmResult>(`${API}/ai-mode/confirm`, body);
  }
  aiModeSession(sessionId: string): Observable<AiModeSession> {
    return this.http.get<AiModeSession>(`${API}/ai-mode/session/${seg(sessionId)}`);
  }
  aiModeInsights(language: Lang): Observable<{ items: AiModeInsight[] }> {
    return this.http.get<{ items: AiModeInsight[] }>(`${API}/ai-mode/insights`, { params: query({ language }) });
  }

  // ── Automated Flows overlay (per-language text + approval for flow messages) ──
  listFlowMessages(): Observable<{ items: FlowMessageRow[] }> {
    return this.http.get<{ items: FlowMessageRow[] }>(`${API}/flows/messages`);
  }
  localizeFlowMessage(messageNodeId: string): Observable<LocalizedTemplate> {
    return this.http.post<LocalizedTemplate>(`${API}/flows/messages/${seg(messageNodeId)}/localize`, {});
  }
  // Full message trees (entry + follow-ups) with per-language versions, for every flow / for one flow or promotion.
  listFlowTrees(): Observable<{ items: FlowTreeRow[] }> {
    return this.http.get<{ items: FlowTreeRow[] }>(`${API}/flows/tree`);
  }
  // Promotions with their own entry message that no flow sends (their trees are not in listFlowTrees).
  listPromotionTrees(): Observable<PromotionTreesResponse> {
    return this.http.get<PromotionTreesResponse>(`${API}/flows/promotion-trees`);
  }
  getFlowOwnerTree(ownerType: FlowOwnerType, ownerId: string): Observable<FlowOwnerTree> {
    return this.http.get<FlowOwnerTree>(`${API}/flows/owners/${seg(ownerType)}/${seg(ownerId)}/tree`);
  }
  // Arabic version of a follow-up reply (free reply: native review only, no Meta approval).
  getFollowUp(messageNodeId: string): Observable<FollowUpView> {
    return this.http.get<FollowUpView>(`${API}/flows/followups/${seg(messageNodeId)}`);
  }
  saveFollowUp(messageNodeId: string, body: FollowUpSaveInput): Observable<FollowUpView> {
    return this.http.put<FollowUpView>(`${API}/flows/followups/${seg(messageNodeId)}/variants/ar`, body);
  }
  reviewFollowUp(messageNodeId: string, status: ReviewStatus, contentVersion: number): Observable<FollowUpView> {
    return this.http.post<FollowUpView>(`${API}/flows/followups/${seg(messageNodeId)}/variants/ar/review`, { status, contentVersion });
  }

  // ── Language plan / test for the existing Promotions, loyalty-reminder and consent screens ──
  // Read-only: what each selected customer would receive in the legacy send (never gates it).
  getPromotionSendPlan(promotionId: string, customerIds: string[], includeIds = false): Observable<PromotionSendPlan> {
    return this.http.post<PromotionSendPlan>(`${API}/promotions/${seg(promotionId)}/send-plan`, { customerIds, includeIds });
  }
  getSenderPlan(sender: SenderKind, customerIds?: string[]): Observable<SenderSendPlan> {
    return this.http.post<SenderSendPlan>(`${API}/senders/${seg(sender)}/plan`, customerIds ? { customerIds } : {});
  }
  testSendPromotionArabic(promotionId: string, phone: string): Observable<PromotionTestSendResult> {
    return this.http.post<PromotionTestSendResult>(`${API}/promotions/${seg(promotionId)}/test-send`, { phone, language: 'ar' });
  }

  // ── Single-item lookups for the profile / product / service forms (read-only) ──
  getCustomerLanguage(customerId: string): Observable<CustomerLanguageRow> {
    return this.http.get<CustomerLanguageRow>(`${API}/customers/${seg(customerId)}/language`);
  }
  getCatalogTranslation(kind: CatalogKind, refId: string): Observable<CatalogTranslationLookup> {
    return this.http.get<CatalogTranslationLookup>(`${API}/catalog/${seg(kind)}/${seg(refId)}/translation`);
  }

  // ── Review (native-review counts) ────────────────────────────────────────
  getReviewSummary(): Observable<ReviewSummary> {
    return this.http.get<ReviewSummary>(`${API}/review/summary`);
  }
}

export type { TemplateButton };
