import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalizationApiService } from '../../../services/localization-api.service';
import type { LocalizationSettings } from '../localization.types';

// Shared state for the hub and every tab inside it: the merchant's
// localisation settings (including the per-merchant arabic_enabled flag).
// Loaded once by the hub shell; tabs read the signals and call update() after
// they change something.
@Injectable({ providedIn: 'root' })
export class HubStateService {
  private readonly api = inject(LocalizationApiService);

  readonly settings = signal<LocalizationSettings | null>(null);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly enabled = computed(() => this.settings()?.arabicEnabled === true);

  load(force = false): void {
    if (this.loaded() && !force) return;
    this.failed.set(false);
    this.api.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.loaded.set(true);
      },
      error: () => {
        this.failed.set(true);
        this.loaded.set(true);
      },
    });
  }

  update(patch: Partial<LocalizationSettings>): void {
    const current = this.settings();
    if (current) this.settings.set({ ...current, ...patch });
  }
}
