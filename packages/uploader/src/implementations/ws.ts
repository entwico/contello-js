import { Observable } from 'rxjs';
import type { UploadAssetMetadata, UploadAssetProgress } from '../upload-metadata';
import type { ContelloUploaderParams } from '../uploader';

type InitFrame = {
  type: 'init';
  metadata: UploadAssetMetadata & { projectRef: string };
  token: string;
};

type AckMessage = { type: 'ack' };

type ProgressMessage = { type: 'progress'; bytesReceived: number };

type DoneMessage = { type: 'done'; id: string };

/** Uploads a file via WebSocket using chunked binary transfer. Emits progress events and the asset ID on completion. */
export function uploadViaWebSocket(
  { url, project, token, chunkSize }: Required<ContelloUploaderParams>,
  file: File,
  meta: UploadAssetMetadata | undefined,
  options: { abort?: AbortSignal } | undefined,
) {
  const metadata = { ...(meta ?? {}), projectRef: project };

  return new Observable<UploadAssetProgress | { id: string }>((obs) => {
    const parsedUrl = new URL(url);

    const ws = new WebSocket(
      `${parsedUrl.protocol === 'https:' ? 'wss' : 'ws'}://${parsedUrl.host}/api/v1/assets/ws`,
      'contello-file-upload-v1',
    );

    const reader = typeof FileReader !== 'undefined' ? new FileReader() : null;
    let offset = 0;

    let done = false;
    let ackReceived = false;

    ws.onopen = async () => {
      const initFrame: InitFrame = {
        type: 'init',
        metadata: {
          ...metadata,
          name: file.name,
          mimeType: file.type,
          size: file.size,
        },
        token,
      };

      ws.send(JSON.stringify(initFrame));

      function readSlice() {
        const slice = file.slice(offset, offset + chunkSize);
        if (reader) {
          reader.readAsArrayBuffer(slice);
        } else {
          // Node.js environment - convert Blob to ArrayBuffer
          slice
            .arrayBuffer()
            .then((buffer) => {
              handleArrayBuffer(buffer);
            })
            .catch((err) => {
              obs.error(err);
            });
        }
      }

      function markAsDone() {
        reader?.abort();
        ws.send(JSON.stringify({ type: 'done' }));
      }

      function startUpload() {
        if (ackReceived) {
          readSlice();
        }
      }

      function handleArrayBuffer(buffer: ArrayBuffer) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buffer);
          offset += buffer.byteLength;

          if (offset < file.size) {
            readSlice();
          } else {
            markAsDone();
          }
        } else {
          obs.error(new Error('WebSocket is closed'));
          reader?.abort();
        }
      }

      if (reader) {
        reader.onload = () => {
          if (reader.result && reader.result instanceof ArrayBuffer) {
            handleArrayBuffer(reader.result);
          } else {
            markAsDone();
          }
        };
      }

      ws.onmessage = (event) => {
        const message: AckMessage | ProgressMessage | DoneMessage = JSON.parse(event.data);

        if (message.type === 'ack') {
          ackReceived = true;
          startUpload();
          return;
        }

        if (message.type === 'progress') {
          return obs.next({ progress: (message.bytesReceived / file.size) * 100 });
        }

        if (message.type === 'done') {
          if (message.id) {
            done = true;

            obs.next({ id: message.id });
            obs.complete();
          } else {
            obs.error(new Error('No asset id received'));
          }

          return ws.close();
        }

        obs.error(new Error(`WebSocket message with unknown type ${JSON.stringify(message)}`));
        ws.close();
      };
    };

    ws.onerror = (error) => obs.error(error);

    ws.onclose = () => {
      if (!done) {
        obs.error(new Error('Connection closed'));
      }
    };

    const abortHandler = () => {
      if (!done) {
        reader?.abort();
        ws.close();
        obs.error(new Error('Upload aborted'));
      }
    };

    options?.abort?.addEventListener('abort', abortHandler);

    return () => {
      options?.abort?.removeEventListener('abort', abortHandler);
      ws.close();
    };
  });
}
