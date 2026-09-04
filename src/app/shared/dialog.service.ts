import { Injectable } from '@angular/core';

export type DialogType = 'success' | 'error' | 'warning' | 'info';

export interface DialogState {
  type: DialogType;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string; // present only for confirm-style dialogs (Cancel button shown)
  resolve: (result: boolean) => void;
}

const DEFAULT_TITLES: Record<DialogType, string> = {
  success: 'Success',
  error: 'Something went wrong',
  warning: 'Please confirm',
  info: 'Notice',
};

/**
 * Global replacement for native alert()/confirm(). Renders through the single
 * <app-dialog/> mounted in app.html, so there is exactly one dialog on screen
 * at a time and it's always closable (backdrop click, × button, Esc).
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  state: DialogState | null = null;

  /** OK-only informational dialog. Resolves once dismissed (any way). */
  alert(message: string, type: DialogType = 'info', title?: string): Promise<void> {
    return new Promise((resolve) => {
      this.state = {
        type,
        title: title || DEFAULT_TITLES[type],
        message,
        confirmLabel: 'OK',
        resolve: () => resolve(),
      };
    });
  }

  error(message: string, title = 'Something went wrong'): Promise<void> {
    return this.alert(message, 'error', title);
  }

  success(message: string, title = 'Success'): Promise<void> {
    return this.alert(message, 'success', title);
  }

  warn(message: string, title = 'Warning'): Promise<void> {
    return this.alert(message, 'warning', title);
  }

  /** Confirm/cancel dialog. Resolves true only if the primary button was clicked. */
  confirm(
    message: string,
    opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; type?: DialogType }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.state = {
        type: opts?.type || 'warning',
        title: opts?.title || DEFAULT_TITLES[opts?.type || 'warning'],
        message,
        confirmLabel: opts?.confirmLabel || 'Confirm',
        cancelLabel: opts?.cancelLabel || 'Cancel',
        resolve,
      };
    });
  }

  /** Called by <app-dialog/> — backdrop/×/Esc/Cancel pass false, the primary button passes true. */
  respond(result: boolean) {
    const s = this.state;
    this.state = null;
    s?.resolve(result);
  }
}
