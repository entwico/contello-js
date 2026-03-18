import { createClient } from 'graphql-ws';
import { Observable, firstValueFrom, map } from 'rxjs';

import { decorateMessage, wrap } from './diagnostics';
import { type DownloadResult, downloadFile } from './download';
import { ping } from './ping';
import { ConnectionPool } from './pool';
import { buildRpc } from './rpc';
import type { OperationMap, Rpc } from './types';
import { type UploadData, type UploadMetadata, type UploadOptions, upload as uploadAsset } from './upload';
import { exponentialBackoff } from './utils';

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

export type ContelloClientOptions<T extends OperationMap | undefined = undefined> = {
  url: string;
  project: string;
  token: string;
  operations?: T | undefined;
  connections?: number | undefined;
  onConnected?: (() => void) | undefined;
  onReconnecting?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  connectionEvents?: ConnectionEvents | undefined;
};

type PoolState = 'disconnected' | 'connected' | 'reconnecting';

export class ContelloClient<T extends OperationMap | undefined = undefined> {
  private _pool: ConnectionPool;
  private _rpc: T extends OperationMap ? Rpc<T> : undefined;
  private _url: string;
  private _project: string;
  private _token: string;

  constructor(options: ContelloClientOptions<T>) {
    const { url, project, token, operations, connections = 1, connectionEvents } = options;

    this._url = url;
    this._project = project;
    this._token = token;

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
        retryWait: exponentialBackoff,
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

    this._rpc = (operations ? buildRpc(operations, this) : undefined) as typeof this._rpc;
  }

  get rpc(): T extends OperationMap ? Rpc<T> : never {
    if (!this._rpc) {
      throw new Error('@contello/client: .rpc accessed without operations');
    }

    return this._rpc as any;
  }

  async init(): Promise<void> {
    await this._pool.connect();
  }

  async destroy(): Promise<void> {
    await this._pool.disconnect();
  }

  async ping(): Promise<void> {
    // exlude from diagnostics to avoid noise
    return ping((query) => firstValueFrom(this.subscribe(query)));
  }

  subscribe<TData>(query: string, variables?: Record<string, unknown> | undefined): Observable<TData> {
    const wsClient = this._pool.get();

    return new Observable<{ data: TData }>((obs) => wsClient.subscribe({ query, variables }, obs)).pipe(
      map((r) => r.data),
    );
  }

  download(fileId: string): Promise<DownloadResult> {
    return wrap('@contello/client:download', () => downloadFile(this._url, this._token, fileId));
  }

  upload(data: UploadData, meta: UploadMetadata, options?: UploadOptions | undefined): Promise<string> {
    return wrap('@contello/client:upload', () =>
      uploadAsset(this._url, this._project, this._token, data, meta, options),
    );
  }

  execute<TData>(query: string, variables?: Record<string, unknown> | undefined): Promise<TData> {
    return wrap('@contello/client:execute', () => firstValueFrom(this.subscribe<TData>(query, variables)));
  }
}

export function createContelloClient<T extends OperationMap | undefined = undefined>(
  options: ContelloClientOptions<T>,
): ContelloClient<T> {
  return new ContelloClient(options);
}
