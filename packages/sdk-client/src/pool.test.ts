import { describe, expect, mock, test } from 'bun:test';
import type { Client } from 'graphql-ws';
import { ConnectionPool } from './pool';

const createMockClient = () =>
  ({
    subscribe: mock(() => () => {}),
    iterate: mock(),
    on: mock(() => () => {}),
    dispose: mock(() => {}),
    terminate: mock(() => {}),
  }) as unknown as Client;

describe('ConnectionPool', () => {
  test('throws when getting client before connect', () => {
    const pool = new ConnectionPool(() => createMockClient(), 3);

    expect(() => pool.get()).toThrow('Connection pool is empty');
  });

  test('creates clients on connect', () => {
    const factory = mock(() => createMockClient());
    const pool = new ConnectionPool(factory, 3);

    pool.connect();

    expect(factory).toHaveBeenCalledTimes(3);
  });

  test('round-robins clients', () => {
    const a = createMockClient();
    const b = createMockClient();
    const clients = [a, b];
    let index = 0;
    const pool = new ConnectionPool(() => clients[index++]!, 2);

    pool.connect();

    expect(pool.get()).toBe(a);
    expect(pool.get()).toBe(b);
    expect(pool.get()).toBe(a);
  });

  test('disposes all clients on disconnect', () => {
    const a = createMockClient();
    const b = createMockClient();
    const clients = [a, b];
    let index = 0;
    const pool = new ConnectionPool(() => clients[index++]!, 2);

    pool.connect();
    pool.disconnect();

    expect(a.dispose as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    expect(b.dispose as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
  });

  test('throws after disconnect', () => {
    const pool = new ConnectionPool(() => createMockClient(), 1);

    pool.connect();
    pool.disconnect();

    expect(() => pool.get()).toThrow('Connection pool is empty');
  });
});
