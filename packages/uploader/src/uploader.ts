import { filter, firstValueFrom } from 'rxjs';
import { uploadViaWebSocket } from './implementations/ws';
import { uploadViaXhr } from './implementations/xhr';
import type { UploadAssetMetadata } from './upload-metadata';

export type ContelloUploaderParams = {
  /**
   * Base URL of the Contello server.
   * Example: 'https://example.com'
   */
  url: string;
  /**
   * Project identifier for the Contello project.
   * Example: 'myProjectId'
   */
  project: string;
  /**
   * Authentication token for the Contello API.
   * Example: 'app-a123b456c7890d123456789'
   */
  token: string;
  /**
   * Transport protocol to use for uploading files.
   * 'http' uses XMLHttpRequest, 'ws' uses WebSocket.
   * @default 'ws'
   */
  transport?: 'http' | 'ws';
  /**
   * Size of each chunk in bytes when uploading files.
   * Default is 4MB.
   * @default 4_194_304
   */
  chunkSize?: number;
};

/**
 * ContelloUploader is a class for uploading files to a Contello server.
 * It supports both WebSocket and HTTP transports.
 */
export class ContelloUploader {
  private params: Required<ContelloUploaderParams>;

  constructor(params: ContelloUploaderParams) {
    this.params = {
      url: params.url,
      project: params.project,
      token: params.token,
      transport: params.transport || 'ws',
      chunkSize: params.chunkSize || 4 * 1024 * 1024,
    };
  }

  /** Uploads a file and resolves with the asset ID once complete. */
  async upload(
    file: File,
    meta?: UploadAssetMetadata | undefined,
    options?: { abort?: AbortSignal } | undefined,
  ): Promise<{ id: string }> {
    return firstValueFrom(this.uploadWithEvents(file, meta, options).pipe(filter((r) => 'id' in r)));
  }

  /** Uploads a file and returns an Observable emitting progress events and the final asset ID. */
  uploadWithEvents(file: File, meta?: UploadAssetMetadata | undefined, options?: { abort?: AbortSignal } | undefined) {
    if (this.params.transport === 'http') {
      return uploadViaXhr(this.params, file, meta, options);
    }

    return uploadViaWebSocket(this.params, file, meta, options);
  }
}
