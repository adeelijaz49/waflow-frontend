import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import {
  AuditEntry, PlatformApiService, Tenant, TenantCounts, TenantMember, WhatsAppStatus,
} from '../../../shared/platform-api.service';
import { TenantWhatsappForm } from '../tenant-whatsapp-form/tenant-whatsapp-form';
import { auditActionLabel, validOwnerContact, whatsappLabel } from '../platform-format';

// One customer: overview, who can sign in to it, its WhatsApp number (the card where the customer's own number is
// entered) and what staff have done to it.
@Component({
  selector: 'app-tenant-detail',
  imports: [FormsModule, DatePipe, RouterLink, TenantWhatsappForm],
  templateUrl: './tenant-detail.html',
  styleUrl: './tenant-detail.css',
})
export class TenantDetail implements OnInit {
  id = '';
  tenant: Tenant | null = null;
  members: TenantMember[] = [];
  counts: TenantCounts | null = null;
  loading = true;
  error: string | null = null;

  // rename
  editingName = false;
  nameDraft = '';
  nameError: string | null = null;
  renaming = false;

  // add a person
  memberContactType: 'phone' | 'email' = 'phone';
  memberContact = '';
  memberName = '';
  memberRole: 'owner' | 'member' = 'owner';
  memberSubmitted = false;
  memberSaving = false;
  memberError: string | null = null;
  memberNotice: string | null = null;

  // audit
  audit: AuditEntry[] = [];
  auditLoading = true;
  auditError = false;

  entering = false;

  readonly whatsappLabel = whatsappLabel;
  readonly auditActionLabel = auditActionLabel;

  constructor(
    private route: ActivatedRoute,
    private api: PlatformApiService,
    private auth: AuthService,
    private dialog: DialogService,
  ) {}

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    this.load();
    this.loadAudit();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.getTenant(this.id).subscribe({
      next: (res) => {
        this.tenant = res.tenant;
        this.members = res.members || [];
        this.counts = res.counts || null;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.status === 404 ? 'This customer was not found.' : (err?.error?.error || 'Could not load this customer. Please try again.');
      },
    });
  }

  loadAudit(): void {
    this.auditLoading = true;
    this.auditError = false;
    this.api.audit({ tenantId: this.id, limit: 25 }).subscribe({
      next: (res) => { this.audit = res?.entries || []; this.auditLoading = false; },
      error: () => { this.auditLoading = false; this.auditError = true; },
    });
  }

  // ---- rename ----
  startRename(): void {
    this.nameDraft = this.tenant?.name || '';
    this.nameError = null;
    this.editingName = true;
  }

  cancelRename(): void {
    this.editingName = false;
  }

  saveRename(): void {
    const name = this.nameDraft.trim();
    if (name.length < 2) { this.nameError = 'Enter the customer\'s business name.'; return; }
    if (this.renaming || !this.tenant) return;
    if (name === this.tenant.name) { this.editingName = false; return; }
    this.renaming = true;
    this.nameError = null;
    this.api.renameTenant(this.id, name).subscribe({
      next: (res) => {
        this.renaming = false;
        this.editingName = false;
        if (this.tenant) this.tenant = { ...this.tenant, ...res.tenant };
        this.loadAudit();
      },
      error: (err) => {
        this.renaming = false;
        this.nameError = err?.error?.error || 'Could not rename. Please try again.';
      },
    });
  }

  // ---- people ----
  get memberContactError(): string | null {
    if (!this.memberContact.trim()) return this.memberContactType === 'email' ? 'Enter an email address.' : 'Enter a phone number.';
    if (!validOwnerContact(this.memberContactType, this.memberContact)) {
      return this.memberContactType === 'email' ? 'That does not look like an email address.' : 'That does not look like a phone number (8 to 15 digits, with country code).';
    }
    return null;
  }

  onMemberTypeChange(): void {
    this.memberContact = '';
    this.memberError = null;
  }

  addMember(): void {
    this.memberSubmitted = true;
    this.memberError = null;
    this.memberNotice = null;
    if (this.memberSaving || this.memberContactError) return;
    const body = {
      contactType: this.memberContactType,
      contact: this.memberContact.trim(),
      role: this.memberRole,
      ...(this.memberName.trim() ? { name: this.memberName.trim() } : {}),
    };
    this.memberSaving = true;
    this.api.addMember(this.id, body).subscribe({
      next: (res) => {
        this.memberSaving = false;
        this.memberSubmitted = false;
        this.memberNotice = res.created
          ? `Added. A new account was made for ${res.member.contactMasked}; they can sign in with it.`
          : `Added. ${res.member.contactMasked} already had an account and now also belongs to this customer.`;
        this.memberContact = '';
        this.memberName = '';
        this.load();
        this.loadAudit();
      },
      error: (err) => {
        this.memberSaving = false;
        this.memberError = err?.error?.error || 'Could not add this person. Please try again.';
      },
    });
  }

  // ---- WhatsApp ----
  onWhatsAppChange(w: WhatsAppStatus): void {
    if (this.tenant) this.tenant = { ...this.tenant, whatsapp: w };
    this.loadAudit();
  }

  // ---- enter ----
  async enter(): Promise<void> {
    if (this.entering || !this.tenant) return;
    const name = this.tenant.name;
    const ok = await this.dialog.confirm(
      `You will see Waflow as ${name} does, and what you do there counts as ${name}'s own activity. Every visit is recorded under your name.`,
      { title: `Enter ${name}?`, confirmLabel: 'Enter customer' },
    );
    if (!ok) return;
    this.entering = true;
    try {
      await this.auth.enterTenant(this.id);
    } catch (err: any) {
      this.entering = false;
      await this.dialog.error(err?.error?.error || err?.message || 'Could not enter this customer. Please try again.');
    }
  }

  auditDetail(e: AuditEntry): string {
    const d = e.detail;
    if (!d || typeof d !== 'object') return '';
    return Object.entries(d)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
}
