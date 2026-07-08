import { type SpanStatus, propagation, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

class StubSpan {
  attributes: Record<string, unknown>;
  status: SpanStatus | undefined;
  exceptions: unknown[] = [];
  ended = false;

  constructor(
    public name: string,
    attributes: Record<string, unknown> | undefined,
  ) {
    this.attributes = { ...attributes };
  }

  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
  }

  recordException(error: unknown) {
    this.exceptions.push(error);
  }

  setStatus(status: SpanStatus) {
    this.status = status;
  }

  end() {
    this.ended = true;
  }
}

function registerStubTracerProvider(): StubSpan[] {
  const spans: StubSpan[] = [];

  const tracer = {
    startActiveSpan(name: string, options: { attributes?: Record<string, unknown> }, fn: (span: StubSpan) => unknown) {
      const span = new StubSpan(name, options.attributes);

      spans.push(span);

      return fn(span);
    },
  };

  trace.setGlobalTracerProvider({ getTracer: () => tracer } as never);

  return spans;
}

async function loadOtel() {
  vi.resetModules();

  return await import('./index');
}

afterEach(() => {
  vi.unstubAllEnvs();
  trace.disable();
  propagation.disable();
});

describe('createOperationTelemetry', () => {
  it('passes results through when disabled via OTEL_CONTELLO_ENABLED', async () => {
    vi.stubEnv('OTEL_CONTELLO_ENABLED', 'false');

    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');

    expect(wrap('a:b', () => 42)).toBe(42);
    expect(spans).toHaveLength(0);
  });

  it('wraps sync results in an ended span with cached=true', async () => {
    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');

    const result = wrap('collection:products', () => 'value', { extra: 1 });

    expect(result).toBe('value');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('collection:products');
    expect(spans[0]!.attributes).toMatchObject({
      category: 'collection',
      operation: 'products',
      extra: 1,
      cached: true,
    });
    expect(spans[0]!.ended).toBe(true);
    expect(spans[0]!.status).toBeUndefined();
  });

  it('uses category unknown for names without a colon', async () => {
    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');

    wrap('routes', () => 1);

    expect(spans[0]!.attributes).toMatchObject({ category: 'unknown', operation: 'routes' });
  });

  it('resolves async results and ends the span with cached=false', async () => {
    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');

    const result = wrap('rpc:getThing', async () => 'async-value');

    expect(spans[0]!.ended).toBe(false);
    await expect(result).resolves.toBe('async-value');
    expect(spans[0]!.ended).toBe(true);
    expect(spans[0]!.attributes['cached']).toBe(false);
  });

  it('records sync errors and rethrows', async () => {
    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');
    const error = new Error('boom');

    expect(() =>
      wrap('a:b', () => {
        throw error;
      }),
    ).toThrow(error);
    expect(spans[0]!.exceptions).toEqual([error]);
    expect(spans[0]!.status?.message).toBe('boom');
    expect(spans[0]!.ended).toBe(true);
  });

  it('records async rejections and rethrows', async () => {
    const spans = registerStubTracerProvider();
    const { createOperationTelemetry } = await loadOtel();
    const { wrap } = createOperationTelemetry('@contello/test');
    const error = new Error('async boom');

    await expect(wrap('a:b', () => Promise.reject(error))).rejects.toBe(error);
    expect(spans[0]!.exceptions).toEqual([error]);
    expect(spans[0]!.status?.message).toBe('async boom');
    expect(spans[0]!.ended).toBe(true);
  });
});

describe('graphqlOperationAttributes', () => {
  it('returns undefined by default', async () => {
    const { graphqlOperationAttributes } = await loadOtel();

    expect(graphqlOperationAttributes('query { x }', { a: 1 })).toBeUndefined();
  });

  it('captures the document when OTEL_CONTELLO_CAPTURE_QUERY is set', async () => {
    vi.stubEnv('OTEL_CONTELLO_CAPTURE_QUERY', 'true');

    const { graphqlOperationAttributes } = await loadOtel();

    expect(graphqlOperationAttributes('query { x }', { a: 1 })).toEqual({ 'graphql.document': 'query { x }' });
  });

  it('captures variables when OTEL_CONTELLO_CAPTURE_VARIABLES is set', async () => {
    vi.stubEnv('OTEL_CONTELLO_CAPTURE_VARIABLES', 'true');

    const { graphqlOperationAttributes } = await loadOtel();

    expect(graphqlOperationAttributes('query { x }', { a: 1 })).toEqual({ 'graphql.variables': '{"a":1}' });
    expect(graphqlOperationAttributes('query { x }')).toEqual({});
  });
});

describe('injectTraceContext', () => {
  it('returns the message unchanged without a registered propagator', async () => {
    const { injectTraceContext } = await loadOtel();
    const message = { type: 'subscribe' };

    expect(injectTraceContext(message)).toEqual({ type: 'subscribe' });
  });

  it('adds traceparent and tracestate from the registered propagator', async () => {
    propagation.setGlobalPropagator({
      inject: (_context: unknown, carrier: Record<string, string>) => {
        carrier['traceparent'] = '00-11111111111111111111111111111111-2222222222222222-01';
        carrier['tracestate'] = 'vendor=1';
      },
      extract: (context: unknown) => context,
      fields: () => ['traceparent', 'tracestate'],
    } as never);

    const { injectTraceContext } = await loadOtel();
    const message = injectTraceContext({ type: 'subscribe' });

    expect(message).toEqual({
      type: 'subscribe',
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      tracestate: 'vendor=1',
    });
  });
});
