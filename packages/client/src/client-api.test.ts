import { afterEach, describe, expect, test, vi } from 'vitest';

import { type ContelloClientOptions, createContelloClient } from './client';
import { ContelloConnectionLostError } from './connection';

type Sink = {
  next: (message: { data: unknown }) => void;
  error: (error: unknown) => void;
  complete: () => void;
};

type Operation = { payload: { query: string; variables?: Record<string, unknown> }; sink: Sink; disposed: boolean };

type FakeConnection = {
  options: { url: string; connectionParams: unknown; on: Record<string, ((...args: unknown[]) => void) | undefined> };
  operations: Operation[];
  /** an event of the socket, to the connection's own handlers and to whoever listens on the client */
  emit: (event: string, ...args: unknown[]) => void;
};

const ws = vi.hoisted(() => ({
  connections: [] as unknown[],
  connectOnCreate: true,
}));

const http = vi.hoisted(() => ({
  agent: { close: vi.fn(async () => {}) },
  downloadFile: vi.fn(async () => 'downloaded'),
  proxyHls: vi.fn(async () => 'hls'),
  proxySitemap: vi.fn(async () => 'sitemap'),
  upload: vi.fn(async () => 'asset-id'),
}));

vi.mock('graphql-ws', () => ({
  createClient: (options: FakeConnection['options']) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const operations: Operation[] = [];

    const emit = (event: string, ...args: unknown[]) => {
      options.on[event]?.(...args);

      const listening = listeners.get(event) ?? [];

      for (const listener of listening) {
        listener(...args);
      }
    };

    ws.connections.push({ options, operations, emit });

    if (ws.connectOnCreate) {
      queueMicrotask(() => emit('connected'));
    }

    return {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();

        listeners.set(event, set.add(listener));

        return () => void set.delete(listener);
      },
      subscribe: (payload: Operation['payload'], sink: Sink) => {
        const operation = { payload, sink, disposed: false };

        operations.push(operation);

        return () => {
          operation.disposed = true;
        };
      },
      dispose: () => emit('closed'),
      terminate: () => {},
    };
  },
}));

vi.mock('./http', () => ({
  createHttpAgent: () => http.agent,
  downloadFile: http.downloadFile,
  proxyHls: http.proxyHls,
  proxySitemap: http.proxySitemap,
}));

vi.mock('./upload', () => ({ upload: http.upload }));

const connections = ws.connections as FakeConnection[];
const base = { url: 'https://contello.example.com', project: 'project-1', token: 'token-1' };

async function connect<T extends Partial<ContelloClientOptions<any>>>(options?: T) {
  const client = createContelloClient({ ...base, ...options } as ContelloClientOptions<any>);

  await client.init();

  return client;
}

/** the operation that was sent last, on any connection */
function lastOperation(): Operation {
  return connections.flatMap((connection) => connection.operations).at(-1)!;
}

afterEach(() => {
  connections.length = 0;
  ws.connectOnCreate = true;
  vi.clearAllMocks();
});

describe('ContelloClient connections', () => {
  test('opens a websocket per pool connection at the graphql endpoint of the project', async () => {
    const client = await connect({ connections: 3 });

    expect(connections).toHaveLength(3);
    expect(connections[0]!.options.url).toBe('wss://contello.example.com/graphql/projects/project-1');
    expect(connections[0]!.options.connectionParams).toEqual({ token: 'token-1' });

    await client.destroy();
  });

  test('a plain http url becomes a plain ws url', async () => {
    const client = await connect({ url: 'http://localhost:3000' });

    expect(connections[0]!.options.url).toBe('ws://localhost:3000/graphql/projects/project-1');

    await client.destroy();
  });

  test('refuses an operation before init()', () => {
    const client = createContelloClient(base);

    expect(() => client.subscribe('subscription { x }')[Symbol.asyncIterator]()).toThrow('call client.init() first');
  });

  test('onConnected fires once, when every connection of the pool is up', async () => {
    ws.connectOnCreate = false;

    const onConnected = vi.fn();
    const client = createContelloClient({ ...base, connections: 2, onConnected });
    const ready = client.init();

    connections[0]!.emit('connected');

    expect(onConnected).not.toHaveBeenCalled();

    connections[1]!.emit('connected');

    await ready;

    expect(onConnected).toHaveBeenCalledTimes(1);

    await client.destroy();
  });

  test('onReconnecting fires once for an outage, onConnected again when the pool is back', async () => {
    const onConnected = vi.fn();
    const onReconnecting = vi.fn();
    const client = await connect({ connections: 2, onConnected, onReconnecting });

    connections[0]!.emit('closed');
    connections[1]!.emit('closed');

    expect(onReconnecting).toHaveBeenCalledTimes(1);

    connections[0]!.emit('connected');

    expect(onConnected).toHaveBeenCalledTimes(1);

    connections[1]!.emit('connected');

    expect(onConnected).toHaveBeenCalledTimes(2);

    await client.destroy();
  });

  test('a connection that never came up does not count as an outage', async () => {
    ws.connectOnCreate = false;

    const onReconnecting = vi.fn();
    const client = createContelloClient({ ...base, onReconnecting });

    void client.init();

    connections[0]!.emit('closed');

    expect(onReconnecting).not.toHaveBeenCalled();

    connections[0]!.emit('connected');

    await client.destroy();
  });

  test('connection events name the connection they are about', async () => {
    const connectionEvents = { onConnecting: vi.fn(), onConnected: vi.fn(), onClosed: vi.fn(), onError: vi.fn() };
    const onError = vi.fn();
    const client = await connect({ connections: 2, connectionEvents, onError });
    const second = { connectionId: '2', websocketUrl: 'wss://contello.example.com/graphql/projects/project-1' };
    const failure = new Error('socket failed');

    expect(connectionEvents.onConnected.mock.calls.map(([context]) => context.connectionId)).toEqual(['1', '2']);

    connections[1]!.emit('error', failure);
    connections[1]!.emit('closed');
    connections[1]!.emit('connecting');

    expect(connectionEvents.onError).toHaveBeenCalledWith(second, failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(connectionEvents.onClosed).toHaveBeenCalledWith(second);
    expect(connectionEvents.onConnecting).toHaveBeenCalledWith(second);

    connections[1]!.emit('connected');

    await client.destroy();
  });

  test('destroy() closes the sockets and the http agent', async () => {
    const onClosed = vi.fn();
    const client = await connect({ connections: 2, connectionEvents: { onClosed } });

    await client.destroy();

    expect(onClosed).toHaveBeenCalledTimes(2);
    expect(http.agent.close).toHaveBeenCalledTimes(1);
  });
});

describe('ContelloClient.subscribe', () => {
  test('delivers the messages that arrived before they were asked for, in order, then ends', async () => {
    const client = await connect();
    const iterator = client.subscribe<{ n: number }>('subscription { n }', { from: 1 })[Symbol.asyncIterator]();
    const { payload, sink } = lastOperation();

    expect(payload).toEqual({ query: 'subscription { n }', variables: { from: 1 } });

    sink.next({ data: { n: 1 } });
    sink.next({ data: { n: 2 } });
    sink.complete();

    expect(await iterator.next()).toEqual({ value: { n: 1 }, done: false });
    expect(await iterator.next()).toEqual({ value: { n: 2 }, done: false });

    const end = await iterator.next();

    expect(end.done).toBe(true);

    await client.destroy();
  });

  test('skips messages without data', async () => {
    const client = await connect();
    const iterator = client.subscribe<{ n: number }>('subscription { n }')[Symbol.asyncIterator]();
    const { sink } = lastOperation();

    sink.next({ data: null });
    sink.next({ data: undefined });
    sink.next({ data: { n: 1 } });

    expect(await iterator.next()).toEqual({ value: { n: 1 }, done: false });

    await client.destroy();
  });

  test('rejects with the error of the server, now and for every later read', async () => {
    const client = await connect();
    const iterator = client.subscribe('subscription { n }')[Symbol.asyncIterator]();
    const failure = new Error('not allowed');
    const pending = iterator.next();

    lastOperation().sink.error(failure);

    await expect(pending).rejects.toBe(failure);
    await expect(iterator.next()).rejects.toBe(failure);

    await client.destroy();
  });

  test('ends the server subscription when the reader stops', async () => {
    const client = await connect();

    queueMicrotask(() => lastOperation().sink.next({ data: { n: 1 } }));

    for await (const _ of client.subscribe('subscription { n }')) {
      break;
    }

    expect(lastOperation().disposed).toBe(true);

    await client.destroy();
  });

  test('ends the server subscription when the reader throws into it', async () => {
    const client = await connect();
    const iterator = client.subscribe('subscription { n }')[Symbol.asyncIterator]();
    const failure = new Error('reader failed');

    await expect(iterator.throw!(failure)).rejects.toBe(failure);
    expect(lastOperation().disposed).toBe(true);

    await client.destroy();
  });

  test('rejects with ContelloConnectionLostError when its connection is lost', async () => {
    const client = await connect();
    const iterator = client.subscribe('subscription { n }')[Symbol.asyncIterator]();
    const pending = iterator.next();

    connections[0]!.emit('closed');

    await expect(pending).rejects.toBeInstanceOf(ContelloConnectionLostError);
    expect(lastOperation().disposed).toBe(true);

    connections[0]!.emit('connected');

    await client.destroy();
  });

  test('one that was opened without a connection waits for the next one', async () => {
    const client = await connect();

    connections[0]!.emit('closed');

    const iterator = client.subscribe<{ n: number }>('subscription { n }')[Symbol.asyncIterator]();
    const pending = iterator.next();

    // the attempt to reconnect fails once more
    connections[0]!.emit('closed');
    connections[0]!.emit('connected');
    lastOperation().sink.next({ data: { n: 1 } });

    await expect(pending).resolves.toEqual({ value: { n: 1 }, done: false });

    await client.destroy();
  });

  test('subscribeWithRetry() goes on after its connection was lost', async () => {
    const client = await connect();
    const iterator = client.subscribeWithRetry<{ n: number }>('subscription { n }')[Symbol.asyncIterator]();
    const pending = iterator.next();

    connections[0]!.emit('closed');
    connections[0]!.emit('connected');
    lastOperation().sink.next({ data: { n: 1 } });

    await expect(pending).resolves.toEqual({ value: { n: 1 }, done: false });
    expect(lastOperation().disposed).toBe(false);

    await client.destroy();
  });

  test('spreads subscriptions over the connections of the pool', async () => {
    const client = await connect({ connections: 2 });

    for (let i = 0; i < 4; i++) {
      client.subscribe('subscription { n }')[Symbol.asyncIterator]();
    }

    expect(connections.map((connection) => connection.operations.length)).toEqual([2, 2]);

    await client.destroy();
  });
});

describe('ContelloClient.collect', () => {
  test('answers with every message once the subscription ends', async () => {
    const client = await connect();
    const collected = client.collect<{ n: number }>('subscription { n }', { size: 2 });
    const { payload, sink } = lastOperation();

    sink.next({ data: { n: 1 } });
    sink.next({ data: null });
    sink.next({ data: { n: 2 } });
    sink.complete();

    await expect(collected).resolves.toEqual([{ n: 1 }, { n: 2 }]);
    expect(payload.variables).toEqual({ size: 2 });

    await client.destroy();
  });

  test('starts over when the connection was lost on the way', async () => {
    const client = await connect();
    const collected = client.collect<{ n: number }>('subscription { n }');
    const { sink } = lastOperation();

    sink.next({ data: { n: 1 } });
    connections[0]!.emit('closed');
    connections[0]!.emit('connected');
    sink.next({ data: { n: 1 } });
    sink.next({ data: { n: 2 } });
    sink.complete();

    await expect(collected).resolves.toEqual([{ n: 1 }, { n: 2 }]);

    await client.destroy();
  });

  test('rejects with the error of the server', async () => {
    const client = await connect();
    const collected = client.collect('subscription { n }');
    const failure = new Error('not allowed');

    lastOperation().sink.error(failure);

    await expect(collected).rejects.toBe(failure);

    await client.destroy();
  });

  test('rejects a read that the end of the client cut off', async () => {
    const client = await connect();
    const collected = client.collect('subscription { n }');
    const { sink } = lastOperation();

    sink.next({ data: { n: 1 } });
    connections[0]!.emit('closed');
    sink.complete();

    await expect(collected).rejects.toThrow('the client was destroyed before the read finished');
  });
});

describe('ContelloClient queries', () => {
  test('execute() answers with the first message and ends the operation', async () => {
    const client = await connect();
    const answer = client.execute<{ n: number }>('query { n }', { id: '1' });

    await vi.waitFor(() => expect(connections[0]!.operations).toHaveLength(1));

    const operation = lastOperation();

    operation.sink.next({ data: { n: 1 } });

    await expect(answer).resolves.toEqual({ n: 1 });
    expect(operation.payload).toEqual({ query: 'query { n }', variables: { id: '1' } });
    expect(operation.disposed).toBe(true);

    await client.destroy();
  });

  test('ping() resolves on a pong and rejects on anything else', async () => {
    const client = await connect();
    const pingAnsweredWith = async (response: string) => {
      const count = connections[0]!.operations.length;
      const answer = client.ping();

      await vi.waitFor(() => expect(connections[0]!.operations.length).toBeGreaterThan(count));

      lastOperation().sink.next({ data: { contelloPing: { response } } });

      return answer;
    };

    await expect(pingAnsweredWith('pong')).resolves.toBeUndefined();
    expect(lastOperation().payload.query).toContain('contelloPing');

    await expect(pingAnsweredWith('busy')).rejects.toThrow('unexpected ping response: busy');

    await client.destroy();
  });

  test('introspectToken() asks core what the token stands for', async () => {
    const client = await connect();
    const user = { id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };
    const introspection = client.introspectToken('temporary-token');

    await vi.waitFor(() => expect(connections[0]!.operations).toHaveLength(1));

    const { payload, sink } = lastOperation();

    sink.next({
      data: {
        contelloIntrospectToken: {
          active: true,
          audience: 'https://extension.example.com',
          expiresAt: '2030-01-01T00:00:00.000Z',
          user,
          permissions: null,
        },
      },
    });

    await expect(introspection).resolves.toEqual({
      active: true,
      audience: 'https://extension.example.com',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      user,
      permissions: [],
    });
    expect(payload.variables).toEqual({ token: 'temporary-token' });

    await client.destroy();
  });
});

describe('ContelloClient schema accessors', () => {
  test('rpc and sources are refused without a schema that carries them', () => {
    const client = createContelloClient(base);

    expect(() => client.rpc).toThrow('.rpc accessed without a schema containing operations');
    expect(() => client.sources).toThrow('.sources accessed without a schema containing sources');
  });

  test('rpc runs the operations of the schema', async () => {
    const schema = {
      operations: {
        getArticle: { document: 'query GetArticle { article }', kind: 'query' },
        watchArticles: { document: 'subscription WatchArticles { articles }', kind: 'subscription' },
      },
      sources: {},
      models: {},
    } as const;
    const client = await connect({ schema });
    const rpc = client.rpc as unknown as {
      getArticle: (variables: { id: string }) => Promise<unknown>;
      watchArticles: () => AsyncIterable<unknown>;
      watchArticlesWithRetry: () => AsyncIterable<unknown>;
    };

    const article = rpc.getArticle({ id: '1' });

    await vi.waitFor(() => expect(connections[0]!.operations).toHaveLength(1));

    lastOperation().sink.next({ data: { article: 'first' } });

    await expect(article).resolves.toEqual({ article: 'first' });
    expect(lastOperation().payload).toEqual({ query: 'query GetArticle { article }', variables: { id: '1' } });

    const plain = rpc.watchArticles()[Symbol.asyncIterator]().next();

    connections[0]!.emit('closed');

    await expect(plain).rejects.toBeInstanceOf(ContelloConnectionLostError);

    connections[0]!.emit('connected');

    const retrying = rpc.watchArticlesWithRetry()[Symbol.asyncIterator]().next();

    connections[0]!.emit('closed');
    connections[0]!.emit('connected');
    lastOperation().sink.next({ data: { articles: [] } });

    await expect(retrying).resolves.toEqual({ value: { articles: [] }, done: false });

    await client.destroy();
  });

  test('sources read the sources of the schema', async () => {
    const schema = {
      operations: {},
      sources: {
        articles: {
          document: 'fragment Article on ArticleEntity { id }',
          fragment: 'Article',
          subscription: 'articlesBatch',
          __model: 'article',
          __cardinality: 'entity',
        },
      },
      models: { article: 'ArticleEntity' },
    } as const;
    const client = await connect({ schema });
    const articles = (client.sources as unknown as { articles: { fetch: () => Promise<unknown[]> } }).articles.fetch();

    await vi.waitFor(() => expect(connections[0]!.operations).toHaveLength(1));

    const { payload, sink } = lastOperation();

    sink.next({ data: { source: [{ id: 'a' }] } });
    sink.next({ data: { source: [{ id: 'b' }] } });
    sink.complete();

    await expect(articles).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(payload.query).toContain('articlesBatch');

    await client.destroy();
  });
});

describe('ContelloClient http transport', () => {
  test('download() fetches the file with the token of the client', async () => {
    const client = createContelloClient(base);

    await expect(client.download('file-1')).resolves.toBe('downloaded');
    expect(http.downloadFile).toHaveBeenCalledWith(http.agent, base.url, base.token, 'file-1');
  });

  test('proxyHls() passes the path and the abort signal', async () => {
    const client = createContelloClient(base);
    const { signal } = new AbortController();

    await expect(client.proxyHls('video/index.m3u8', signal)).resolves.toBe('hls');
    expect(http.proxyHls).toHaveBeenCalledWith(http.agent, base.url, base.token, 'video/index.m3u8', signal);
  });

  test('proxySitemap() asks for the sitemap of the project of the client', async () => {
    const client = createContelloClient(base);
    const { signal } = new AbortController();
    const options = { source: 'articles', page: '2' };

    await expect(client.proxySitemap('sitemap-1', options, signal)).resolves.toBe('sitemap');
    expect(http.proxySitemap).toHaveBeenCalledWith(
      http.agent,
      base.url,
      base.token,
      base.project,
      'sitemap-1',
      options,
      signal,
    );
  });

  test('upload() uploads into the project of the client', async () => {
    const client = createContelloClient(base);
    const data = new Uint8Array([1, 2, 3]);
    const meta = { name: 'pixel.png', mimeType: 'image/png' };
    const options = { collection: 'images' };

    await expect(client.upload(data as never, meta as never, options as never)).resolves.toBe('asset-id');
    expect(http.upload).toHaveBeenCalledWith(base.url, base.project, base.token, data, meta, options);
  });
});
