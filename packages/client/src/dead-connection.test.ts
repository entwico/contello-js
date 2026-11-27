import { closeTestServers, onCloseTestServers, startProxy } from '@entwico/dash/testing/node';
import { afterEach, describe, expect, test } from 'vitest';

import { ContelloClient } from './client';
import { ContelloConnectionLostError } from './connection';
import { ENTITY_BATCHES, ENTITY_COUNT, connectTo, query, startContello, startSilentServer, until } from './test-servers';

afterEach(closeTestServers);

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

describe('a connection on a slow path, where a pong waits behind the data', () => {
  test('stays on one socket while a stream keeps arriving', async () => {
    const contello = await startContello({ pongDelay: 600 });
    const { client, count } = connectTo(contello.port);
    const ids: string[] = [];

    const completed = new Promise<void>((resolve, reject) => {
      client.subscribe<{ entities: { id: string }[] }>(
        { query: 'subscription { entities }' },
        {
          next: (message) => void ids.push(...(message.data?.entities ?? []).map((it) => it.id)),
          error: reject,
          complete: resolve,
        },
      );
    });

    // a connection that is given up while it streams starts the stream over, every time
    await Promise.race([completed, until(() => count('connecting') > 1)]);

    expect(count('connecting')).toBe(1);
    expect(ids).toHaveLength(ENTITY_COUNT);
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

type Entities = { entities: { id: string }[] };

async function connectClient(port: number, onReconnecting?: (() => void) | undefined): Promise<ContelloClient> {
  const client = new ContelloClient({ url: `http://127.0.0.1:${port}`, project: 'test', token: 'token', onReconnecting });

  onCloseTestServers(() => client.destroy());
  await client.init();

  return client;
}

describe('a ContelloClient whose connection is lost', () => {
  test('rejects a subscription and does not send it again', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    const ids: string[] = [];

    const read = (async () => {
      for await (const batch of client.subscribe<Entities>('subscription { entities }')) {
        ids.push(...batch.entities.map((it) => it.id));
      }
    })();

    await until(() => contello.batchesSent() >= 10);
    contello.dropConnections();

    await expect(read).rejects.toBeInstanceOf(ContelloConnectionLostError);

    // the next connection is up, and carries nothing of the subscription
    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });
    expect(contello.streamsStarted()).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('sends a subscription with retry again, and it goes on', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);
    let batches = 0;

    const read = (async () => {
      for await (const _batch of client.subscribeWithRetry<Entities>('subscription { entities }')) {
        batches++;
      }
    })();

    await until(() => contello.batchesSent() >= 10);
    contello.dropConnections();
    await read;

    expect(contello.streamsStarted()).toBe(2);
    expect(batches).toBeGreaterThan(ENTITY_BATCHES);
  }, 15_000);

  test('rejects an execute that was in flight and does not send it again', async () => {
    const contello = await startContello();
    const client = await connectClient(contello.port);

    const answer = client.execute('{ slow }');

    await until(() => contello.slowCalls() === 1);
    contello.dropConnections();

    await expect(answer).rejects.toBeInstanceOf(ContelloConnectionLostError);

    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });
    expect(contello.slowCalls()).toBe(1);
  });

  test('answers an execute that was sent while no connection was up', async () => {
    const contello = await startContello();
    let reconnecting = false;

    const client = await connectClient(contello.port, () => {
      reconnecting = true;
    });

    contello.dropConnections();
    await until(() => reconnecting);

    await expect(client.execute('{ greeting }')).resolves.toEqual({ greeting: 'hello' });
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

  test('reads every entity of a collection once when the connection drops while it streams', async () => {
    const contello = await startContello();
    const client = new ContelloClient({ url: `http://127.0.0.1:${contello.port}`, project: 'test', token: 'token' });

    await client.init();

    const read = client.collect<{ entities: { id: string }[] }>('subscription { entities }');

    await until(() => contello.batchesSent() >= 10);
    contello.dropConnections();

    const batches = await read;
    const ids = batches.flatMap((batch) => batch.entities.map((it) => it.id));

    await client.destroy();

    expect(new Set(ids).size).toBe(ENTITY_COUNT);
    expect(ids).toHaveLength(ENTITY_COUNT);
  }, 15_000);

  test('rejects the read of a collection that the end of the client cuts off', async () => {
    const contello = await startContello();
    const client = new ContelloClient({ url: `http://127.0.0.1:${contello.port}`, project: 'test', token: 'token' });

    await client.init();

    const read = client.collect('subscription { entities }');

    await until(() => contello.batchesSent() >= 5);

    await Promise.all([expect(read).rejects.toThrow('destroyed before the read finished'), client.destroy()]);
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
