import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';
import { PlatformApiService, Tenant } from '../../../shared/platform-api.service';
import { TenantCreateDialog } from '../tenant-create-dialog/tenant-create-dialog';
import { ownerLabel, whatsappLabel } from '../platform-format';

// Platform console home: every customer (workspace) on this deployment, with search, "Add a customer",
// and the two things a super admin does most: open a customer's settings, or step inside it.
@Component({
  selector: 'app-tenants-list',
  imports: [FormsModule, DatePipe, RouterLink, TenantCreateDialog],
  templateUrl: './tenants-list.html',
})
export class TenantsList implements OnInit, OnDestroy {
  tenants: Tenant[] = [];
  loading = true;
  error: string | null = null;
  search = '';
  showCreate = false;
  enteringId: string | null = null;

  readonly ownerLabel = ownerLabel;
  readonly whatsappLabel = whatsappLabel;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(
    private api: PlatformApiService,
    private auth: AuthService,
    private dialog: DialogService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  onSearchInput(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  runSearch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.load();
  }

  load(): void {
    const mine = ++this.seq;
    this.loading = true;
    this.error = null;
    this.api.listTenants(this.search).subscribe({
      next: (res) => {
        if (mine !== this.seq) return; // an older search answering late must not overwrite a newer one
        this.tenants = res?.tenants || [];
        this.loading = false;
      },
      error: (err) => {
        if (mine !== this.seq) return;
        this.loading = false;
        this.error = err?.status === 403
          ? 'You do not have access to the platform console.'
          : (err?.error?.error || 'Could not load customers. Please try again.');
      },
    });
  }

  planLabel(t: Tenant): string {
    return t.plan ? t.plan.code : 'None';
  }

  planBadge(t: Tenant): string {
    const s = t.plan?.status;
    if (!s) return 'badge-neutral';
    return s === 'active' ? 'badge-success' : s === 'past_due' ? 'badge-warning' : 'badge-neutral';
  }

  tokenRejected(t: Tenant): boolean {
    return t.whatsapp?.mode === 'own' && t.whatsapp.tokenIsValid === false;
  }

  onCreated(): void {
    this.load();
  }

  openCreated(id: string): void {
    this.showCreate = false;
    this.router.navigate(['/platform', id]);
  }

  async enter(t: Tenant): Promise<void> {
    if (this.enteringId) return;
    const ok = await this.dialog.confirm(
      `You will see Waflow as ${t.name} does, and what you do there counts as ${t.name}'s own activity. Every visit is recorded under your name.`,
      { title: `Enter ${t.name}?`, confirmLabel: 'Enter customer' },
    );
    if (!ok) return;
    this.enteringId = t.id;
    try {
      await this.auth.enterTenant(t.id);
    } catch (err: any) {
      this.enteringId = null;
      await this.dialog.error(err?.error?.error || err?.message || 'Could not enter this customer. Please try again.');
    }
  }
}
