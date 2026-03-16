import { retryBackoff } from 'backoff-rxjs';
import { type MonoTypeOperatorFunction, Observable, catchError, defer, repeat } from 'rxjs';

import type { Fetchable } from './types';

export type KeepaliveParams = {
  onError?: ((err: unknown) => void) | undefined;
};

/**
 * keeps a long-lived observable alive by retrying with exponential backoff on error
 * and re-subscribing immediately after the source completes (e.g. server closes the connection)
 */
export const keepalive =
  <T>(params?: KeepaliveParams | undefined): MonoTypeOperatorFunction<T> =>
  (source) =>
    source.pipe(
      catchError((error) => {
        params?.onError?.(error);

        throw error;
      }),
      retryBackoff({ initialInterval: 100, maxInterval: 5_000 }),
      repeat({ delay: 0 }),
    );

/**
 * resolves a Fetchable (sync value, promise, or observable) to a plain value or promise.
 * observables are fully consumed and their emissions are concatenated into a single array.
 */
export function resolveFetchable<T>(value: Fetchable<T[]>): T[] | Promise<T[]> {
  if (value instanceof Observable) {
    return collect(value);
  }

  return value;
}

/**
 * creates a coalescing refresh scheduler with exponential backoff on failure.
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

  function scheduleRefresh() {
    if (refreshing) {
      pending = true;
      return;
    }

    refreshing = true;
    onStart?.();

    // defer ensures fn() is called fresh on each retry attempt, not just once upfront
    defer(() => fn())
      .pipe(retryBackoff({ initialInterval: 100, maxInterval: 10_000 }))
      .subscribe({
        complete: () => {
          refreshing = false;

          onRefreshed();

          if (pending) {
            pending = false;
            scheduleRefresh();
          }
        },
      });
  }

  return scheduleRefresh;
}

/**
 * collects all emissions from an observable of arrays into a single flat promise.
 * used to support Observable<T[]> as a fetch source alongside plain values and promises.
 */
export function collect<T>(observable: Observable<T[]>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const collected: T[] = [];

    observable.subscribe({
      error: reject,
      next: (chunk) => collected.push(...chunk),
      complete: () => resolve(collected),
    });
  });
}
