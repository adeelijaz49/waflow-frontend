import { DestroyRef } from '@angular/core';

// Calls `fn` every `ms` while the tab is visible; does nothing while
// `document.hidden`; refreshes once when the tab becomes visible again; stops
// when the owning component is destroyed.
export function startPolling(destroyRef: DestroyRef, ms: number, fn: () => void): () => void {
  const timer = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  const onVisible = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener('visibilitychange', onVisible);
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
  destroyRef.onDestroy(stop);
  return stop;
}
