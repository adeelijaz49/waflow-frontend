import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CreateTenantBody, CreateTenantResult, PlatformApiService } from '../../../shared/platform-api.service';
import { validOwnerContact } from '../platform-format';

export interface CreateTenantErrors { name?: string; ownerContact?: string; currency?: string }

// "Add a customer" form (global .modal classes). Creates the customer workspace and its first owner in one call.
// Nothing is sent to the owner automatically: the success panel tells the admin what to pass on.
@Component({
  selector: 'app-tenant-create-dialog',
  imports: [FormsModule],
  templateUrl: './tenant-create-dialog.html',
  styleUrl: './tenant-create-dialog.css',
})
export class TenantCreateDialog {
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<CreateTenantResult>();
  @Output() open = new EventEmitter<string>();

  name = '';
  ownerContactType: 'phone' | 'email' = 'phone';
  ownerContact = '';
  ownerName = '';
  currency = 'SAR';
  defaultCountryCode = '966';

  submitted = false;
  saving = false;
  error: string | null = null;
  result: CreateTenantResult | null = null;

  constructor(private api: PlatformApiService) {}

  get errors(): CreateTenantErrors {
    const e: CreateTenantErrors = {};
    if (this.name.trim().length < 2) e.name = 'Enter the customer\'s business name.';
    if (!this.ownerContact.trim()) e.ownerContact = this.ownerContactType === 'email' ? 'Enter the owner\'s email address.' : 'Enter the owner\'s phone number.';
    else if (!validOwnerContact(this.ownerContactType, this.ownerContact)) {
      e.ownerContact = this.ownerContactType === 'email'
        ? 'That does not look like an email address.'
        : 'That does not look like a phone number. Use the full number with country code, 8 to 15 digits.';
    }
    const cur = this.currency.trim();
    if (cur && !/^[A-Za-z]{3}$/.test(cur)) e.currency = 'Use a 3-letter currency code, for example SAR.';
    return e;
  }

  get valid(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  // The contact text means something different per type, so switching clears a half-typed value.
  onTypeChange(): void {
    this.ownerContact = '';
    this.error = null;
  }

  submit(): void {
    this.submitted = true;
    this.error = null;
    if (this.saving || !this.valid) return;
    const body: CreateTenantBody = {
      name: this.name.trim(),
      ownerContactType: this.ownerContactType,
      ownerContact: this.ownerContact.trim(),
    };
    if (this.ownerName.trim()) body.ownerName = this.ownerName.trim();
    if (this.currency.trim()) body.currency = this.currency.trim().toUpperCase();
    if (this.defaultCountryCode.trim()) body.defaultCountryCode = this.defaultCountryCode.trim();
    this.saving = true;
    this.api.createTenant(body).subscribe({
      next: (res) => {
        this.saving = false;
        this.result = res;
        this.created.emit(res);
      },
      error: (err) => {
        this.saving = false;
        this.error = err?.error?.error || err?.error?.message || 'Could not create the customer. Please check the details and try again.';
      },
    });
  }

  get signInText(): string {
    const r = this.result;
    if (!r) return '';
    if (r.signInHint) return r.signInHint;
    const how = this.ownerContactType === 'email' ? 'an email sign-in link' : 'a WhatsApp code';
    return `Ask ${this.ownerName.trim() || 'the owner'} to open Waflow and sign in with ${this.ownerContact.trim()} (they will get ${how}). They will land directly in ${r.tenant.name}. Nothing has been sent to them yet.`;
  }
}
