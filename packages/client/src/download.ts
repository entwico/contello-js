export type DownloadResult = {
  mimeType: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  stream(): ReadableStream<Uint8Array>;
};

export async function downloadFile(url: string, token: string, fileId: string): Promise<DownloadResult> {
  const response = await fetch(`${url}/api/v1/assets/files/${fileId}`, {
    headers: { token },
  });

  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('download response has no body');
  }

  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const size = Number(response.headers.get('content-length') ?? 0);

  return {
    mimeType,
    size,
    bytes: () => response.arrayBuffer().then((buf) => new Uint8Array(buf)),
    stream: () => response.body!,
  };
}
