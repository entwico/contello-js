import { runWithBackoff } from '@contello/client';

/**
 * default `cache.ttl` applied across all store kinds. eager stores (collections, singletons)
 * use it as the interval for a periodic full refresh; lazy stores use it as the per-item
 * LRU eviction window. 3 hours.
 */
export const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * resolves the consumer-supplied `ttl` (number | false | undefined) into a runtime
 * value: undefined → default, false or 0 → disabled (undefined), positive → as-is.
 */
export function resolveTtl(ttl: number | false | undefined): number | undefined {
  if (ttl === undefined) return DEFAULT_TTL_MS;
  if (ttl === false || ttl <= 0) return undefined;

  return ttl;
}

/**
 * creates a coalescing refresh scheduler with exponential-backoff retry on failure.
 *
 * at most one refresh runs at a time. if a new refresh is requested while one is in-flight,
 * it is queued as pending — the queued slot keeps the latest `kind` passed via
 * scheduleRefresh. once the in-flight refresh completes, at most one queued refresh
 * starts, with that latest kind — collapsing any number of intermediate requests into one.
 *
 * on error, retries indefinitely with exponential backoff. the projected value keeps serving
 * the stale cached value throughout (SWR). the `onRefreshed` callback receives the kind that
 * triggered the just-completed refresh.
 */
export function createRefresher<K>(
  fn: () => Promise<unknown>,
  onRefreshed: (kind: K) => void,
  onStart: () => void,
): (kind: K) => void {
  let refreshing = false;
  let inFlightKind: K | undefined;
  let pendingKind: { kind: K } | undefined;

  function scheduleRefresh(kind: K): void {
    if (refreshing) {
      pendingKind = { kind };

      return;
    }

    refreshing = true;
    inFlightKind = kind;
    onStart?.();

    void runWithBackoff(fn).then(() => {
      const finished = inFlightKind as K;

      refreshing = false;
      inFlightKind = undefined;
      onRefreshed(finished);

      if (pendingKind) {
        const { kind: next } = pendingKind;

        pendingKind = undefined;
        scheduleRefresh(next);
      }
    });
  }

  return scheduleRefresh;
}

/**
 * FIFO queue for ttl-fired refreshes on eager stores.
 * Concurrency is fixed at 1 to avoid DDOSing the server
 */
export type RefreshByTtlQueue = {
  enqueue(task: () => Promise<unknown>): void;
};

export function createRefreshByTtlQueue(): RefreshByTtlQueue {
  const waiting: (() => Promise<unknown>)[] = [];
  let running = false;

  function next(): void {
    if (running) return;

    const task = waiting.shift();

    if (!task) return;

    running = true;

    Promise.resolve()
      .then(task)
      .catch(() => {
        // misbehaving task — keep the queue draining
      })
      .finally(() => {
        running = false;
        next();
      });
  }

  return {
    enqueue(task) {
      waiting.push(task);
      next();
    },
  };
}
