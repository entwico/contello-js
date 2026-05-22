import { describe, expect, test, vi } from 'vitest';

import {
  asyncKeepalive,
  collectAsync,
  exponentialBackoff,
  filterAsync,
  firstAsync,
  mapAsync,
  runWithBackoff,
} from './async-iterable-utils';

async function* fromArray<T>(values: T[]): AsyncIterable<T> {
  for (const v of values) {
    yield v;
  }
}

describe('firstAsync', () => {
  test('yields the first value and disposes the iterator', async () => {
    let returned = false;

    const iter: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let i = 0;

        return {
          async next() {
            return i++ < 3 ? { value: i, done: false } : { value: undefined as unknown as number, done: true };
          },
          async return() {
            returned = true;

            return { value: undefined as unknown as number, done: true };
          },
        };
      },
    };

    expect(await firstAsync(iter)).toBe(1);
    expect(returned).toBe(true);
  });

  test('throws when iterable completes with no values', async () => {
    await expect(firstAsync(fromArray<number>([]))).rejects.toThrow(/completed without yielding/);
  });
});

describe('mapAsync', () => {
  test('lazily maps each value', async () => {
    const out: number[] = [];

    for await (const v of mapAsync(fromArray([1, 2, 3]), (n) => n * 10)) {
      out.push(v);
    }

    expect(out).toEqual([10, 20, 30]);
  });
});

describe('filterAsync', () => {
  test('drops values for which predicate is false', async () => {
    const out: number[] = [];

    for await (const v of filterAsync(fromArray([1, 2, 3, 4]), (n) => n % 2 === 0)) {
      out.push(v);
    }

    expect(out).toEqual([2, 4]);
  });
});

describe('collectAsync', () => {
  test('concatenates all yielded arrays into one', async () => {
    expect(
      await collectAsync(
        fromArray([
          [1, 2],
          [3, 4, 5],
        ]),
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test('returns an empty array when the source is empty', async () => {
    expect(await collectAsync(fromArray<number[]>([]))).toEqual([]);
  });
});

describe('exponentialBackoff', () => {
  test('returns a Promise that resolves', async () => {
    vi.useFakeTimers();

    try {
      const p = exponentialBackoff(0);

      vi.advanceTimersByTime(60_000);

      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runWithBackoff', () => {
  test('returns once `fn` resolves on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    await runWithBackoff(fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on rejection until success', async () => {
    vi.useFakeTimers();

    try {
      const fn = vi
        .fn<() => Promise<unknown>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('ok');

      const promise = runWithBackoff(fn);

      // drain all pending microtasks + timers so the backoff resolves immediately
      for (let i = 0; i < 20 && fn.mock.calls.length < 3; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }

      await promise;

      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test('throws when the signal aborts', async () => {
    const controller = new AbortController();

    controller.abort(new Error('aborted'));

    await expect(runWithBackoff(async () => {}, controller.signal)).rejects.toThrow(/aborted/);
  });
});

describe('asyncKeepalive', () => {
  test('re-subscribes after the source completes', async () => {
    let count = 0;
    const factory = (): AsyncIterable<number> => fromArray([++count]);
    const controller = new AbortController();
    const out: number[] = [];

    (async () => {
      for await (const v of asyncKeepalive(factory, controller.signal)) {
        out.push(v);

        if (v >= 3) {
          controller.abort();
        }
      }
    })();

    await vi.waitFor(() => expect(out).toEqual([1, 2, 3]));
  });

  test('stops cleanly when signal aborts', async () => {
    const controller = new AbortController();
    let opens = 0;
    const factory = (): AsyncIterable<number> => {
      opens++;

      return fromArray([opens]);
    };

    const out: number[] = [];
    const done = (async () => {
      for await (const v of asyncKeepalive(factory, controller.signal)) {
        out.push(v);
        controller.abort();
      }
    })();

    await done;

    expect(out).toEqual([1]);
  });
});
