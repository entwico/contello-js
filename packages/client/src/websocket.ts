import WebSocket from 'ws';

// what graphql-ws closes a socket with once `client.terminate()` gave it up
const CLOSE_CODE_TERMINATED = 4499;

type WebSocketClass = new (address: string | URL, protocols?: string | string[] | undefined) => WebSocket;

/**
 * The socket class graphql-ws connects with. Node's own WebSocket cannot be forced shut: closed
 * against a peer that stopped answering it stays in `CLOSING` and keeps its file descriptor for as
 * long as the peer stays silent, one more with every reconnect. This one is destroyed when it was
 * given up, and after `replyTimeout` when a handshake, opening or closing, gets no answer.
 */
export function createWebSocketClass(replyTimeout: number): WebSocketClass {
  // `closeTimeout` is not in @types/ws yet
  const options: WebSocket.ClientOptions & { closeTimeout: number } = {
    handshakeTimeout: replyTimeout,
    closeTimeout: replyTimeout,
  };

  return class ContelloWebSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[] | undefined) {
      super(address, protocols, options);
    }

    override close(code?: number | undefined, data?: string | Buffer | undefined): void {
      if (code !== CLOSE_CODE_TERMINATED) {
        super.close(code, data);

        return;
      }

      // graphql-ws drops its handlers right after this call, and a socket that is destroyed while
      // it still connects reports that as an error: unheard, it would end the process
      this.on('error', () => {});
      this.terminate();
    }
  };
}
