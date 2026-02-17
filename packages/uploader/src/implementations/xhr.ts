import { Observable } from 'rxjs';
import type { UploadAssetMetadata, UploadAssetProgress } from '../upload-metadata';
import type { ContelloUploaderParams } from '../uploader';

/** Uploads a file via XMLHttpRequest with multipart form data. Emits progress events and the asset ID on completion. */
export function uploadViaXhr(
  { url, project, token }: Required<ContelloUploaderParams>,
  file: File,
  meta: UploadAssetMetadata | undefined,
  options: { abort?: AbortSignal } | undefined,
) {
  return new Observable<UploadAssetProgress | { id: string }>((obs) => {
    const data = new FormData();

    data.append('metadata', JSON.stringify({ ...(meta ?? {}), projectRef: project }));
    data.append('file', file);

    const xhr = new XMLHttpRequest();

    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.open('POST', `${url}/api/v1/assets`, true);

    xhr.upload.onprogress = async (event) => {
      if (event.lengthComputable) {
        obs.next({ progress: (event.loaded / event.total) * 100 });
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const { id }: { id: string } = JSON.parse(xhr.responseText);

        obs.next({ id });

        return obs.complete();
      }

      obs.error(new Error(`${xhr.status}: ${xhr.statusText}`));
    };

    xhr.onerror = (error) => obs.error(error);
    xhr.send(data);

    options?.abort?.addEventListener('abort', () => xhr.abort());

    return () => xhr.abort();
  });
}
