import { createClient } from 'graphql-ws';
import type { Agent } from 'undici';

import { firstAsync } from './async-iterable-utils';
import { decorateMessage, wrap } from './diagnostics';
import {
  type DownloadResult,
  type HttpAgentOptions,
  type ProxyResult,
  createHttpAgent,
  downloadFile,
  proxyHls,
} from './http';
import { ping } from './ping';
import { ConnectionPool } from './pool';
import { buildRpc } from './rpc';
import { createSources } from './sources';
import { transformResponse } from './transform-response';
import type { Rpc, Schema, SourceAccessors } from './types';
import { type UploadData, type UploadMetadata, type UploadOptions, upload as uploadAsset } from './upload';
import { wsRetryWait } from './utils';

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
};

type PoolState = 'disconnected' | 'connected' | 'reconnecting';

export class ContelloClient<TSchema extends Schema | undefined = undefined> {
  private _pool: ConnectionPool;
  private _rpc: TSchema extends Schema<infer TOps, any, any> ? Rpc<TOps> : undefined;
  private _sources: TSchema extends Schema<any, infer TSources, any> ? SourceAccessors<TSources> : undefined;
  private _url: string;
  private _project: string;
  private _token: string;
  private _agent: Agent;

  constructor(options: ContelloClientOptions<TSchema>) {
    const { url, project, token, schema, connections = 1, connectionEvents } = options;

    this._url = url;
    this._project = project;
    this._token = token;
    this._agent = createHttpAgent(options.http);

    const websocketUrl = `${url}/graphql/projects/${project}`.replace(/^http/i, 'ws');

    let state: PoolState = 'disconnected';
    let connectedCount = 0;

    const onConnectionUp = () => {
      connectedCount++;

      if (connectedCount === connections && state !== 'connected') {
        state = 'connected';
        options.onConnected?.();
      }
    };

    const onConnectionDown = () => {
      if (connectedCount > 0) {
        connectedCount--;
      }

      if (state === 'connected') {
        state = 'reconnecting';
        options.onReconnecting?.();
      }
    };

    this._pool = new ConnectionPool((id: string) => {
      const context: ConnectionContext = Object.freeze({ connectionId: id, websocketUrl });

      return createClient({
        url: websocketUrl,
        connectionParams: { token },
        lazy: false,
        keepAlive: 30000,
        retryAttempts: Infinity,
        retryWait: wsRetryWait,
        shouldRetry: () => true,
        jsonMessageReplacer: (key, value) => {
          if (!key) {
            return decorateMessage(value);
          }

          return value;
        },
        ...(options.onError ? { onNonLazyError: (e) => options.onError!(e) } : {}),
        on: {
          connected: () => {
            onConnectionUp();
            connectionEvents?.onConnected?.(context);
          },
          connecting: () => {
            connectionEvents?.onConnecting?.(context);
          },
          closed: () => {
            onConnectionDown();
            connectionEvents?.onClosed?.(context);
          },
          ...(options.onError || connectionEvents?.onError
            ? {
                error: (e) => {
                  options.onError?.(e);
                  connectionEvents?.onError?.(context, e);
                },
              }
            : {}),
        },
      });
    }, connections);

    this._rpc = (
      schema?.operations ? buildRpc(schema.operations, (q, v) => this.subscribe(q, v)) : undefined
    ) as typeof this._rpc;

    this._sources = (
      schema?.sources ? createSources(schema.sources, (q, v) => this.subscribe(q, v)) : undefined
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

  async ping(): Promise<void> {
    // excluded from diagnostics to avoid noise
    return ping((query) => firstAsync(this.subscribe(query)));
  }

  /**
   * Open a subscription on the websocket. Each `[Symbol.asyncIterator]()` call (the implicit one
   * from `for await`, or via `rxjs.from(this)`) starts a fresh server subscription and tears it
   * down when the iterator is returned (`break`, error, or explicit stop).
   */
  subscribe<TData>(query: string, variables?: Record<string, unknown> | undefined): AsyncIterable<TData> {
    const pool = this._pool;

    return {
      [Symbol.asyncIterator](): AsyncIterator<TData> {
        const wsClient = pool.get();
        const queue: TData[] = [];
        let pending: { resolve: (r: IteratorResult<TData>) => void; reject: (e: unknown) => void } | undefined;
        let done = false;
        let error: unknown;

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
              done = true;
              error = err;

              if (pending) {
                const p = pending;

                pending = undefined;
                p.reject(err);
              }
            },
            complete() {
              done = true;

              if (pending) {
                const p = pending;

                pending = undefined;
                p.resolve({ value: undefined as unknown as TData, done: true });
              }
            },
          },
        );

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
            unsubscribe();

            return Promise.resolve({ value: undefined as unknown as TData, done: true });
          },
          throw(err): Promise<IteratorResult<TData>> {
            unsubscribe();

            return Promise.reject(err);
          },
        };
      },
    };
  }

  download(fileId: string): Promise<DownloadResult> {
    return wrap('@contello/client:download', () => downloadFile(this._agent, this._url, this._token, fileId));
  }

  proxyHls(path: string, signal?: AbortSignal | undefined): Promise<ProxyResult> {
    return wrap('@contello/client:proxyHls', () => proxyHls(this._agent, this._url, this._token, path, signal));
  }

  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string> {
    return wrap('@contello/client:upload', () =>
      uploadAsset(this._url, this._project, this._token, data, meta, options),
    );
  }

  execute<TData>(query: string, variables?: Record<string, unknown> | undefined): Promise<TData> {
    return wrap('@contello/client:execute', () => firstAsync(this.subscribe<TData>(query, variables)));
  }
}

export function createContelloClient<TSchema extends Schema | undefined = undefined>(
  options: ContelloClientOptions<TSchema>,
): ContelloClient<TSchema> {
  return new ContelloClient(options);
}
