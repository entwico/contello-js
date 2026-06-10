/**
 * Multicast event source with `next` / `error` / `complete` (Subject semantics) plus an
 * `AsyncIterable` view. Two consumption modes that fan out from the same source:
 *
 * - `for await (const v of subject)` — iteration. Each `[Symbol.asyncIterator]()` call returns
 *   a fresh per-iterator queue. Stop by `break`ing the loop. On `.error(err)` the iterator's
 *   pending `next()` rejects, propagating into the for-await as a thrown exception.
 *
 * - `subject.subscribe(observerOrNext)` — observer style. Pass either a full/partial observer
 *   `{ next?, error?, complete? }` or just an `(value) => …` function as the `next`-only shortcut.
 *   Returns an unsubscribe function. Missing handlers default to no-ops.
 *
 * Producer side: call `.next(value)` to emit, `.error(err)` to fail the subject (all consumers
 * see the error and are detached), `.complete()` to close cleanly (all consumers see done and
 * are detached). After either `error` or `complete`, further `.next()` calls are dropped and
 * new `.subscribe(...)` calls register a no-op unsubscribe.
 *
 * Backpressure: unbounded queue per pending iterator. Intended for low-frequency events.
 */
export type AsyncIterableSubject<T> = AsyncIterable<T> & {
  next: (value: T) => void;
  error: (err: unknown) => void;
  complete: () => void;
  subscribe: (
    observerOrNext:
      | {
        next?: (value: T) => void;
        error?: (err: unknown) => void;
        complete?: () => void;
      }
      | ((value: T) => void),
  ) => () => void;
};

type IteratorConsumer<T> = {
  kind: 'iterator';
  queue: T[];
  pending?: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void } | undefined;
};

type ListenerConsumer<T> = {
  kind: 'listener';
  next?: (value: T) => void;
  error?: (err: unknown) => void;
  complete?: () => void;
};

type Consumer<T> = IteratorConsumer<T> | ListenerConsumer<T>;

type Status = { state: 'open' } | { state: 'errored'; err: unknown } | { state: 'completed' };

export function createAsyncIterableSubject<T>(): AsyncIterableSubject<T> {
  const consumers = new Set<Consumer<T>>();
  let status: Status = { state: 'open' };

  const next = (value: T): void => {
    if (status.state !== 'open') {
      return;
    }

    for (const consumer of consumers) {
      if (consumer.kind === 'listener') {
        consumer.next?.(value);
      } else if (consumer.pending) {
        const p = consumer.pending;

        consumer.pending = undefined;
        p.resolve({ value, done: false });
      } else {
        consumer.queue.push(value);
      }
    }
  };

  const error = (err: unknown): void => {
    if (status.state !== 'open') {
      return;
    }

    status = { state: 'errored', err };

    for (const consumer of consumers) {
      if (consumer.kind === 'listener') {
        consumer.error?.(err);
      } else if (consumer.pending) {
        const p = consumer.pending;

        consumer.pending = undefined;
        p.reject(err);
      }
    }

    consumers.clear();
  };

  const complete = (): void => {
    if (status.state !== 'open') {
      return;
    }

    status = { state: 'completed' };

    for (const consumer of consumers) {
      if (consumer.kind === 'listener') {
        consumer.complete?.();
      } else if (consumer.pending) {
        const p = consumer.pending;

        consumer.pending = undefined;
        p.resolve({ value: undefined as unknown as T, done: true });
      }
    }

    consumers.clear();
  };

  const subscribe = (
    observerOrNext:
      | {
        next?: (value: T) => void;
        error?: (err: unknown) => void;
        complete?: () => void;
      }
      | ((value: T) => void),
  ): (() => void) => {
    if (status.state !== 'open') {
      return () => {};
    }

    const observer = typeof observerOrNext === 'function' ? { next: observerOrNext } : observerOrNext;
    const consumer: ListenerConsumer<T> = { kind: 'listener', ...observer };

    consumers.add(consumer);

    return () => {
      consumers.delete(consumer);
    };
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      if (status.state === 'errored') {
        const err = status.err;

        return {
          next: () => Promise.reject(err),
          return: () => Promise.resolve({ value: undefined as unknown as T, done: true }),
        };
      }

      if (status.state === 'completed') {
        return {
          next: () => Promise.resolve({ value: undefined as unknown as T, done: true }),
          return: () => Promise.resolve({ value: undefined as unknown as T, done: true }),
        };
      }

      const consumer: IteratorConsumer<T> = { kind: 'iterator', queue: [] };

      consumers.add(consumer);

      return {
        next(): Promise<IteratorResult<T>> {
          if (consumer.queue.length > 0) {
            return Promise.resolve({ value: consumer.queue.shift()!, done: false });
          }

          if (status.state === 'errored') {
            return Promise.reject(status.err);
          }

          if (status.state === 'completed') {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            consumer.pending = { resolve, reject };
          });
        },
        return(): Promise<IteratorResult<T>> {
          consumers.delete(consumer);

          if (consumer.pending) {
            const p = consumer.pending;

            consumer.pending = undefined;
            p.resolve({ value: undefined as unknown as T, done: true });
          }

          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
        throw(err): Promise<IteratorResult<T>> {
          consumers.delete(consumer);

          return Promise.reject(err);
        },
      };
    },
  };

  return Object.assign(iterable, { next, error, complete, subscribe });
}
