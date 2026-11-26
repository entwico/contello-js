import { injectTraceContext } from '@contello/opentelemetry';
import { exponentialBackoff } from '@entwico/dash/async';
import { type Client, createClient } from 'graphql-ws';

import { REPLY_TIMEOUT, createReplyWatchdog } from './reply-watchdog';
import { createWebSocketClass } from './websocket';

const KEEP_ALIVE_INTERVAL = 30_000;

export type ConnectionOptions = {
  url: string;
  token: string;
  onConnecting?: (() => void) | undefined;
  onConnected?: (() => void) | undefined;
  onClosed?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  /** Called when the connection gave up for good; without it graphql-ws logs to the console. */
  onFatalError?: ((error: unknown) => void) | undefined;
  keepAlive?: number | undefined;
  replyTimeout?: number | undefined;
  retryWait?: ((retries: number) => Promise<void>) | undefined;
};

/**
 * One websocket to Contello that stays up: it connects right away, reconnects forever, and gives up
 * a socket whose server stopped answering, so operations move to a new one.
 */
export function createConnection(options: ConnectionOptions): Client {
  const { onError, onFatalError } = options;
  const replyTimeout = options.replyTimeout ?? REPLY_TIMEOUT;
  const watchdog = createReplyWatchdog(() => client.terminate(), replyTimeout);

  // no `connectionAckWaitTimeout`: it gives up with a plain close(), which leaves the socket of a silent peer
  // in CLOSING; the watchdog terminates instead
  const client = createClient({
    url: options.url,
    webSocketImpl: createWebSocketClass(replyTimeout),
    connectionParams: { token: options.token },
    lazy: false,
    keepAlive: options.keepAlive ?? KEEP_ALIVE_INTERVAL,
    retryAttempts: Infinity,
    retryWait: options.retryWait ?? exponentialBackoff,
    shouldRetry: () => true,
    jsonMessageReplacer: (key, value) => {
      if (!key) {
        return injectTraceContext(value);
      }

      return value;
    },
    ...(onFatalError && { onNonLazyError: onFatalError }),
    on: {
      connecting: () => {
        watchdog.connecting();
        options.onConnecting?.();
      },
      connected: () => {
        watchdog.connected();
        options.onConnected?.();
      },
      ping: (received) => watchdog.ping(received),
      pong: (received) => watchdog.pong(received),
      closed: () => {
        watchdog.closed();
        options.onClosed?.();
      },
      ...(onError && { error: onError }),
    },
  });

  return client;
}
