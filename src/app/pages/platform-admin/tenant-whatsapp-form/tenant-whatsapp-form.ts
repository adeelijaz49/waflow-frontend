import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../shared/dialog.service';
import { PlatformApiService, SetWhatsAppBody, WhatsAppStatus } from '../../../shared/platform-api.service';

export const ENCRYPTION_MESSAGE =
  'This server cannot store a customer\'s own WhatsApp token yet. Ask the platform owner to set WA_TOKEN_ENCRYPTION_KEY first, then try again.';

// The place where a customer's OWN WhatsApp number is entered (per customer, never an environment variable).
// The access token is write-only: it is posted once, cleared from the form the moment it is sent, and never shown
// again; the page only ever says that a token is saved.
@Component({
  selector: 'app-tenant-whatsapp-form',
  imports: [FormsModule, DatePipe],
  templateUrl: './tenant-whatsapp-form.html',
  styleUrl: './tenant-whatsapp-form.css',
})
export class TenantWhatsappForm {
  @Input({ required: true }) tenantId!: string;
  @Input() status: WhatsAppStatus | null = null;
  @Output() statusChange = new EventEmitter<WhatsAppStatus>();

  phoneId = '';
  wabaId = '';
  accessToken = '';

  busy: 'save' | 'test' | 'clear' | null = null;
  submitted = false;
  error: string | null = null;
  notice: string | null = null;

  constructor(private api: PlatformApiService, private dialog: DialogService) {}

  get isOwn(): boolean {
    return this.status?.mode === 'own';
  }

  get fieldErrors(): { phoneId?: string; wabaId?: string } {
    const e: { phoneId?: string; wabaId?: string } = {};
    const id = this.phoneId.trim();
    if (!id) e.phoneId = 'Enter the phone number id from the customer\'s WhatsApp Business account.';
    else if (!/^\d{5,25}$/.test(id)) e.phoneId = 'The phone number id is a long number made of digits only (not the phone number itself).';
    if (this.accessToken.trim() && !this.wabaId.trim()) e.wabaId = 'A customer\'s own access token needs their WhatsApp Business Account id as well.';
    if (this.wabaId.trim() && !/^\d{5,25}$/.test(this.wabaId.trim())) e.wabaId = 'The WhatsApp Business Account id is digits only.';
    return e;
  }

  verifyAndSave(): void {
    this.submitted = true;
    this.error = null;
    this.notice = null;
    if (this.busy || Object.keys(this.fieldErrors).length) return;
    const body: SetWhatsAppBody = { phoneId: this.phoneId.trim(), verify: true };
    if (this.wabaId.trim()) body.wabaId = this.wabaId.trim();
    if (this.accessToken.trim()) body.accessToken = this.accessToken.trim();
    // Write-only: gone from the form (and the component) the moment it is on its way, whatever the outcome.
    this.accessToken = '';
    this.busy = 'save';
    this.api.setWhatsApp(this.tenantId, body).subscribe({
      next: (res) => {
        this.busy = null;
        this.submitted = false;
        this.phoneId = '';
        this.wabaId = '';
        this.apply(res.whatsapp, 'Saved.');
      },
      error: (err) => {
        this.busy = null;
        this.error = this.messageFor(err);
      },
    });
  }

  testConnection(): void {
    this.error = null;
    this.notice = null;
    if (this.busy || !this.isOwn) return;
    this.busy = 'test';
    this.api.verifyWhatsApp(this.tenantId).subscribe({
      next: (res) => {
        this.busy = null;
        this.apply(res.whatsapp, 'Checked.', res.message);
      },
      error: (err) => {
        this.busy = null;
        this.error = this.messageFor(err);
      },
    });
  }

  async usePlatformNumber(): Promise<void> {
    this.error = null;
    this.notice = null;
    if (this.busy || !this.isOwn) return;
    const ok = await this.dialog.confirm(
      'This customer will send from the shared platform WhatsApp number again. Their saved token is removed.',
      { title: 'Use the platform number?', confirmLabel: 'Use platform number' },
    );
    if (!ok) return;
    this.busy = 'clear';
    this.api.clearWhatsApp(this.tenantId).subscribe({
      next: (res) => {
        this.busy = null;
        this.apply(res.whatsapp, 'This customer now uses the platform number.');
      },
      error: (err) => {
        this.busy = null;
        this.error = this.messageFor(err);
      },
    });
  }

  // `reason` is the server's own explanation of a failed check (from the test); it replaces the generic sentence so the person
  // sees what is actually wrong (a wrong phone number id reads differently from an expired token).
  private apply(w: WhatsAppStatus, prefix: string, reason?: string): void {
    this.status = w;
    this.statusChange.emit(w);
    if (w.mode !== 'own') this.notice = prefix;
    else if (w.tokenIsValid === true && !reason) this.notice = `${prefix} WhatsApp accepted the connection.`;
    else if (w.tokenIsValid === false) this.notice = `${prefix} ${reason || 'WhatsApp did not accept the token.'} Messages for this customer will not send until it is fixed.`;
    else if (reason) this.notice = `${prefix} ${reason}`;
    else this.notice = `${prefix} The connection has not been checked yet.`;
  }

  private messageFor(err: any): string {
    const body = err?.error;
    const text = typeof body === 'string' ? body : (body?.message || body?.error || '');
    if (err?.status === 503 || /ENCRYPTION_NOT_CONFIGURED/i.test(`${body?.code || ''} ${text}`)) return ENCRYPTION_MESSAGE;
    if (err?.status === 403) return 'You do not have access to change this.';
    if (err?.status === 409 && !text) return 'Another customer already uses this phone number id.';
    return text || 'Something went wrong. Please try again.';
  }
}
