const MAX_BACKOFF_MS = 30_000;
const JITTER_MIN_MS = 300;
const JITTER_MAX_MS = 3000;

/**
 * Returns the first value yielded by `iter`, then disposes the iterator. Throws if the iterable
 * completes without yielding. Equivalent of rxjs's `firstValueFrom` for AsyncIterables.
 */
export async function firstAsync<T>(iter: AsyncIterable<T>): Promise<T> {
  const it = iter[Symbol.asyncIterator]();

  try {
    const result = await it.next();

    if (result.done) {
      throw new Error('firstAsync: async iterable completed without yielding a value');
    }

    return result.value;
  } finally {
    await it.return?.();
  }
}

/** Lazy map over an async iterable. Cleanup propagates: breaking the outer iter disposes the inner. */
export async function* mapAsync<T, R>(iter: AsyncIterable<T>, fn: (value: T) => R): AsyncIterable<R> {
  for await (const value of iter) {
    yield fn(value);
  }
}

/** Lazy filter over an async iterable. */
export async function* filterAsync<T>(iter: AsyncIterable<T>, predicate: (value: T) => boolean): AsyncIterable<T> {
  for await (const value of iter) {
    if (predicate(value)) {
      yield value;
    }
  }
}

/**
 * Concatenates all elements of all arrays yielded by `iter` into a single array. Used to support
 * subscriptions that emit chunks of items before completing.
 */
export async function collectAsync<T>(iter: AsyncIterable<T[]>): Promise<T[]> {
  const out: T[] = [];

  for await (const chunk of iter) {
    out.push(...chunk);
  }

  return out;
}

/**
 * Exponential backoff with jitter. `attempt` starts at 0 → ~1s+jitter, 1 → ~2s+jitter, etc.,
 * capped at 30s. Returns a Promise that resolves after the delay.
 */
export function exponentialBackoff(attempt: number): Promise<void> {
  const base = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS) + JITTER_MIN_MS);

  return delay(base + jitter);
}

function delay(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `fn` with exponential-backoff retry on rejection. Returns once `fn` resolves successfully.
 * `signal` aborts both the in-flight `fn` (if it observes the signal) and the backoff wait.
 */
export async function runWithBackoff(fn: () => Promise<unknown>, signal?: AbortSignal | undefined): Promise<void> {
  let attempt = 0;

  for (;;) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    try {
      await fn();

      return;
    } catch {
      await exponentialBackoffWithSignal(attempt, signal);
      attempt++;
    }
  }
}

function exponentialBackoffWithSignal(attempt: number, signal?: AbortSignal | undefined): Promise<void> {
  const base = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS) + JITTER_MIN_MS);

  return delay(base + jitter, signal);
}

/**
 * Long-running stream wrapper: subscribes via `factory()`, yields every value, and on error or
 * unexpected completion re-subscribes with exponential backoff. Stops only when `signal` aborts.
 * Designed for subscriptions that should stay open across reconnects (e.g. the watcher).
 */
export async function* asyncKeepalive<T>(
  factory: () => AsyncIterable<T>,
  signal?: AbortSignal | undefined,
): AsyncIterable<T> {
  let attempt = 0;

  while (!signal?.aborted) {
    try {
      for await (const value of factory()) {
        if (signal?.aborted) {
          return;
        }

        yield value;
        attempt = 0;
      }
      // source completed cleanly — re-subscribe immediately
      attempt = 0;
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      // swallow + back off, then retry. callers that want the error to surface should not use keepalive
      void error;
      await exponentialBackoffWithSignal(attempt, signal);
      attempt++;
    }
  }
}
