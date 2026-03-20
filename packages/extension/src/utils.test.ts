import { describe, expect, test } from 'vitest';
import { Deferred } from './utils';

describe('Deferred', () => {
  test('resolves with value', async () => {
    const deferred = new Deferred<string>();

    deferred.resolve('hello');

    expect(await deferred.promise).toBe('hello');
  });

  test('rejects with error', async () => {
    const deferred = new Deferred<string>();

    deferred.reject(new Error('fail'));

    await expect(deferred.promise).rejects.toThrow('fail');
  });
});
