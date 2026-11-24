import { AsyncLocalStorage } from 'node:async_hooks';

import { afterEach, describe, expect, test } from 'vitest';

import { ContelloClient } from './client';
import { createConnection } from './connection';
import {
  cleanup,
  connectTo,
  query,
  startContello,
  startProxy,
  startSilentServer,
  startUploadServer,
  until,
} from './test-servers';
import { upload } from './upload';

// what must not stay in memory once it is done: a connection lives for the life of the process and
// carries every operation, so whatever it keeps of one operation, it keeps of all of them

function collectGarbage(): void {
  const { gc } = globalThis;

  // skipping would hide every leak these tests exist for
  if (!gc) {
    throw new Error('gc() is missing: the unit project of vitest.config.ts has to run with --expose-gc');
  }

  void gc();
}

/** How many of the referenced objects survive garbage collection. */
async function countAlive(refs: readonly WeakRef<object>[]): Promise<number> {
  let alive = refs.length;

  for (let round = 0; round < 30 && alive > 0; round++) {
    // lets finished promise chains and socket callbacks settle before the next collection
    await new Promise((resolve) => setTimeout(resolve, 10));
    collectGarbage();
    alive = refs.filter((ref) => ref.deref() !== undefined).length;
  }

  return alive;
}

type RequestContext = { id: number; payload: number[] };

const requestContext = new AsyncLocalStorage<RequestContext>();

/** Runs `operation` the way a request handler does: inside an async context of its own. */
async function runInContexts(count: number, operation: () => Promise<unknown>): Promise<WeakRef<object>[]> {
  const refs: WeakRef<object>[] = [];

  for (let id = 0; id < count; id++) {
    const context: RequestContext = { id, payload: Array.from({ length: 1000 }, () => id) };

    refs.push(new WeakRef(context));
    await requestContext.run(context, operation);
  }

  return refs;
}

afterEach(cleanup);

describe('a connection that stays open', () => {
  test('keeps nothing of an operation that finished', async () => {
    const contello = await startContello();
    const { client } = connectTo(contello.port);

    const contexts = await runInContexts(200, () => query(client, '{ greeting }'));

    expect(await countAlive(contexts)).toBe(0);
  });

  test('keeps nothing of operations that ran at the same time', async () => {
    const contello = await startContello();
    const { client } = connectTo(contello.port);

    const contexts = await runInContexts(40, () => Promise.all(Array.from({ length: 5 }, () => query(client, '{ greeting }'))));

    expect(await countAlive(contexts)).toBe(0);
  });

  test('keeps nothing of an operation that was cancelled before its answer', async () => {
    const contello = await startContello();
    const { client } = connectTo(contello.port);

    const contexts = await runInContexts(50, async () => {
      const cancel = client.subscribe({ query: '{ slow }' }, { next: () => {}, error: () => {}, complete: () => {} });

      await new Promise((resolve) => setTimeout(resolve, 1));
      cancel();
    });

    contello.releaseSlow();

    expect(await countAlive(contexts)).toBe(0);
  });

  test('keeps nothing of an operation that survived a dead path', async () => {
    const contello = await startContello();
    const proxy = await startProxy(contello.port);
    const { client, count } = connectTo(proxy.port);

    await until(() => count('connected') === 1);
    proxy.kill('swallow');

    const contexts = await runInContexts(5, () => query(client, '{ greeting }'));

    expect(count('connected')).toBeGreaterThanOrEqual(2);
    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('a ContelloClient that stays open', () => {
  test('keeps nothing of an executed operation', async () => {
    const contello = await startContello();
    const client = new ContelloClient({ url: `http://127.0.0.1:${contello.port}`, project: 'test', token: 'token' });

    await client.init();

    try {
      const contexts = await runInContexts(200, () => client.execute('{ greeting }'));

      expect(await countAlive(contexts)).toBe(0);
    } finally {
      await client.destroy();
    }
  });

  test('keeps nothing of a subscription that was read to its end', async () => {
    const contello = await startContello();
    const client = new ContelloClient({ url: `http://127.0.0.1:${contello.port}`, project: 'test', token: 'token' });

    await client.init();

    try {
      const contexts = await runInContexts(200, async () => {
        for await (const _message of client.subscribe('{ greeting }')) {
          // read to the end
        }
      });

      expect(await countAlive(contexts)).toBe(0);
    } finally {
      await client.destroy();
    }
  });
});

describe('what a connection gave up', () => {
  test('sockets of a server that stopped answering are collected', async () => {
    const silent = await startSilentServer('never answers a ping');
    const { client } = connectTo(silent.port);
    const sockets: WeakRef<object>[] = [];

    client.on('opened', (socket) => void sockets.push(new WeakRef(socket as object)));

    await until(() => sockets.length >= 5);

    // the last ones may still be in use
    expect(await countAlive(sockets.slice(0, 3))).toBe(0);
  });

  test('a disposed connection is collected, with its socket', async () => {
    const contello = await startContello();
    const refs: WeakRef<object>[] = [];

    await (async () => {
      const client = createConnection({ url: `ws://127.0.0.1:${contello.port}`, token: 'token', onFatalError: () => {} });
      const { promise: connected, resolve } = Promise.withResolvers<void>();

      refs.push(new WeakRef(client));
      client.on('opened', (socket) => void refs.push(new WeakRef(socket as object)));
      client.on('connected', () => resolve());

      await connected;
      await query(client, '{ greeting }');
      await client.dispose();
    })();

    expect(await countAlive(refs)).toBe(0);
  });

  test('a destroyed ContelloClient is collected', async () => {
    const contello = await startContello();
    const refs: WeakRef<object>[] = [];

    await (async () => {
      const client = new ContelloClient({ url: `http://127.0.0.1:${contello.port}`, project: 'test', token: 'token' });

      refs.push(new WeakRef(client));

      await client.init();
      await client.execute('{ greeting }');
      await client.destroy();
    })();

    expect(await countAlive(refs)).toBe(0);
  });
});

describe('an upload', () => {
  const timings = { replyTimeout: 200, stallTimeout: 200, heartbeatTimeout: 200 };

  // the file lives in this frame only: a test that held it would be what keeps it in memory
  async function uploadFile(
    url: string,
    files: WeakRef<object>[],
    abortWhen?: (() => boolean) | undefined,
  ): Promise<string> {
    const file = new Uint8Array(256 * 1024);
    const controller = new AbortController();

    files.push(new WeakRef(file));

    const options = { chunkSize: 64 * 1024, abort: controller.signal };
    const result = upload(url, 'test', 'token', file, { name: 'file.bin' }, options, timings);

    try {
      if (abortWhen) {
        await until(abortWhen);
        controller.abort();
      }

      return await result;
    } catch (error) {
      return String(error);
    }
  }

  test('keeps nothing of a file that was uploaded', async () => {
    const server = await startUploadServer('works');
    const files: WeakRef<object>[] = [];

    for (let index = 0; index < 20; index++) {
      expect(await uploadFile(server.url, files)).toBe('asset');
    }

    expect(await countAlive(files)).toBe(0);
  });

  test('keeps nothing of a file whose upload was given up', async () => {
    const server = await startUploadServer('never acknowledges a chunk');
    const files: WeakRef<object>[] = [];

    for (let index = 0; index < 3; index++) {
      expect(await uploadFile(server.url, files)).toContain('upload stalled');
    }

    expect(await countAlive(files)).toBe(0);
  });

  test('keeps nothing of a file whose upload was aborted', async () => {
    const server = await startUploadServer('never finishes');
    const files: WeakRef<object>[] = [];

    for (let index = 1; index <= 3; index++) {
      const received = index * 256 * 1024;

      expect(await uploadFile(server.url, files, () => server.bytesReceived() === received)).toContain('upload aborted');
    }

    expect(await countAlive(files)).toBe(0);
  });
});
