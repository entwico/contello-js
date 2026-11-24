import { afterEach, describe, expect, test } from 'vitest';

import { ContelloClient } from './client';
import { cleanup, connectTo, query, startContello, startProxy, startSilentServer, until } from './test-servers';

afterEach(cleanup);

describe('a connection to a live server', () => {
  test('answers and stays on one socket while pings are answered', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const { client, count } = connectTo(proxy.port);

    await expect(query(client, '{ greeting }')).resolves.toEqual({ greeting: 'hello' });

    // several keep-alive rounds and reply timeouts later
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await expect(query(client, '{ greeting }')).resolves.toEqual({ greeting: 'hello' });
    expect(count('connecting')).toBe(1);
    expect(proxy.accepted()).toBe(1);
  });
});

describe.each(['swallow', 'stall'] as const)('a connection whose path went dead (%s)', (mode) => {
  test('answers an operation that was sent after the path died', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const { client, count } = connectTo(proxy.port);

    await until(() => count('connected') === 1);
    proxy.kill(mode);

    await expect(query(client, '{ greeting }')).resolves.toEqual({ greeting: 'hello' });
    expect(count('connected')).toBeGreaterThanOrEqual(2);
  });

  test('answers an operation that was in flight when the path died', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const { client } = connectTo(proxy.port);

    const answer = query(client, '{ slow }');

    await until(() => contello.slowCalls() === 1);
    proxy.kill(mode);
    contello.releaseSlow();

    // the first answer went into the dead path, the operation was sent again on the new socket
    await expect(answer).resolves.toEqual({ slow: 'answer 2' });
  });

  test('closes the socket it gave up', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const { client, count } = connectTo(proxy.port);

    await until(() => count('connected') === 1);
    proxy.kill(mode);
    await query(client, '{ greeting }');
    proxy.readStalled();

    // only the socket in use is left
    await until(() => proxy.open() === 1);
    expect(proxy.accepted()).toBeGreaterThanOrEqual(2);
  });
});

describe.each([
  'never upgrades',
  'never acknowledges',
  'never answers a ping',
] as const)('a connection to a server that %s', (silence) => {
  test('keeps reconnecting and closes every socket it gave up', async () => {
    const silent = await startSilentServer(silence);
    const { count } = connectTo(silent.port);

    await until(() => silent.accepted() >= 4);

    // all but the attempt that is running now
    await until(() => silent.open() <= 1);
    expect(count('connecting')).toBeGreaterThanOrEqual(4);
  });

  test('ends when it is disposed, and leaves no socket open', async () => {
    const silent = await startSilentServer(silence);
    const { client, count } = connectTo(silent.port);

    await until(() => silent.accepted() >= 1);

    const closedBefore = count('closed');

    try {
      await client.dispose();
    } catch {
      // expected: the attempt that was pending is given up
    }

    await until(() => silent.open() === 0);

    const attempts = count('connecting');

    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(count('connecting')).toBe(attempts);
    expect(count('closed')).toBeGreaterThanOrEqual(closedBefore);
  });
});

describe('ContelloClient over a real socket', () => {
  test('connects, answers and disconnects', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const client = new ContelloClient({ url: `http://127.0.0.1:${proxy.port}`, project: 'test', token: 'token' });

    await client.init();

    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });

    await client.destroy();
    await until(() => proxy.open() === 0);
  });

  test('disconnects from a server that never acknowledged it', async () => {
    const silent = await startSilentServer('never acknowledges');
    const client = new ContelloClient({
      url: `http://127.0.0.1:${silent.port}`,
      project: 'test',
      token: 'token',
      onError: () => {},
    });

    void client.init();
    await until(() => silent.accepted() >= 1);

    await client.destroy();
    await until(() => silent.open() === 0);
  });
});
