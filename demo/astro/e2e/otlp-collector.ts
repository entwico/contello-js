import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CollectedSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  scope: string;
  kind: number;
  status: 'UNSET' | 'OK' | 'ERROR';
  attributes: Record<string, unknown>;
  startMs: number;
  endMs: number;
};

export type OtlpCollector = {
  url: string;
  spans: () => CollectedSpan[];
  clear: () => void;
  waitFor: <T>(pick: (spans: CollectedSpan[]) => T | undefined, timeoutMs?: number) => Promise<T>;
  close: () => Promise<void>;
};

type OtlpAnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
};

type OtlpKeyValue = { key: string; value?: OtlpAnyValue };

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpKeyValue[];
  status?: { code?: number };
};

type OtlpExportRequest = {
  resourceSpans?: {
    scopeSpans?: {
      scope?: { name?: string };
      spans?: OtlpSpan[];
    }[];
  }[];
};

const STATUS_BY_CODE = ['UNSET', 'OK', 'ERROR'] as const;

function decodeValue(value: OtlpAnyValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map((item) => decodeValue(item));

  return undefined;
}

function decodeAttributes(attributes: OtlpKeyValue[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const { key, value } of attributes) {
    result[key] = decodeValue(value);
  }

  return result;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startOtlpCollector(): Promise<OtlpCollector> {
  const collected: CollectedSpan[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);

      if (req.url === '/v1/traces') {
        const payload = JSON.parse(body) as OtlpExportRequest;

        const resourceSpans = payload.resourceSpans ?? [];

        for (const resourceSpan of resourceSpans) {
          const scopeSpans = resourceSpan.scopeSpans ?? [];

          for (const scopeSpan of scopeSpans) {
            const spans = scopeSpan.spans ?? [];

            for (const span of spans) {
              collected.push({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId || undefined,
                name: span.name,
                scope: scopeSpan.scope?.name ?? '',
                kind: span.kind ?? 0,
                status: STATUS_BY_CODE[span.status?.code ?? 0] ?? 'UNSET',
                attributes: decodeAttributes(span.attributes),
                startMs: Number(BigInt(span.startTimeUnixNano) / 1_000_000n),
                endMs: Number(BigInt(span.endTimeUnixNano) / 1_000_000n),
              });
            }
          }
        }
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    })().catch(() => {
      res.writeHead(400);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,

    spans: () => [...collected],

    clear: () => {
      collected.length = 0;
    },

    async waitFor(pick, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const result = pick([...collected]);

        if (result !== undefined) {
          return result;
        }

        if (Date.now() > deadline) {
          const names = collected.map((s) => s.name).join(', ');

          throw new Error(`timed out waiting for spans; collected so far: [${names}]`);
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },

    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
