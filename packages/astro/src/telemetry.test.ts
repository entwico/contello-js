import { describe, expect, test } from 'vitest';

import { wrap } from './telemetry';

describe('telemetry', () => {
  test('exposes a wrap function bound to the package scope', () => {
    expect(typeof wrap).toBe('function');
  });

  test('passes a sync result through unchanged', () => {
    expect(wrap('collection:products', () => 42)).toBe(42);
  });

  test('resolves an async result unchanged', async () => {
    await expect(wrap('rpc:getThing', async () => 'value')).resolves.toBe('value');
  });

  test('rethrows a sync error from the wrapped fn', () => {
    const error = new Error('boom');

    expect(() =>
      wrap('a:b', () => {
        throw error;
      }),
    ).toThrow(error);
  });
});
