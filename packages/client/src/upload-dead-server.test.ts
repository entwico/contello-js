import { afterEach, describe, expect, test } from 'vitest';

import { cleanup, startSilentServer, startUploadServer, until } from './test-servers';
import { type UploadData, upload } from './upload';

const timings = { replyTimeout: 300, stallTimeout: 300, heartbeatTimeout: 300 };

afterEach(cleanup);

function uploadTo(url: string, data: UploadData, abort?: AbortSignal | undefined): Promise<string> {
  return upload(url, 'test', 'token', data, { name: 'file.bin' }, { chunkSize: 64 * 1024, abort }, timings);
}

function streamOf(
  chunks: number,
  chunkSize: number,
  onCancel?: (() => void) | undefined,
): ReadableStream<Uint8Array> {
  let sent = 0;

  return new ReadableStream<Uint8Array>({
    cancel() {
      onCancel?.();
    },
    pull(controller) {
      if (sent === chunks) {
        controller.close();

        return;
      }

      sent++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
}

describe('an upload to a live server', () => {
  test('sends a buffer and answers with the asset id', async () => {
    const server = await startUploadServer('works');

    await expect(uploadTo(server.url, new Uint8Array(300 * 1024))).resolves.toBe('asset');

    expect(server.bytesReceived()).toBe(300 * 1024);
    await until(() => server.open() === 0);
  });

  test('sends a stream and answers with the asset id', async () => {
    const server = await startUploadServer('works');

    await expect(uploadTo(server.url, streamOf(5, 64 * 1024))).resolves.toBe('asset');

    expect(server.bytesReceived()).toBe(5 * 64 * 1024);
    await until(() => server.open() === 0);
  });

  test('takes as long as it takes while the server keeps acknowledging', async () => {
    const server = await startUploadServer('works slowly');
    const started = Date.now();

    await expect(uploadTo(server.url, new Uint8Array(10 * 64 * 1024))).resolves.toBe('asset');

    // every answer came within the limit, all of them together took several times as long
    expect(Date.now() - started).toBeGreaterThan(3 * timings.stallTimeout);
  });
});

describe.each([
  'never acknowledges the start',
  'stops reading after the start',
  'never acknowledges a chunk',
] as const)('an upload to a server that %s', (behaviour) => {
  test.each([
    ['a buffer', () => new Uint8Array(4 * 1024 * 1024)],
    ['a stream', () => streamOf(64, 64 * 1024)],
  ] as const)('gives %s up and closes its socket', async (_name, createData) => {
    const server = await startUploadServer(behaviour);

    await expect(uploadTo(server.url, createData())).rejects.toThrow('upload stalled');

    server.readAgain();
    await until(() => server.open() === 0);
  });
});

describe('an upload to a server that never upgrades', () => {
  test('gives up and closes its socket', async () => {
    const server = await startSilentServer('never upgrades');

    await expect(uploadTo(`http://127.0.0.1:${server.port}`, new Uint8Array(1024))).rejects.toThrow(
      'upload websocket error',
    );

    await until(() => server.open() === 0);
  });
});

describe('an upload that is aborted', () => {
  test('ends at once against a server that stopped reading, with its socket closed', async () => {
    const server = await startUploadServer('stops reading after the start');
    const controller = new AbortController();
    const result = uploadTo(server.url, new Uint8Array(4 * 1024 * 1024), controller.signal);

    await until(() => server.accepted() === 1);
    controller.abort();

    await expect(result).rejects.toThrow('upload aborted');

    server.readAgain();
    await until(() => server.open() === 0);
  });
});

describe('an upload the server refuses', () => {
  test.each([
    ['refuses the start', 'upload failed: token validation error: not authorized'],
    ['refuses the file', 'upload failed: file size exceeds the maximum of 1 MiB'],
    ['answers no json', 'upload failed: unsupported websocket subprotocol: none'],
  ] as const)('fails with the reason of a server that %s', async (behaviour, reason) => {
    const server = await startUploadServer(behaviour);

    await expect(uploadTo(server.url, new Uint8Array(64 * 1024))).rejects.toThrow(reason);

    await until(() => server.open() === 0);
  });
});

describe('the source stream of an upload that ended early', () => {
  test.each([
    ['stops reading after the start', 'upload stalled'],
    ['refuses the start', 'upload failed'],
  ] as const)('is cancelled when the server %s', async (behaviour, reason) => {
    const server = await startUploadServer(behaviour);
    let cancelled = false;

    // far more than the server takes before it stops reading, so the upload ends with the source half read
    const source = streamOf(1024, 64 * 1024, () => {
      cancelled = true;
    });

    // a server that refuses at the start never has the stream read; cancelling a stream nobody
    // started to read is the caller's own business
    await expect(uploadTo(server.url, source)).rejects.toThrow(reason);

    await until(() => cancelled || behaviour === 'refuses the start');
    expect(cancelled).toBe(behaviour !== 'refuses the start');
  });

  test('is cancelled when the upload is aborted', async () => {
    const server = await startUploadServer('never acknowledges a chunk');
    const controller = new AbortController();
    let cancelled = false;

    const source = streamOf(1024, 64 * 1024, () => {
      cancelled = true;
    });

    const result = uploadTo(server.url, source, controller.signal);

    await until(() => server.bytesReceived() > 0);
    controller.abort();

    await expect(result).rejects.toThrow('upload aborted');
    await until(() => cancelled);
  });

  test('is left alone when the upload succeeded', async () => {
    const server = await startUploadServer('works');
    let cancelled = false;

    const source = streamOf(4, 64 * 1024, () => {
      cancelled = true;
    });

    await expect(uploadTo(server.url, source)).resolves.toBe('asset');
    expect(cancelled).toBe(false);
  });
});

describe('an upload whose file was sent', () => {
  test('waits for a file that takes long to store, for as long as the pings come', async () => {
    const server = await startUploadServer('never finishes');
    const controller = new AbortController();
    let settled = false;

    const outcome = (async () => {
      try {
        return await uploadTo(server.url, new Uint8Array(64 * 1024), controller.signal);
      } catch (error) {
        return String(error);
      } finally {
        settled = true;
      }
    })();

    await until(() => server.bytesReceived() === 64 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 4 * timings.heartbeatTimeout));

    expect(settled).toBe(false);

    controller.abort();
    await expect(outcome).resolves.toContain('upload aborted');

    await until(() => server.open() === 0);
  });

  test('gives up a file that is being stored when the pings end, and closes its socket', async () => {
    const server = await startUploadServer('never finishes');
    const result = uploadTo(server.url, new Uint8Array(64 * 1024));

    await until(() => server.bytesReceived() === 64 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 2 * timings.heartbeatTimeout));
    server.stopPinging();

    await expect(result).rejects.toThrow('upload stalled');
    await until(() => server.open() === 0);
  });

  test('is given up by a server that never pings', async () => {
    const server = await startUploadServer('never finishes', { pings: false });

    await expect(uploadTo(server.url, new Uint8Array(64 * 1024))).rejects.toThrow('upload stalled');
    await until(() => server.open() === 0);
  });
});

describe('the chunks of an upload', () => {
  test('are a quarter megabyte unless the caller says otherwise', async () => {
    const server = await startUploadServer('works');

    await upload(server.url, 'test', 'token', new Uint8Array(1024 * 1024), { name: 'file.bin' }, undefined, timings);

    expect(server.largestMessage()).toBe(256 * 1024);
  });

  test('are cut from a stream whose pieces are larger', async () => {
    const server = await startUploadServer('works');
    const source = streamOf(2, 300 * 1024);

    await expect(uploadTo(server.url, source)).resolves.toBe('asset');

    expect(server.bytesReceived()).toBe(600 * 1024);
    expect(server.largestMessage()).toBe(64 * 1024);
  });
});
