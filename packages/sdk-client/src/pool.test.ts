import { describe, expect, mock, test } from 'bun:test';
import type { Client } from 'graphql-ws';
import { ConnectionPool } from './pool';

const createMockClient = () => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  const client = {
    subscribe: mock(() => () => {}),
    iterate: mock(),
    on: mock((event: string, listener: (...args: any[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }

      listeners.get(event)!.add(listener);

      return () => {
        listeners.get(event)?.delete(listener);
      };
    }),
    dispose: mock(() => {
      for (const listener of listeners.get('closed') ?? []) {
        queueMicrotask(() => listener(null));
      }
    }),
    terminate: mock(() => {}),
    _emit: (event: string, ...args: any[]) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  } as unknown as Client & { _emit: (event: string, ...args: any[]) => void };

  return client;
};

describe('ConnectionPool', () => {
  test('throws when getting client before connect', () => {
    const pool = new ConnectionPool(() => createMockClient(), 3);

    expect(() => pool.get()).toThrow('Connection pool is empty');
  });

  test('creates clients on connect and waits for connected events', async () => {
    const clients: ReturnType<typeof createMockClient>[] = [];
    const factory = mock(() => {
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
    const factory = mock(() => {
      const client = createMockClient();
      clients.push(client);

      return client;
    });

    const pool = new ConnectionPool(factory, 2);

    let connected = false;

    const connectPromise = pool.connect().then(() => {
      connected = true;
    });

    // not yet connected
    await Promise.resolve();
    expect(connected).toBe(false);

    // connect first client
    clients[0]!._emit('connected', null, undefined, false);
    await Promise.resolve();
    expect(connected).toBe(false);

    // connect second client
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

    expect(a.dispose as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    expect(b.dispose as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
  });

  test('throws after disconnect', async () => {
    const client = createMockClient();
    const pool = new ConnectionPool(() => client, 1);

    const connectPromise = pool.connect();

    client._emit('connected', null, undefined, false);

    await connectPromise;
    await pool.disconnect();

    expect(() => pool.get()).toThrow('Connection pool is empty');
  });
});
