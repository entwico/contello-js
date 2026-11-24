import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { REPLY_TIMEOUT } from './reply-watchdog';
import { createWebSocketClass } from './websocket';

export type UploadMetadata = {
  name: string;
  mimeType?: string | undefined;
  size?: number | undefined;
  annotations?: { key: string; value: string }[] | undefined;
  collectionRefs?: string[] | undefined;
  /**
   * `deleteIfNotUsed` lets the server delete the asset once nothing references it.
   * @default 'retain'
   */
  retentionPolicy?: 'retain' | 'deleteIfNotUsed' | undefined;
};

export type UploadData = Uint8Array | NodeReadableStream<Uint8Array> | ReadableStream<Uint8Array>;

type InitFrame = { type: 'init'; metadata: UploadMetadata & { projectRef: string }; token: string };
type ServerMessage =
  | { type: 'ack' }
  | { type: 'progress'; bytesReceived: number }
  | { type: 'done'; id: string }
  | { type: 'error'; error: string };

function parseServerMessage(data: unknown): ServerMessage | undefined {
  try {
    return JSON.parse(String(data));
  } catch {
    return undefined;
  }
}

export type UploadOptions = {
  chunkSize?: number | undefined;
  abort?: AbortSignal | undefined;
};

// the server acknowledges whole chunks, so the chunk is how long an upload goes without a sign of
// progress: a quarter megabyte crosses a megabit link in two seconds, four megabytes take half a minute
const DEFAULT_CHUNK_SIZE = 256 * 1024;

export type UploadTimings = {
  /** How long the server has to take the connection. */
  replyTimeout: number;
  /** How long the server may owe an acknowledgement while nothing moves. */
  stallTimeout: number;
  /** How long the server may go without a ping or a message. */
  heartbeatTimeout: number;
};

// a caller may still pass large chunks, and what left the process can sit in the kernel and on the
// wire for a while, so the limit on a missing acknowledgement is far above what a healthy server
// needs. its pings come every 5 s, and three of them may go missing
const DEFAULT_TIMINGS: UploadTimings = { replyTimeout: REPLY_TIMEOUT, stallTimeout: 60_000, heartbeatTimeout: 15_000 };

function isUint8Array(data: UploadData): data is Uint8Array {
  return data instanceof Uint8Array;
}

/**
 * Sends a file over the upload websocket and answers with the id of the asset.
 *
 * The server acknowledges the start and every chunk, so while it owes an answer its silence has a
 * limit: `stallTimeout` without a message from it and without a byte leaving for it ends the upload.
 *
 * The server pings for as long as the upload is open, storing the file after the last chunk
 * included, and is alive for as long as its pings come: `heartbeatTimeout` without a ping or a
 * message ends the upload. That takes a Contello that pings its uploads.
 */
export function upload(
  url: string,
  project: string,
  token: string,
  data: UploadData,
  meta: UploadMetadata,
  options?: UploadOptions | undefined,
  { replyTimeout, stallTimeout, heartbeatTimeout }: UploadTimings = DEFAULT_TIMINGS,
): Promise<string> {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const wsUrl = `${url.replace(/^http/i, 'ws')}/api/v1/assets/ws`;

  const size = isUint8Array(data) ? data.length : meta.size;

  return new Promise<string>((resolve, reject) => {
    const UploadSocket = createWebSocketClass(replyTimeout);
    const ws = new UploadSocket(wsUrl, 'contello-file-upload-v1');

    let done = false;
    // the server owes the acknowledgement of the start, then of every byte that was sent
    let awaitingAck = false;
    let bytesSent = 0;
    let bytesAcknowledged = 0;
    let lastProgress = Date.now();
    let lastBuffered = 0;
    // the handshake has a limit of its own, the server is held to its pings once the socket is open
    let lastHeard: number | undefined;
    let cancelSource: (() => void) | undefined;

    // a slow link is no dead server: bytes that still leave count as progress
    const stallCheck = setInterval(() => {
      const buffered = ws.bufferedAmount;

      if (buffered < lastBuffered) {
        lastProgress = Date.now();
      }

      lastBuffered = buffered;

      const owed = awaitingAck || bytesAcknowledged < bytesSent;

      const silent = lastHeard !== undefined && Date.now() - lastHeard > heartbeatTimeout;

      if (silent || (owed && Date.now() - lastProgress > stallTimeout)) {
        fail(new Error('upload stalled: the server stopped answering'));
      }
    }, Math.min(1000, stallTimeout / 4, heartbeatTimeout / 4));

    stallCheck.unref?.();

    const cleanup = () => {
      clearInterval(stallCheck);
      options?.abort?.removeEventListener('abort', abortHandler);
    };

    // an upload that is given up has nobody left to wait for a close handshake
    function fail(error: Error) {
      if (done) {
        return;
      }

      done = true;
      cleanup();
      cancelSource?.();
      ws.terminate();
      reject(error);
    }

    const abortHandler = () => fail(new Error('upload aborted'));

    options?.abort?.addEventListener('abort', abortHandler);

    function send(chunk: Uint8Array) {
      if (bytesAcknowledged === bytesSent) {
        lastProgress = Date.now();
      }

      bytesSent += chunk.length;
      ws.send(chunk);
    }

    function sendBuffer(buf: Uint8Array) {
      let offset = 0;

      while (offset < buf.length) {
        const chunk = buf.subarray(offset, offset + chunkSize);

        send(chunk);
        offset += chunk.length;
      }

      ws.send(JSON.stringify({ type: 'done' }));
    }

    const MAX_BUFFER_SIZE = 8 * 1024 * 1024;

    function waitForBufferedDrain(): Promise<void> {
      return new Promise((resolveDrain, rejectDrain) => {
        const check = () => {
          if (done) {
            rejectDrain(new Error('upload ended'));

            return;
          }

          if (ws.bufferedAmount <= MAX_BUFFER_SIZE) {
            resolveDrain();

            return;
          }

          setTimeout(check, 50);
        };

        check();
      });
    }

    async function sendStream(stream: UploadData) {
      const reader = (stream as ReadableStream<Uint8Array>).getReader();

      // nobody reads the rest of a file whose upload ended; a source that already failed has nothing to cancel
      cancelSource = () => void reader.cancel().catch(() => {});

      try {
        while (true) {
          const { done: streamDone, value } = await reader.read();

          if (streamDone) break;

          // the source decides the size of its pieces, the acknowledgements need the size of a chunk
          for (let offset = 0; offset < value.length; offset += chunkSize) {
            await waitForBufferedDrain();
            send(value.subarray(offset, offset + chunkSize));
          }
        }

        ws.send(JSON.stringify({ type: 'done' }));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }

    ws.addEventListener('open', () => {
      const initFrame: InitFrame = {
        type: 'init',
        metadata: { ...meta, ...(size !== undefined && { size }), projectRef: project },
        token,
      };

      awaitingAck = true;
      lastProgress = Date.now();
      lastHeard = Date.now();
      ws.send(JSON.stringify(initFrame));
    });

    ws.addEventListener('message', (event) => {
      const message = parseServerMessage(event.data);

      if (!message) {
        fail(new Error(`upload failed: ${String(event.data)}`));

        return;
      }

      if (message.type === 'error') {
        fail(new Error(`upload failed: ${message.error}`));

        return;
      }

      lastProgress = Date.now();
      lastHeard = Date.now();

      if (message.type === 'progress') {
        bytesAcknowledged = Math.max(bytesAcknowledged, message.bytesReceived);

        return;
      }

      if (message.type === 'ack') {
        awaitingAck = false;

        if (isUint8Array(data)) {
          sendBuffer(data);
        } else {
          sendStream(data);
        }

        return;
      }

      if (message.type !== 'done') {
        return;
      }

      done = true;
      cleanup();
      ws.close();
      resolve(message.id);
    });

    ws.on('ping', () => {
      lastHeard = Date.now();
    });

    ws.addEventListener('error', () => fail(new Error('upload websocket error')));
    ws.addEventListener('close', () => fail(new Error('connection closed before upload completed')));
  });
}
