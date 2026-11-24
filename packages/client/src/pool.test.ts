import type { Client } from 'graphql-ws';
import { type Mock, describe, expect, test, vi } from 'vitest';
import { ConnectionPool } from './pool';

const createMockClient = () => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  const client = {
    subscribe: vi.fn(() => () => {}),
    iterate: vi.fn(),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }

      listeners.get(event)!.add(listener);

      return () => {
        listeners.get(event)?.delete(listener);
      };
    }),
    dispose: vi.fn(() => {
      const closedListeners = listeners.get('closed') ?? [];

      for (const listener of closedListeners) {
        queueMicrotask(() => listener(null));
      }
    }),
    terminate: vi.fn(() => {}),
    _emit: (event: string, ...args: any[]) => {
      const eventListeners = listeners.get(event) ?? [];

      for (const listener of eventListeners) {
        listener(...args);
      }
    },
  } as unknown as Client & { _emit: (event: string, ...args: any[]) => void };

  return client;
};

describe('ConnectionPool', () => {
  test('throws when getting client before connect', () => {
    const pool = new ConnectionPool(() => createMockClient(), 3);

    expect(() => pool.get()).toThrow('connection pool is empty');
  });

  test('creates clients on connect and waits for connected events', async () => {
    const clients: ReturnType<typeof createMockClient>[] = [];
    const factory = vi.fn(() => {
      const client = createMockClient();
      clients.push(client);

      queueMicrotask(() => client._emit('connected', null, undefined, false));

      return client;
    });

    const pool = new ConnectionPool(factory, 3);

    await pool.connect();

    expect(factory).toHaveBeenCalledTimes(3);
  });

  test('connect resolves only after all clients are connected', async () => {
    const clients: ReturnType<typeof createMockClient>[] = [];
    const factory = vi.fn(() => {
      const client = createMockClient();
      clients.push(client);

      return client;
    });

    const pool = new ConnectionPool(factory, 2);

    let connected = false;

    const connectPromise = (async () => {
      await pool.connect();
      connected = true;
    })();

    await Promise.resolve();
    expect(connected).toBe(false);

    clients[0]!._emit('connected', null, undefined, false);
    await Promise.resolve();
    expect(connected).toBe(false);

    clients[1]!._emit('connected', null, undefined, false);
    await connectPromise;
    expect(connected).toBe(true);
  });

  test('round-robins clients', async () => {
    const a = createMockClient();
    const b = createMockClient();
    const clients = [a, b];
    let index = 0;
    const pool = new ConnectionPool(() => clients[index++]!, 2);

    const connectPromise = pool.connect();

    a._emit('connected', null, undefined, false);
    b._emit('connected', null, undefined, false);

    await connectPromise;

    expect(pool.get()).toBe(a);
    expect(pool.get()).toBe(b);
    expect(pool.get()).toBe(a);
  });

  test('disconnect disposes all clients and waits for closed events', async () => {
    const a = createMockClient();
    const b = createMockClient();
    const clients = [a, b];
    let index = 0;
    const pool = new ConnectionPool(() => clients[index++]!, 2);

    const connectPromise = pool.connect();

    a._emit('connected', null, undefined, false);
    b._emit('connected', null, undefined, false);

    await connectPromise;
    await pool.disconnect();

    expect(a.dispose as Mock).toHaveBeenCalledTimes(1);
    expect(b.dispose as Mock).toHaveBeenCalledTimes(1);
  });

  test('disconnect gives up a client that never connected instead of waiting for it', async () => {
    const connected = createMockClient();
    const pending = createMockClient();
    const clients = [connected, pending];
    let index = 0;
    const pool = new ConnectionPool(() => clients[index++]!, 2, 10);

    const connectPromise = pool.connect();

    connected._emit('connected', null, undefined, false);

    await connectPromise;
    await pool.disconnect();

    expect(connected.terminate as Mock).not.toHaveBeenCalled();
    expect(pending.terminate as Mock).toHaveBeenCalledOnce();
  });

  test('disconnect survives a dispose that rejects', async () => {
    const client = createMockClient();

    (client.dispose as Mock).mockImplementation(() => {
      queueMicrotask(() => client._emit('closed', null));

      return Promise.reject(new Error('pending connection attempt failed'));
    });

    const pool = new ConnectionPool(() => client, 1);
    const connectPromise = pool.connect();

    client._emit('connected', null, undefined, false);

    await connectPromise;
    await expect(pool.disconnect()).resolves.toBeUndefined();
  });

  test('throws after disconnect', async () => {
    const client = createMockClient();
    const pool = new ConnectionPool(() => client, 1);

    const connectPromise = pool.connect();

    client._emit('connected', null, undefined, false);

    await connectPromise;
    await pool.disconnect();

    expect(() => pool.get()).toThrow('connection pool is empty');
  });
});
