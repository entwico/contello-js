import { describe, expect, test, vi } from 'vitest';

import { DEFAULT_TTL_MS, createRefreshByTtlQueue, resolveTtl } from './utils';

describe('resolveTtl', () => {
  test('undefined → DEFAULT_TTL_MS (3 hours)', () => {
    expect(resolveTtl(undefined)).toBe(DEFAULT_TTL_MS);
    expect(DEFAULT_TTL_MS).toBe(3 * 60 * 60 * 1000);
  });

  test('false → undefined (disabled)', () => {
    expect(resolveTtl(false)).toBeUndefined();
  });

  test('0 → undefined (disabled)', () => {
    expect(resolveTtl(0)).toBeUndefined();
  });

  test('negative → undefined (disabled)', () => {
    expect(resolveTtl(-1)).toBeUndefined();
  });

  test('positive number → pass through', () => {
    expect(resolveTtl(60_000)).toBe(60_000);
  });
});

describe('createRefreshByTtlQueue', () => {
  test('runs a single task immediately', async () => {
    const queue = createRefreshByTtlQueue();
    const task = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(task);

    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  test('runs tasks sequentially (concurrency = 1)', async () => {
    const queue = createRefreshByTtlQueue();
    const order: string[] = [];
    let resolveA: (() => void) | null = null;
    let resolveB: (() => void) | null = null;

    queue.enqueue(() => {
      order.push('a:start');

      return new Promise<void>((resolve) => {
        resolveA = () => {
          order.push('a:end');
          resolve();
        };
      });
    });

    queue.enqueue(() => {
      order.push('b:start');

      return new Promise<void>((resolve) => {
        resolveB = () => {
          order.push('b:end');
          resolve();
        };
      });
    });

    await vi.waitFor(() => expect(order).toEqual(['a:start']));

    // b has NOT started yet — concurrency is 1
    expect(order).toEqual(['a:start']);

    resolveA!();

    await vi.waitFor(() => expect(order).toEqual(['a:start', 'a:end', 'b:start']));

    resolveB!();

    await vi.waitFor(() => expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']));
  });

  test('drains remaining tasks after a failure', async () => {
    const queue = createRefreshByTtlQueue();
    const a = vi.fn().mockRejectedValue(new Error('boom'));
    const b = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(a);
    queue.enqueue(b);

    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(1));
    expect(a).toHaveBeenCalledTimes(1);
  });
});
