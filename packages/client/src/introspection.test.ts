import { describe, expect, test, vi } from 'vitest';

import { type TokenIntrospection, createTokenIntrospector, introspectToken } from './introspection';

const ACTIVE = {
  active: true,
  audience: 'https://extension.example',
  expiresAt: '2026-10-20T10:00:00Z',
  user: { id: 'u1', username: 'ann', firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' },
  permissions: [{ resourceType: 'ENTITY', scope: 'article', actions: ['READ'] }],
};

describe('introspectToken', () => {
  test('maps an active answer', async () => {
    const execute = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      contelloIntrospectToken: ACTIVE,
    }));

    const result = await introspectToken(execute as any, 'tmp-1');

    expect(result).toEqual({
      active: true,
      audience: 'https://extension.example',
      expiresAt: new Date('2026-10-20T10:00:00Z'),
      user: ACTIVE.user,
      permissions: ACTIVE.permissions,
    });
    expect(execute.mock.calls[0]?.[1]).toEqual({ token: 'tmp-1' });
  });

  test('an inactive answer carries nothing else', async () => {
    const execute = vi.fn(async () => ({
      contelloIntrospectToken: { active: false, audience: null, expiresAt: null, user: null, permissions: null },
    }));

    await expect(introspectToken(execute as any, 'tmp-1')).resolves.toEqual({ active: false });
  });
});

describe('createTokenIntrospector', () => {
  const active = (expiresAt: Date): TokenIntrospection => ({
    active: true,
    audience: 'https://extension.example',
    expiresAt,
    user: ACTIVE.user,
    permissions: [],
  });

  test('keeps an answer until maxAgeMs and asks again afterwards', async () => {
    vi.useFakeTimers();

    try {
      const introspect = vi.fn(async () => active(new Date(Date.now() + 3_600_000)));
      const introspector = createTokenIntrospector(introspect, { audiences: ['https://extension.example'], maxAgeMs: 1000 });

      await introspector.introspect('tmp-1');
      await introspector.introspect('tmp-1');
      expect(introspect).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001);
      await introspector.introspect('tmp-1');
      expect(introspect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps an answer no longer than the token lives', async () => {
    vi.useFakeTimers();

    try {
      const introspect = vi.fn(async () => active(new Date(Date.now() + 500)));
      const introspector = createTokenIntrospector(introspect, { audiences: ['https://extension.example'] });

      await introspector.introspect('tmp-1');
      vi.advanceTimersByTime(600);
      await introspector.introspect('tmp-1');
      expect(introspect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a token of another audience is inactive here', async () => {
    const introspect = vi.fn(async () => active(new Date(Date.now() + 3_600_000)));
    const introspector = createTokenIntrospector(introspect, { audiences: ['https://other.example'] });

    await expect(introspector.introspect('tmp-1')).resolves.toEqual({ active: false });
  });

  test('keeps no more than maxEntries answers, the expired ones go first', async () => {
    vi.useFakeTimers();

    try {
      const introspect = vi.fn(async () => active(new Date(Date.now() + 3_600_000)));
      const introspector = createTokenIntrospector(introspect, {
        audiences: ['https://extension.example'],
        maxAgeMs: 1000,
        maxEntries: 2,
      });

      await introspector.introspect('tmp-1');
      vi.advanceTimersByTime(1001);
      await introspector.introspect('tmp-2');
      await introspector.introspect('tmp-3');
      await introspector.introspect('tmp-2');
      expect(introspect).toHaveBeenCalledTimes(3);

      await introspector.introspect('tmp-4');
      await introspector.introspect('tmp-3');
      expect(introspect).toHaveBeenCalledTimes(4);

      await introspector.introspect('tmp-2');
      expect(introspect).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  test('concurrent requests of one token ask core once', async () => {
    const introspect = vi.fn(async () => active(new Date(Date.now() + 3_600_000)));
    const introspector = createTokenIntrospector(introspect, { audiences: ['https://extension.example'] });

    await Promise.all([introspector.introspect('tmp-1'), introspector.introspect('tmp-1')]);
    expect(introspect).toHaveBeenCalledTimes(1);
  });
});
