import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DemoServer, startDemoServer } from './demo-server';
import { type CollectedSpan, type OtlpCollector, startOtlpCollector } from './otlp-collector';
import { SPAN_KIND_SERVER, childrenOf, descendantsOf, findTraceProblems, serverSpanFor, traceOf } from './spans';

let collector: OtlpCollector;
let server: DemoServer;

beforeAll(async () => {
  collector = await startOtlpCollector();
  server = await startDemoServer(collector.url);
});

afterAll(async () => {
  if (process.env['E2E_SPANS_DUMP']) {
    writeFileSync(process.env['E2E_SPANS_DUMP'], JSON.stringify(collector.spans(), null, 2));
  }

  await server?.stop();
  await collector?.close();
});

function contelloSpans(spans: CollectedSpan[]): CollectedSpan[] {
  return spans.filter((s) => s.scope.startsWith('@contello/'));
}

async function requestAndTrace(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; trace: CollectedSpan[]; serverSpan: CollectedSpan }> {
  const seen = new Set(collector.spans().map((s) => s.spanId));
  const response = await fetch(`${server.baseUrl}${path}`, init);
  const serverSpan = await collector.waitFor(serverSpanFor(path.split('?', 1)[0]!, seen));
  const trace = traceOf(collector.spans(), serverSpan.traceId);

  return { response, trace, serverSpan };
}

describe('startup', () => {
  it('emits one startup trace with boot phases and store initialization', async () => {
    const startup = await collector.waitFor((spans) => spans.find((s) => s.name === 'startup' && s.endMs > 0));
    const trace = traceOf(collector.spans(), startup.traceId);

    const phases = childrenOf(trace, startup).map((s) => s.name);

    expect(phases).toContain('boot');
    expect(phases).toContain('listen');

    const boot = trace.find((s) => s.name === 'boot')!;
    const bootWork = descendantsOf(trace, boot).map((s) => s.name);

    expect(bootWork).toContain('store:init');
    expect(bootWork).toContain('watcher:start');
    expect(bootWork).toContain('collection:category');
    expect(bootWork).toContain('singleton:config');
  });
});

describe('entity routes', () => {
  it('serves a product page and traces the full cold path', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/products/cat');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Cat');

    expect(serverSpan.name).toBe('GET /contello/entities/product/[id]');
    expect(serverSpan.status).toBe('OK');
    expect(serverSpan.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'http.route': '/contello/entities/product/[id]',
      'contello.route.type': 'entity',
      'contello.route.model': 'product',
      'contello.route.path': '/products/cat',
    });

    const names = childrenOf(trace, serverSpan).map((s) => s.name);

    expect(names).toContain('response:first-byte');
    expect(names).toContain('routes');
    expect(names).toContain('route:entity:product');

    const routes = trace.find((s) => s.name === 'routes')!;

    expect(routes.scope).toBe('@contello/store');
    expect(routes.attributes['cached']).toBe(false);

    const entity = trace.find((s) => s.name === 'route:entity:product')!;

    expect(entity.scope).toBe('@contello/astro');
    expect(descendantsOf(trace, entity).map((s) => s.name)).toContain('lazy-collection:product');
  });

  it('serves the same product from cache without store fetch spans', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/products/cat');

    expect(response.status).toBe(200);
    expect(serverSpan.name).toBe('GET /contello/entities/product/[id]');

    const names = trace.map((s) => s.name);

    expect(names).toContain('route:entity:product');
    expect(names).not.toContain('routes');
    expect(names).not.toContain('lazy-collection:product');
  });

  it('serves the root static page with its component tree', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    expect(serverSpan.name).toBe('GET /contello/entities/staticPage/[id]');
    expect(serverSpan.attributes['contello.route.model']).toBe('staticPage');

    expect(trace.map((s) => s.name)).toContain('route:entity:staticPage');
  });
});

describe('redirect routes', () => {
  it('redirects and traces it as a contello redirect route', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/products/dog', { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/products/fox');

    expect(serverSpan.name).toBe('GET contello:route:redirect');
    expect(serverSpan.status).toBe('OK');
    expect(serverSpan.attributes).toMatchObject({
      'http.route': 'contello:route:redirect',
      'contello.route.type': 'redirect',
      'contello.route.path': '/products/dog',
      'http.response.status_code': 301,
    });

    expect(trace.map((s) => s.name)).toContain('route:redirect');
  });
});

describe('text routes', () => {
  it('serves text content and traces it as a contello text route', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/humans.txt');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('/* TEAM */');

    expect(serverSpan.name).toBe('GET contello:route:text');
    expect(serverSpan.attributes['contello.route.type']).toBe('text');

    expect(trace.map((s) => s.name)).toContain('route:text');
  });
});

describe('misses', () => {
  it('renders 404 for unknown paths after an uncached route lookup', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/does-not-exist');

    expect(response.status).toBe(404);

    expect(serverSpan.name).toBe('GET /404');
    expect(serverSpan.status).toBe('ERROR');
    expect(serverSpan.attributes['http.response.status_code']).toBe(404);
    expect(serverSpan.attributes['contello.route.type']).toBeUndefined();

    const names = trace.map((s) => s.name);

    expect(names).toContain('routes');
    expect(names.filter((n) => n.startsWith('route:'))).toEqual([]);

    // repeat lookups of the same unknown path are answered from the negative cache
    const warm = await requestAndTrace('/does-not-exist');

    expect(warm.response.status).toBe(404);
    expect(warm.trace.map((s) => s.name)).not.toContain('routes');
  });

  it('traces probe paths like favicon.ico under a server span instead of orphan traces', async () => {
    const { response, trace, serverSpan } = await requestAndTrace('/favicon.ico');

    expect(response.status).toBe(404);
    expect(serverSpan.kind).toBe(SPAN_KIND_SERVER);

    const routes = trace.find((s) => s.name === 'routes');

    expect(routes).toBeDefined();
    expect(routes!.parentSpanId).toBeDefined();
  });
});

describe('sync store access', () => {
  it('serves sync collection/singleton pages with no contello spans once the route miss is cached', async () => {
    const cold = await requestAndTrace('/categories');

    expect(cold.response.status).toBe(200);

    const body = await cold.response.text();

    expect(body).toContain('Toys');
    expect(body).toContain('Food');

    expect(cold.serverSpan.name).toBe('GET /categories');

    // first request resolves the url against contello routes once
    expect(contelloSpans(cold.trace).map((s) => s.name)).toEqual(['routes']);

    // the miss is negative-cached; sync collection and singleton reads produce no spans
    const warm = await requestAndTrace('/categories');

    expect(warm.response.status).toBe(200);
    expect(contelloSpans(warm.trace)).toEqual([]);
  });
});

describe('trace invariants', () => {
  it('all collected traces are well-formed', () => {
    const problems = findTraceProblems(collector.spans());

    expect(problems).toEqual([]);
  });
});
