import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; message: string }

// Confirmations and toasts for the localisation pages. The shared app-wide
// DialogService hard-codes English button labels and isn't direction-aware, so
// the Arabic pages use this instead (rendered by <app-loc-ui-host/> inside the
// hub, which inherits the hub's dir). Callers pass ALREADY-TRANSLATED text.
@Injectable({ providedIn: 'root' })
export class LocUiService {
  readonly confirmState = signal<ConfirmState | null>(null);
  readonly toasts = signal<Toast[]>([]);
  private nextToastId = 1;

  // Resolves true only when the user presses the primary button. If another
  // confirmation is already open it is dismissed (resolved false) first, so a
  // promise never stays pending forever.
  confirm(options: ConfirmOptions): Promise<boolean> {
    this.confirmState()?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.confirmState.set({ ...options, resolve });
    });
  }

  respond(result: boolean): void {
    const state = this.confirmState();
    this.confirmState.set(null);
    state?.resolve(result);
  }

  toast(message: string, kind: ToastKind = 'success', ms = 4500): void {
    const id = this.nextToastId++;
    this.toasts.update((list) => [...list, { id, kind, message }]);
    setTimeout(() => this.dismissToast(id), ms);
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
