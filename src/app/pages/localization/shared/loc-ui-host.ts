import { Component, ElementRef, HostListener, computed, effect, inject, untracked } from '@angular/core';
import { LocUiService } from './loc-ui.service';
import { I18nService, I18N_PIPES } from '../../../i18n';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Renders the pending confirmation (if any) and the toast stack. Place ONE
// instance inside the hub shell. A confirmation behaves like a real modal for
// keyboard users: focus moves to the safe (cancel) button, Tab stays inside it,
// Escape cancels, and focus returns to where it was when it closes.
@Component({
  selector: 'app-loc-ui-host',
  imports: [...I18N_PIPES],
  templateUrl: './loc-ui-host.html',
  styleUrl: './loc-ui-host.css',
})
export class LocUiHost {
  readonly ui = inject(LocUiService);
  readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isOpen = computed(() => this.ui.confirmState() !== null);
  private returnTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      untracked(() => {
        if (open) {
          this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // The dialog is rendered after this effect: focus it on the next task.
          setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.lui-actions button')?.focus());
        } else if (this.returnTo) {
          const el = this.returnTo;
          this.returnTo = null;
          if (el.isConnected) el.focus();
        }
      });
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.ui.confirmState()) this.ui.respond(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.ui.confirmState()) return;
    const items = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(`.lui-modal ${FOCUSABLE.split(', ').join(', .lui-modal ')}`));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!this.host.nativeElement.querySelector('.lui-modal')?.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
