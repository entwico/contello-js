import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import {
  type TrackedSockets,
  listenLocally,
  onCloseTestServers,
  startSilentServer as startSilentTcpServer,
  trackSockets,
} from '@entwico/dash/testing/node';
import type { Client } from 'graphql-ws';
import { useServer as serveGraphql } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';

import { createConnection } from './connection';

// servers and network paths that stop answering, for the tests that need real sockets

export async function until(condition: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export type Contello = { port: number; slowCalls: () => number; releaseSlow: () => void };

/** A real graphql-ws server. `slow` holds its first answer back until released, later calls answer at once. */
export async function startContello(): Promise<Contello> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const { promise: gate, resolve: releaseSlow } = Promise.withResolvers<void>();
  let slowCalls = 0;

  const fields: Record<string, () => unknown> = {
    greeting: () => 'hello',
    slow: async () => {
      slowCalls++;

      if (slowCalls === 1) {
        await gate;
      }

      return `answer ${slowCalls}`;
    },
  };

  // the protocol and the transport are graphql-ws' own; only the execution is replaced, by the
  // one root field each test query selects
  const server = serveGraphql(
    {
      schema: {} as never,
      validate: () => [],
      execute: async ({ document }) => {
        const field = /{\s*(\w+)/.exec(document.loc?.source.body ?? '')?.[1] ?? '';

        return { data: { [field]: await fields[field]?.() } };
      },
    },
    wss,
  );

  await new Promise((resolve) => wss.once('listening', resolve));

  onCloseTestServers(async () => {
    releaseSlow();
    await server.dispose();
  });

  return { port: (wss.address() as AddressInfo).port, slowCalls: () => slowCalls, releaseSlow };
}

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);

  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

export type Silence = 'never upgrades' | 'never acknowledges' | 'never answers a ping';

/** A server that takes the tcp connection and stops answering at the given step, without ever closing. */
export async function startSilentServer(silence: Silence): Promise<TrackedSockets & { port: number }> {
  const steps = new WeakMap<Socket, 'upgraded' | 'acknowledged'>();

  return await startSilentTcpServer((socket, request) => {
    if (silence === 'never upgrades') {
      return;
    }

    const step = steps.get(socket);

    if (step === undefined) {
      const key = /sec-websocket-key: (.+)\r\n/i.exec(request.toString())?.[1]?.trim() ?? '';
      const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');

      steps.set(socket, 'upgraded');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Protocol: graphql-transport-ws\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );

      return;
    }

    if (step === 'acknowledged' || silence === 'never acknowledges') {
      return;
    }

    steps.set(socket, 'acknowledged');
    socket.write(encodeTextFrame(JSON.stringify({ type: 'connection_ack' })));
  });
}

export type Watched = { client: Client; events: string[]; count: (event: string) => number };

export function connectTo(port: number): Watched {
  const events: string[] = [];

  const client = createConnection({
    url: `ws://127.0.0.1:${port}/graphql/projects/test`,
    token: 'token',
    keepAlive: 50,
    replyTimeout: 300,
    retryWait: () => new Promise((resolve) => setTimeout(resolve, 10)),
    onFatalError: () => {},
    onConnecting: () => void events.push('connecting'),
    onConnected: () => void events.push('connected'),
    onClosed: () => void events.push('closed'),
  });

  onCloseTestServers(() => client.dispose());

  return { client, events, count: (event) => events.filter((it) => it === event).length };
}

export function query<T>(client: Client, document: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let data: unknown;

    client.subscribe(
      { query: document },
      {
        next: (message) => {
          data = message.data;
        },
        error: reject,
        complete: () => resolve(data as T),
      },
    );
  });
}

export type UploadBehaviour =
  | 'works'
  | 'works slowly'
  | 'never acknowledges the start'
  | 'stops reading after the start'
  | 'never acknowledges a chunk'
  | 'never finishes'
  | 'refuses the start'
  | 'refuses the file'
  | 'answers no json';

export type UploadServer = TrackedSockets & {
  url: string;
  bytesReceived: () => number;
  largestMessage: () => number;
  /** Ends the pings of the open connections, the way a lost server ends them. */
  stopPinging(): void;
  /** Reads the connections it stopped reading again: a socket that is not read cannot see its end. */
  readAgain(): void;
};

/** The upload endpoint of Contello, speaking its protocol up to the step where `behaviour` goes silent. */
export async function startUploadServer(
  behaviour: UploadBehaviour,
  options?: { pings?: boolean | undefined } | undefined,
): Promise<UploadServer> {
  const server = createHttpServer();
  const wss = new WebSocketServer({ server });
  const tracked = trackSockets(server);
  const paused: Socket[] = [];
  const pings = new Set<ReturnType<typeof setInterval>>();
  let bytesReceived = 0;
  let largestMessage = 0;

  const stopPinging = () => {
    for (const ping of pings) {
      clearInterval(ping);
    }

    pings.clear();
  };

  onCloseTestServers(stopPinging);

  wss.on('connection', (socket, request) => {
    if (options?.pings !== false) {
      const ping = setInterval(() => socket.ping(), 50);

      pings.add(ping);

      socket.on('close', () => {
        clearInterval(ping);
        pings.delete(ping);
      });
    }

    // answers leave one after the other, a slow server takes its time for each
    let answers = Promise.resolve();

    const answer = (message: unknown) => {
      const previous = answers;

      answers = (async () => {
        await previous;

        if (behaviour === 'works slowly') {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        socket.send(JSON.stringify(message));
      })();
    };

    socket.on('error', () => {});

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        bytesReceived += data.length;
        largestMessage = Math.max(largestMessage, data.length);

        if (behaviour !== 'never acknowledges a chunk') {
          answer({ type: 'progress', bytesReceived });
        }

        return;
      }

      const { type } = JSON.parse(data.toString()) as { type: string };

      // the way Contello refuses: the reason in an error frame, then the end of the connection
      const refuse = (reason: string | { type: 'error'; error: string }) => {
        socket.send(typeof reason === 'string' ? reason : JSON.stringify(reason), () => socket.close());
      };

      if (type === 'init' && behaviour === 'refuses the start') {
        refuse({ type: 'error', error: 'token validation error: not authorized' });

        return;
      }

      if (type === 'init' && behaviour === 'answers no json') {
        refuse('unsupported websocket subprotocol: none');

        return;
      }

      if (type === 'done' && behaviour === 'refuses the file') {
        refuse({ type: 'error', error: 'file size exceeds the maximum of 1 MiB' });

        return;
      }

      if (type === 'init' && behaviour !== 'never acknowledges the start') {
        answer({ type: 'ack' });

        if (behaviour === 'stops reading after the start') {
          answers = (async () => {
            await answers;
            paused.push(request.socket);
            request.socket.pause();
          })();
        }
      }

      if (type === 'done' && behaviour !== 'never finishes' && behaviour !== 'never acknowledges a chunk') {
        answer({ type: 'done', id: 'asset' });
      }
    });
  });

  const port = await listenLocally(server);

  return {
    ...tracked,
    url: `http://127.0.0.1:${port}`,
    bytesReceived: () => bytesReceived,
    largestMessage: () => largestMessage,
    stopPinging,

    readAgain() {
      for (const socket of paused.splice(0)) {
        socket.resume();
      }
    },
  };
}
