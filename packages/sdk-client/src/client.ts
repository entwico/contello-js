import { createClient } from 'graphql-ws';
import type { ContelloSdkClientMiddleware } from './middleware';
import { ConnectionPool } from './pool';
import { type Requester, createSdk } from './sdk';

export type ClientEventContext = {
  connectionId: string;
  websocketUrl: string;
};

export type ContelloSdkClientParams = {
  url: string;
  project: string;
  token: string;
  middlewares?: ContelloSdkClientMiddleware[] | undefined;
  pooling?:
    | {
        enabled?: boolean | undefined;
        size?: number | undefined;
      }
    | undefined;
  client?:
    | {
        retryAttempts?: number | undefined;
        onError?: (context: ClientEventContext, error: unknown) => void;
        onConnected?: (context: ClientEventContext) => void;
        onClosed?: (context: ClientEventContext) => void;
        onConnecting?: (context: ClientEventContext) => void;
        onOpened?: (context: ClientEventContext) => void;
        onMessage?: (context: ClientEventContext, message: any) => void;
        onPing?: (context: ClientEventContext) => void;
        onPong?: (context: ClientEventContext) => void;
      }
    | undefined;
};

export class ContelloSdkClient<T> {
  private _pool: ConnectionPool;
  private _sdk: { sdk: T };

  constructor(getSdk: <C, E>(requester: Requester<C, E>) => T, params: ContelloSdkClientParams) {
    const { url, project, token, client, pooling } = params;

    const websocketUrl = `${url}/graphql/projects/${project}`.replace(/^http/i, 'ws');

    this._pool = new ConnectionPool(
      (id: string) => {
        const context: ClientEventContext = Object.freeze({ connectionId: id, websocketUrl });

        return createClient({
          url: websocketUrl,
          connectionParams: { authorization: `Bearer ${token}` },
          lazy: false,
          keepAlive: 30000,
          retryAttempts: client?.retryAttempts ?? 3,
          shouldRetry: () => true,
          jsonMessageReplacer: (key, value) => {
            if (!key) {
              let message = value;

              for (const middleware of params.middlewares ?? []) {
                if (middleware.onOutgoingMessage) {
                  message = middleware.onOutgoingMessage(message);
                }
              }

              return message;
            }

            return value;
          },
          ...(client?.onError ? { onNonLazyError: (e) => client!.onError!(context, e) } : {}),
          on: {
            ...(client?.onError ? { error: (e) => client!.onError!(context, e) } : {}),
            ...(client?.onConnected ? { connected: () => client!.onConnected!(context) } : {}),
            ...(client?.onClosed ? { closed: () => client!.onClosed!(context) } : {}),
            ...(client?.onConnecting ? { connecting: () => client!.onConnecting!(context) } : {}),
            ...(client?.onOpened ? { opened: () => client!.onOpened!(context) } : {}),
            ...(client?.onMessage ? { message: (m) => client!.onMessage!(context, m) } : {}),
            ...(client?.onPing ? { ping: () => client!.onPing!(context) } : {}),
            ...(client?.onPong ? { pong: () => client!.onPong!(context) } : {}),
          },
        });
      },
      pooling?.enabled === false ? 1 : (pooling?.size ?? 5),
    );

    this._sdk = { sdk: createSdk(() => this._pool.get(), params.middlewares ?? [], getSdk) };
  }

  public get sdk() {
    return this._sdk.sdk;
  }

  public async connect() {
    await this._pool.connect();
  }

  public async disconnect() {
    await this._pool.disconnect();
  }
}
