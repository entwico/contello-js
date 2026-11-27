import { graphqlOperationAttributes } from '@contello/opentelemetry';
import { firstAsync } from '@entwico/dash/async';
import type { Agent } from 'undici';

import { ContelloConnectionLostError, createConnection } from './connection';
import { type OperationOptions, createDeadline } from './deadline';
import {
  type DownloadResult,
  type HttpAgentOptions,
  type ProxyResult,
  type SitemapProxyOptions,
  createHttpAgent,
  downloadFile,
  proxyHls,
  proxySitemap,
} from './http';
import { type TokenIntrospection, introspectToken } from './introspection';
import { ping } from './ping';
import { ConnectionPool } from './pool';
import { buildRpc } from './rpc';
import { createSources } from './sources';
import { wrap } from './telemetry';
import { transformResponse } from './transform-response';
import type { Rpc, Schema, SourceAccessors } from './types';
import { type UploadData, type UploadMetadata, type UploadOptions, upload as uploadAsset } from './upload';

export type ConnectionContext = {
  connectionId: string;
  websocketUrl: string;
};

export type ConnectionEvents = {
  onConnected?: ((context: ConnectionContext) => void) | undefined;
  onConnecting?: ((context: ConnectionContext) => void) | undefined;
  onClosed?: ((context: ConnectionContext) => void) | undefined;
  onError?: ((context: ConnectionContext, error: unknown) => void) | undefined;
};

export type ContelloClientOptions<TSchema extends Schema | undefined = undefined> = {
  url: string;
  project: string;
  token: string;
  schema?: TSchema | undefined;
  connections?: number | undefined;
  http?: HttpAgentOptions | undefined;
  onConnected?: (() => void) | undefined;
  onReconnecting?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  connectionEvents?: ConnectionEvents | undefined;
  /**
   * How long an operation may take when its call passes no signal; without it an operation waits
   * for as long as its connection lives, and for a connection for as long as there is none. It is
   * rejected with a `ContelloTimeoutError`. A read of many messages (`collect()`, the list reads of
   * `sources`) is given this time for each message, not for all of them; a subscription has no
   * deadline.
   */
  operationTimeoutMs?: number | undefined;
};

type Variables = Record<string, unknown> | undefined;

// the options come after the variables: a call that passes them names its variables, if only as undefined
type CallArguments<TOptions> = [variables?: Variables, options?: TOptions | undefined];

export type ExecuteOptions = OperationOptions & {
  /**
   * Sends the operation again when its connection is lost. For a read only: a mutation that is
   * sent again may run twice.
   */
  retry?: boolean | undefined;
};

type PoolState = 'disconnected' | 'connected' | 'reconnecting';

/**
 * One subscription per iteration. `abort` rejects it when its connection is lost, `retry` leaves it to
 * graphql-ws, which sends it again on the next connection.
 */
function openSubscription<TData>(
  pool: ConnectionPool,
  query: string,
  variables: Record<string, unknown> | undefined,
  onConnectionLoss: 'abort' | 'retry',
  signal?: AbortSignal | undefined,
): AsyncIterable<TData> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<TData> {
      const wsClient = pool.get();
      const queue: TData[] = [];
      let pending: { resolve: (r: IteratorResult<TData>) => void; reject: (e: unknown) => void } | undefined;
      let done = false;
      let error: unknown;
      let stopWatching = () => {};

      const fail = (err: unknown) => {
        stopWatching();
        done = true;
        error = err;

        if (!pending) {
          return;
        }

        const p = pending;

        pending = undefined;
        p.reject(err);
      };

      if (onConnectionLoss === 'abort') {
        // a connection that was never up has lost nothing: the operation is sent on the first one
        let sent = pool.isConnected(wsClient);

        const offConnected = wsClient.on('connected', () => {
          sent = true;
        });

        const offClosed = wsClient.on('closed', () => {
          if (!sent || done) {
            return;
          }

          fail(new ContelloConnectionLostError());
          unsubscribe();
        });

        stopWatching = () => {
          offConnected();
          offClosed();
        };
      }

      const unsubscribe = wsClient.subscribe<TData>(
        { query, variables },
        {
          next(msg) {
            const value = transformResponse(msg.data);

            if (value === undefined || value === null) {
              return;
            }

            if (pending) {
              const p = pending;

              pending = undefined;
              p.resolve({ value: value as TData, done: false });
            } else {
              queue.push(value as TData);
            }
          },
          error(err) {
            if (!done) {
              fail(err);
            }
          },
          complete() {
            stopWatching();
            done = true;

            if (!pending) {
              return;
            }

            const p = pending;

            pending = undefined;
            p.resolve({ value: undefined as unknown as TData, done: true });
          },
        },
      );

      if (signal) {
        const watchingConnection = stopWatching;

        const onAbort = () => {
          if (done) {
            return;
          }

          fail(signal.reason);
          unsubscribe();
        };

        stopWatching = () => {
          watchingConnection();
          signal.removeEventListener('abort', onAbort);
        };

        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      return {
        next(): Promise<IteratorResult<TData>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }

          if (error !== undefined) {
            return Promise.reject(error);
          }

          if (done) {
            return Promise.resolve({ value: undefined as unknown as TData, done: true });
          }

          return new Promise<IteratorResult<TData>>((resolve, reject) => {
            pending = { resolve, reject };
          });
        },
        return(): Promise<IteratorResult<TData>> {
          stopWatching();
          unsubscribe();

          return Promise.resolve({ value: undefined as unknown as TData, done: true });
        },
        throw(err): Promise<IteratorResult<TData>> {
          stopWatching();
          unsubscribe();

          return Promise.reject(err);
        },
      };
    },
  };
}

/** The first message of an operation, within the deadline of the call. */
async function firstMessage<TData>(
  pool: ConnectionPool,
  timeoutMs: number | undefined,
  query: string,
  variables: Record<string, unknown> | undefined,
  options: ExecuteOptions | undefined,
): Promise<TData> {
  const deadline = createDeadline(options?.signal, timeoutMs);
  const onConnectionLoss = options?.retry === true ? 'retry' : 'abort';

  try {
    return await firstAsync(openSubscription<TData>(pool, query, variables, onConnectionLoss, deadline.signal));
  } finally {
    deadline.clear();
  }
}

export class ContelloClient<TSchema extends Schema | undefined = undefined> {
  private _pool: ConnectionPool;
  private _rpc: TSchema extends Schema<infer TOps, any, any> ? Rpc<TOps> : undefined;
  private _sources: TSchema extends Schema<any, infer TSources, any> ? SourceAccessors<TSources> : undefined;
  private _url: string;
  private _project: string;
  private _token: string;
  private _agent: Agent;
  private _operationTimeoutMs: number | undefined;

  constructor(options: ContelloClientOptions<TSchema>) {
    const { url, project, token, schema, connections = 1, connectionEvents } = options;

    this._url = url;
    this._project = project;
    this._token = token;
    this._agent = createHttpAgent(options.http);
    this._operationTimeoutMs = options.operationTimeoutMs;

    const websocketUrl = `${url}/graphql/projects/${project}`.replace(/^http/i, 'ws');

    let state: PoolState = 'disconnected';
    let connectedCount = 0;

    const onConnectionUp = () => {
      connectedCount++;

      if (connectedCount !== connections || state === 'connected') {
        return;
      }

      state = 'connected';
      options.onConnected?.();
    };

    const onConnectionDown = () => {
      if (connectedCount > 0) {
        connectedCount--;
      }

      if (state !== 'connected') {
        return;
      }

      state = 'reconnecting';
      options.onReconnecting?.();
    };

    this._pool = new ConnectionPool((id: string) => {
      const context: ConnectionContext = Object.freeze({ connectionId: id, websocketUrl });
      return createConnection({
        url: websocketUrl,
        token,
        onFatalError: options.onError,
        onConnecting: () => connectionEvents?.onConnecting?.(context),
        onConnected: () => {
          onConnectionUp();
          connectionEvents?.onConnected?.(context);
        },
        onClosed: () => {
          onConnectionDown();
          connectionEvents?.onClosed?.(context);
        },
        ...((options.onError || connectionEvents?.onError) && {
          onError: (e: unknown) => {
            options.onError?.(e);
            connectionEvents?.onError?.(context, e);
          },
        }),
      });
    }, connections);

    this._rpc = (
      schema?.operations
        ? buildRpc(schema.operations, {
            subscribe: (q, v, o) => this.subscribe(q, v, o),
            subscribeWithRetry: (q, v, o) => this.subscribeWithRetry(q, v, o),
            first: (q, v, o) => firstMessage(this._pool, this._operationTimeoutMs, q, v, o),
          })
        : undefined
    ) as typeof this._rpc;

    this._sources = (
      schema?.sources
        ? createSources(schema.sources, {
            write: (q, v, o) => firstMessage(this._pool, this._operationTimeoutMs, q, v, o),
            readOne: (q, v, o) => firstMessage(this._pool, this._operationTimeoutMs, q, v, { ...o, retry: true }),
            readAll: (q, v, o) => this.collect(q, v, o),
          })
        : undefined
    ) as typeof this._sources;
  }

  get rpc(): TSchema extends Schema<infer TOps, any, any> ? Rpc<TOps> : never {
    if (!this._rpc) {
      throw new Error('@contello/client: .rpc accessed without a schema containing operations');
    }

    return this._rpc as any;
  }

  get sources(): TSchema extends Schema<any, infer TSources, any> ? SourceAccessors<TSources> : never {
    if (!this._sources) {
      throw new Error('@contello/client: .sources accessed without a schema containing sources');
    }

    return this._sources as any;
  }

  async init(): Promise<void> {
    await this._pool.connect();
  }

  async destroy(): Promise<void> {
    await this._pool.disconnect();
    await this._agent.close();
  }

  async ping(options?: OperationOptions | undefined): Promise<void> {
    // excluded from telemetry to avoid noise
    return ping((query) => firstMessage(this._pool, this._operationTimeoutMs, query, undefined, options));
  }

  /**
   * What a temporary token the Contello ui handed to an extension page stands for in the project of
   * this client: the user and the user's effective permissions, or inactive. The client's
   * application needs read access to the project. See `createTokenIntrospector` for the caching
   * wrapper a backend puts in front of its requests.
   */
  introspectToken(token: string, options?: OperationOptions | undefined): Promise<TokenIntrospection> {
    // not execute(): its span records the variables, and the token must not end up in telemetry
    return wrap(
      '@contello/client:introspectToken',
      () => introspectToken(
        (query, variables) => firstMessage(this._pool, this._operationTimeoutMs, query, variables, options),
        token,
      ),
    );
  }

  /**
   * Open a subscription on the websocket. Each `[Symbol.asyncIterator]()` call (the implicit one
   * from `for await`, or via `rxjs.from(this)`) starts a fresh server subscription and tears it
   * down when the iterator is returned (`break`, error, or explicit stop).
   *
   * A subscription whose connection is lost is rejected with a `ContelloConnectionLostError` and
   * is not sent again: what it delivered so far cannot be taken back, and the server would start
   * it over. One that is opened while no connection is up waits for the next one.
   */
  subscribe<TData>(query: string, variables?: Variables): AsyncIterable<TData>;
  subscribe<TData>(query: string, variables: Variables, options: OperationOptions | undefined): AsyncIterable<TData>;
  subscribe<TData>(query: string, ...[variables, options]: CallArguments<OperationOptions>): AsyncIterable<TData> {
    return openSubscription(this._pool, query, variables, 'abort', options?.signal);
  }

  /**
   * A subscription that outlives its connection: on the next one it is sent again, and its
   * messages go on. For a stream of events that stays open. The server starts a subscription that
   * is sent again from its beginning, so a stream that ends, such as the batches of a source,
   * repeats what it delivered before: read that one with `collect()`.
   */
  subscribeWithRetry<TData>(query: string, variables?: Variables): AsyncIterable<TData>;
  subscribeWithRetry<TData>(
    query: string,
    variables: Variables,
    options: OperationOptions | undefined,
  ): AsyncIterable<TData>;

  subscribeWithRetry<TData>(
    query: string,
    ...[variables, options]: CallArguments<OperationOptions>
  ): AsyncIterable<TData> {
    return openSubscription(this._pool, query, variables, 'retry', options?.signal);
  }

  /**
   * Reads a subscription that ends, such as the batches of a source, and answers with all of its
   * messages. When the connection is lost on the way the subscription starts over on the next one,
   * and so does the answer: it never holds messages of an attempt that did not finish. A read that
   * the end of the client cuts off is rejected.
   */
  collect<TData>(query: string, variables?: Variables): Promise<TData[]>;
  collect<TData>(query: string, variables: Variables, options: OperationOptions | undefined): Promise<TData[]>;
  collect<TData>(query: string, ...[variables, options]: CallArguments<OperationOptions>): Promise<TData[]> {
    const wsClient = this._pool.get();
    const deadline = createDeadline(options?.signal, this._operationTimeoutMs);
    const { signal } = deadline;

    return new Promise((resolve, reject) => {
      let messages: TData[] = [];
      let interrupted = false;
      let settled = false;

      const offClosed = wsClient.on('closed', () => {
        messages = [];
        interrupted = true;
      });

      const offConnected = wsClient.on('connected', () => {
        interrupted = false;
      });

      const onAbort = () => {
        if (settled) {
          return;
        }

        settle();
        unsubscribe();
        reject(signal?.reason);
      };

      const settle = () => {
        settled = true;
        offClosed();
        offConnected();
        deadline.clear();
        signal?.removeEventListener('abort', onAbort);
      };

      const unsubscribe = wsClient.subscribe<TData>(
        { query, variables },
        {
          next(msg) {
            const value = transformResponse(msg.data);

            deadline.restart();

            if (value !== undefined && value !== null) {
              messages.push(value as TData);
            }
          },
          error(err) {
            if (settled) {
              return;
            }

            settle();
            reject(err);
          },
          complete() {
            if (settled) {
              return;
            }

            settle();

            // the server ends a subscription on a connection that is up; without one the client was destroyed
            if (interrupted) {
              reject(new Error('@contello/client: the client was destroyed before the read finished'));

              return;
            }

            resolve(messages);
          },
        },
      );

      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  download(fileId: string): Promise<DownloadResult> {
    return wrap('@contello/client:download', () => downloadFile(this._agent, this._url, this._token, fileId));
  }

  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult> {
    return wrap('@contello/client:proxyHls', () => proxyHls(this._agent, this._url, this._token, path, signal));
  }

  proxySitemap(
    sitemapId: string,
    options: SitemapProxyOptions,
    signal?: AbortSignal | undefined,
  ): Promise<ProxyResult> {
    return wrap(
      '@contello/client:proxySitemap',
      () => proxySitemap(this._agent, this._url, this._token, this._project, sitemapId, options, signal),
    );
  }

  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string> {
    return wrap(
      '@contello/client:upload',
      () => uploadAsset(this._url, this._project, this._token, data, meta, options),
    );
  }

  /**
   * Runs one query or mutation. It is rejected, and not sent again, when its connection is lost:
   * a mutation may have arrived. `retry` sends a read again instead.
   */
  execute<TData>(query: string, variables?: Variables): Promise<TData>;
  execute<TData>(query: string, variables: Variables, options: ExecuteOptions | undefined): Promise<TData>;
  execute<TData>(query: string, ...[variables, options]: CallArguments<ExecuteOptions>): Promise<TData> {
    return wrap(
      '@contello/client:execute',
      () => firstMessage<TData>(this._pool, this._operationTimeoutMs, query, variables, options),
      graphqlOperationAttributes(query, variables),
    );
  }
}

export function createContelloClient<TSchema extends Schema | undefined = undefined>(
  options: ContelloClientOptions<TSchema>,
): ContelloClient<TSchema> {
  return new ContelloClient(options);
}
