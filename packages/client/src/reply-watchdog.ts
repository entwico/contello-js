// how long the server has to take and acknowledge a new connection, and to answer a ping
export const REPLY_TIMEOUT = 10_000;

export type ReplyWatchdog = {
  connecting(): void;
  connected(): void;
  ping(received: boolean): void;
  pong(received: boolean): void;
  closed(): void;
};

/**
 * Gives up a connection whose server stopped answering: a new one that is not acknowledged, or an
 * established one that sends no pong to a ping. A connection that died without a close frame looks
 * open forever, and every operation on it waits.
 *
 * `terminate` has to drop the connection without waiting for it (graphql-ws `client.terminate()`):
 * closing a socket whose peer is gone waits for that same peer.
 */
export function createReplyWatchdog(terminate: () => void, timeout = REPLY_TIMEOUT): ReplyWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function disarm(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function arm(): void {
    disarm();
    timer = setTimeout(terminate, timeout);
    timer.unref?.();
  }

  return {
    connecting: arm,
    connected: disarm,

    ping(received) {
      // a ping from the server asks for our answer, not for one of its own
      if (!received) {
        arm();
      }
    },

    pong(received) {
      if (received) {
        disarm();
      }
    },

    closed: disarm,
  };
}
