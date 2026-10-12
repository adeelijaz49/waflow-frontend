import { WritableSignal, signal } from '@angular/core';

// A plain Set that also bumps a signal (`rev`) whenever its CONTENT really changes. The Promotions
// page keeps the selected customer ids in one Set that is mutated in place at several call sites; an
// embedded child can read `rev()` inside an effect to react to every change without those call sites
// being touched. Behaviourally it is a Set (size, has, spread, forEach all unchanged).
export class TrackedSet<T> extends Set<T> {
  // `Set`'s constructor may call add() before this field exists (new TrackedSet([1, 2])), hence the guards.
  readonly rev: WritableSignal<number> = signal(0);

  override add(value: T): this {
    const before = this.size;
    super.add(value);
    if (this.rev && this.size !== before) this.rev.update((n) => n + 1);
    return this;
  }

  override delete(value: T): boolean {
    const had = super.delete(value);
    if (had && this.rev) this.rev.update((n) => n + 1);
    return had;
  }

  override clear(): void {
    const had = this.size > 0;
    super.clear();
    if (had && this.rev) this.rev.update((n) => n + 1);
  }
}
