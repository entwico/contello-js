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
  const metadata = { ...meta, projectRef: project };

  return new Observable<UploadAssetProgress | { id: string }>((obs) => {
    const parsedUrl = new URL(url);

    const ws = new WebSocket(
      `${parsedUrl.protocol === 'https:' ? 'wss' : 'ws'}://${parsedUrl.host}/api/v1/assets/ws`,
      'contello-file-upload-v1',
    );

    let offset = 0;

    let done = false;
    let ackReceived = false;

    ws.addEventListener('open', () => {
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
        file
          .slice(offset, offset + chunkSize)
          .arrayBuffer()
          .then((buffer) => {
            handleArrayBuffer(buffer);
          })
          .catch((error) => {
            obs.error(error);
          });
      }

      function markAsDone() {
        ws.send(JSON.stringify({ type: 'done' }));
      }

      function startUpload() {
        if (ackReceived) {
          readSlice();
        }
      }

      function handleArrayBuffer(buffer: ArrayBuffer) {
        // bail between chunks if the upload was aborted — abortHandler already closed the socket and errored
        if (options?.abort?.aborted) {
          return;
        }

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
        }
      }

      ws.addEventListener('message', (event) => {
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
      });
    });

    ws.addEventListener('error', (error) => obs.error(error));

    ws.addEventListener('close', () => {
      if (!done) {
        obs.error(new Error('Connection closed'));
      }
    });

    const abortHandler = () => {
      if (!done) {
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
