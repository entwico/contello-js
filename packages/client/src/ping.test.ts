import { describe, expect, test, vi } from 'vitest';

import { ping } from './ping';

describe('ping', () => {
  test('resolves when the server responds with pong', async () => {
    const execute = vi.fn(async () => ({ contelloPing: { response: 'pong' } }));

    await expect(ping(execute as any)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith('query ContelloPing { contelloPing { response } }');
  });

  test('throws on an unexpected response', async () => {
    const execute = vi.fn(async () => ({ contelloPing: { response: 'nope' } }));

    await expect(ping(execute as any)).rejects.toThrow('unexpected ping response: nope');
  });
});
