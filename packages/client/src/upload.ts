import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export type UploadMetadata = {
  name: string;
  mimeType?: string | undefined;
  size?: number | undefined;
  annotations?: { key: string; value: string }[] | undefined;
  collectionRefs?: string[] | undefined;
};

export type UploadData = Uint8Array | NodeReadableStream<Uint8Array> | ReadableStream<Uint8Array>;

type InitFrame = { type: 'init'; metadata: UploadMetadata & { projectRef: string }; token: string };
type ServerMessage = { type: 'ack' } | { type: 'progress'; bytesReceived: number } | { type: 'done'; id: string };

export type UploadOptions = {
  chunkSize?: number | undefined;
  abort?: AbortSignal | undefined;
};

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

function isUint8Array(data: UploadData): data is Uint8Array {
  return data instanceof Uint8Array;
}

export function upload(
  url: string,
  project: string,
  token: string,
  data: UploadData,
  meta: UploadMetadata,
  options?: UploadOptions | undefined,
): Promise<string> {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const wsUrl = `${url.replace(/^http/i, 'ws')}/api/v1/assets/ws`;

  const size = isUint8Array(data) ? data.length : meta.size;

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, 'contello-file-upload-v1');

    let done = false;

    const cleanup = () => {
      options?.abort?.removeEventListener('abort', abortHandler);
    };

    const abortHandler = () => {
      if (!done) {
        ws.close();
        reject(new Error('upload aborted'));
      }
    };

    options?.abort?.addEventListener('abort', abortHandler);

    function sendBuffer(buf: Uint8Array) {
      let offset = 0;

      while (offset < buf.length) {
        const chunk = buf.subarray(offset, offset + chunkSize);

        ws.send(chunk);
        offset += chunk.length;
      }

      ws.send(JSON.stringify({ type: 'done' }));
    }

    async function sendStream(stream: UploadData) {
      const reader = (stream as ReadableStream<Uint8Array>).getReader();

      try {
        while (true) {
          const { done: streamDone, value } = await reader.read();

          if (streamDone) break;

          ws.send(value);
        }

        ws.send(JSON.stringify({ type: 'done' }));
      } catch (err) {
        reject(err);
        ws.close();
      }
    }

    ws.addEventListener('open', () => {
      const initFrame: InitFrame = {
        type: 'init',
        metadata: { ...meta, ...(size !== undefined ? { size } : {}), projectRef: project },
        token,
      };

      ws.send(JSON.stringify(initFrame));
    });

    ws.addEventListener('message', (event) => {
      const message: ServerMessage = JSON.parse(String(event.data));

      if (message.type === 'ack') {
        if (isUint8Array(data)) {
          sendBuffer(data);
        } else {
          sendStream(data);
        }

        return;
      }

      if (message.type === 'done') {
        done = true;
        cleanup();
        ws.close();
        resolve(message.id);
      }
    });

    ws.addEventListener('error', () => {
      cleanup();
      reject(new Error('upload websocket error'));
    });

    ws.addEventListener('close', () => {
      cleanup();

      if (!done) {
        reject(new Error('connection closed before upload completed'));
      }
    });
  });
}
