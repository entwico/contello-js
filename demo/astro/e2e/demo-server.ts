import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(DEMO_DIR, '../..');

export type DemoServer = {
  baseUrl: string;
  logs: () => string;
  stop: () => Promise<void>;
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };

      probe.close(() => resolve(port));
    });
  });
}

async function waitForReady(url: string, child: ChildProcess, logs: () => string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`demo server exited with code ${child.exitCode}\n${logs()}`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });

      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }

    if (Date.now() > deadline) {
      throw new Error(`demo server not ready within ${timeoutMs}ms\n${logs()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function startDemoServer(otlpUrl: string): Promise<DemoServer> {
  const [port, healthPort] = await Promise.all([freePort(), freePort()]);
  const output: string[] = [];
  const logs = () => output.join('');

  const child = spawn('node', ['dist/server/entry.mjs'], {
    cwd: DEMO_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      HEALTH_PORT: String(healthPort),
      CONFIG_PATH: path.join(REPO_ROOT, '.env'),
      OTEL_SERVICE_NAME: 'demo-astro-e2e',
      OTEL_EXPORTER_OTLP_ENDPOINT: otlpUrl,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_BSP_SCHEDULE_DELAY: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output.push(chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    output.push(chunk);
  });

  // readiness comes from the health server so no app spans are produced by polling
  await waitForReady(`http://127.0.0.1:${healthPort}/readyz`, child, logs);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    logs,

    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill('SIGTERM');

      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 15_000))]);

      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    },
  };
}
