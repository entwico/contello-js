import { AsyncLocalStorage } from 'node:async_hooks';

import { type AsyncIterableSubject, createAsyncIterableSubject, retryWithBackoff } from '@entwico/dash/async';

/**
 * default `cache.ttl` applied across all store kinds. eager stores (collections, singletons)
 * use it as the interval for a periodic full refresh; lazy stores use it as the per-item
 * LRU eviction window. 3 hours.
 */
export const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * default `cache.max` (LRU capacity) for lazy stores — the maximum number of items kept
 * before least-recently-used eviction.
 */
export const DEFAULT_LRU_MAX = 1000;

export function resolveTtl(ttl: number | false | undefined): number | undefined {
  if (ttl === undefined) return DEFAULT_TTL_MS;
  if (ttl === false || ttl <= 0) return undefined;

  return ttl;
}

/**
 * Retries the refreshes of one store until they succeed. A source that keeps failing would
 * otherwise be retried for the life of the process, with the store it belonged to kept in memory:
 * `stop()` on destroy ends every retry that is still running.
 */
export type RefreshRetry = {
  /** Answers whether `fn` succeeded: `false` once the store was destroyed. */
  run(fn: () => Promise<unknown>): Promise<boolean>;
  stop(): void;
};

export function createRefreshRetry(): RefreshRetry {
  const controller = new AbortController();

  return {
    async run(fn) {
      try {
        await retryWithBackoff(fn, { signal: controller.signal });

        return true;
      } catch {
        // retryWithBackoff gives up only when the signal aborts
        return false;
      }
    },
    stop() {
      controller.abort();
    },
  };
}

/**
 * creates a coalescing refresh scheduler with exponential-backoff retry on failure.
 *
 * at most one refresh runs at a time. if a new refresh is requested while one is in-flight,
 * it is queued as pending — the queued slot keeps the latest `kind` passed via
 * scheduleRefresh. once the in-flight refresh completes, at most one queued refresh
 * starts, with that latest kind — collapsing any number of intermediate requests into one.
 *
 * on error, retries with exponential backoff until `retry` is stopped. the projected value keeps serving
 * the stale cached value throughout (SWR). the `onRefreshed` callback receives the kind that
 * triggered the just-completed refresh.
 */
export function createRefresher<K>(
  fn: () => Promise<unknown>,
  onRefreshed: (kind: K) => void,
  retry: RefreshRetry,
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

    void retry.run(fn).then((refreshed) => {
      if (!refreshed) {
        return;
      }

      const finished = inFlightKind as K;

      refreshing = false;
      inFlightKind = undefined;
      onRefreshed(finished);

      if (!pendingKind) {
        return;
      }

      const { kind: next } = pendingKind;

      pendingKind = undefined;
      scheduleRefresh(next);
    });
  }

  return scheduleRefresh;
}

/**
 * Refresh channel: bundles the `refresh$` multicast stream and the `onRefresh` callback
 * so both fire on every emission. Used by every eager and lazy store that exposes refresh
 * events.
 */
export type RefreshChannel<TEvent> = {
  readonly stream$: AsyncIterableSubject<TEvent>;
  emit(event: TEvent): void;
  complete(): void;
};

export function createRefreshChannel<TEvent>(
  onRefresh?: ((event: TEvent) => void) | undefined,
): RefreshChannel<TEvent> {
  const stream$ = createAsyncIterableSubject<TEvent>();

  return {
    stream$,
    emit(event) {
      stream$.next(event);
      onRefresh?.(event);
    },
    complete() {
      stream$.complete();
    },
  };
}

/**
 * TTL orchestrator: owns the safety-net timer for eager stores. Calls into `run` after
 * `ttl` ms have passed since the last `mark()` (or `reset()`); `run` is responsible for
 * actually fetching + re-arming via another `mark()` once it succeeds. `clear()` cancels
 * the timer on destroy. When `ttl` is undefined the orchestrator is a no-op.
 */
export type TtlOrchestrator = {
  /** start (or restart) the timer. consumers call this on first successful full fetch and after every later one. */
  mark(): void;
  /** cancel any pending timer for good; for destroy. */
  clear(): void;
};

export function createTtlOrchestrator(options: { ttl: number | undefined; run: () => void }): TtlOrchestrator {
  // the timer is armed by whoever loads or refreshes the store, often a request. armed inside that
  // request's async context it would keep the context for as long as the store lives, and run
  // every later refresh in it
  const runInOwnContext = AsyncLocalStorage.snapshot();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleared = false;

  return {
    mark() {
      // a refresh that was in flight when the store was destroyed must not arm the timer again
      if (cleared) {
        return;
      }

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (options.ttl === undefined) {
        return;
      }

      timer = runInOwnContext(() => setTimeout(options.run, options.ttl));
    },
    clear() {
      cleared = true;

      if (timer === undefined) {
        return;
      }

      clearTimeout(timer);
      timer = undefined;
    },
  };
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

    void (async () => {
      try {
        await task();
      } catch {
        // misbehaving task — keep the queue draining
      } finally {
        running = false;
        next();
      }
    })();
  }

  return {
    enqueue(task) {
      waiting.push(task);
      next();
    },
  };
}
