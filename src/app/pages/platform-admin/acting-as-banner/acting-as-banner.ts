import { Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../../shared/auth.service';
import { DialogService } from '../../../shared/dialog.service';

// Sticky amber strip shown while a super admin is inside a customer. It sits above everything in the main column and
// below the global dialog (z-index 2000). "Back to Platform" restores the staff session and reloads the app.
@Component({
  selector: 'app-acting-as-banner',
  imports: [AsyncPipe],
  template: `
    @if ((auth.session | async)?.actingAs; as acting) {
      <div class="acting-banner" role="status">
        <span class="acting-text">You are viewing <strong>{{ acting.customerName }}</strong> as a super admin</span>
        <button type="button" class="btn btn-sm acting-back" [disabled]="leaving" (click)="back()">
          {{ leaving ? 'Leaving...' : 'Back to Platform' }}
        </button>
      </div>
    }
  `,
  styles: [`
    /* No box of its own, so the sticky strip is positioned against the scrolling main column, not this element. */
    :host { display: contents; }
    .acting-banner {
      position: sticky; top: 0; z-index: 900;
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 9px 20px;
      background: #fef3c7; color: #78350f;
      border-bottom: 2px solid var(--warning);
      font-size: 13px;
    }
    .acting-back { background: #78350f; color: #fff; border: none; }
    .acting-back:disabled { opacity: 0.6; cursor: default; }
  `],
})
export class ActingAsBanner {
  leaving = false;

  constructor(public auth: AuthService, private dialog: DialogService) {}

  async back(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    try {
      await this.auth.exitTenant();
    } catch {
      this.leaving = false;
      await this.dialog.error('Could not go back to the platform. Please sign in again.');
    }
  }
}
