import { runWithBackoff } from '@contello/client';

/**
 * creates a coalescing refresh scheduler with exponential-backoff retry on failure.
 *
 * at most one refresh runs at a time. if a new refresh is requested while one is in-flight,
 * it is queued as pending. once the in-flight refresh completes, at most one queued refresh
 * starts — collapsing any number of intermediate requests into one.
 *
 * on error, retries indefinitely with exponential backoff. the projected value keeps serving
 * the stale cached value throughout (SWR).
 */
export function createRefresher(fn: () => Promise<unknown>, onRefreshed: () => void, onStart: () => void): () => void {
  let refreshing = false;
  let pending = false;

  function scheduleRefresh(): void {
    if (refreshing) {
      pending = true;

      return;
    }

    refreshing = true;
    onStart?.();

    void runWithBackoff(fn).then(() => {
      refreshing = false;
      onRefreshed();

      if (pending) {
        pending = false;
        scheduleRefresh();
      }
    });
  }

  return scheduleRefresh;
}
