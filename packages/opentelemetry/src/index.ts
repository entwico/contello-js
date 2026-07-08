import { api } from './api';
import { otelEnv } from './env';

const otel = otelEnv.enabled ? api : undefined;

export type OperationAttributes = Record<string, string | number | boolean>;

export type OperationTelemetry = {
  /**
   * Runs `fn` inside an active span named `name` (convention: `category:operation`) and records
   * duration/error metrics. Sync results are attributed `cached: true`, promises `cached: false`.
   * Zero-overhead pass-through when `@opentelemetry/api` is absent or `OTEL_CONTELLO_ENABLED=false`.
   */
  wrap: <T>(name: string, fn: () => T, attributes?: OperationAttributes | undefined) => T;
};

function parseOperationAttributes(name: string): OperationAttributes {
  const colonIndex = name.indexOf(':');

  if (colonIndex === -1) {
    return { category: 'unknown', operation: name };
  }

  return { category: name.slice(0, colonIndex), operation: name.slice(colonIndex + 1) };
}

export function createOperationTelemetry(scope: string): OperationTelemetry {
  if (!otel) {
    return { wrap: (_name, fn) => fn() };
  }

  const { SpanStatusCode } = otel;
  const tracer = otel.trace.getTracer(scope);
  const meter = otel.metrics.getMeter(scope);

  const duration = meter.createHistogram('contello.operation.duration', {
    description: 'duration of contello operations',
    unit: 'ms',
  });

  const errors = meter.createCounter('contello.operation.error', {
    description: 'number of failed contello operations',
  });

  const wrap = <T>(name: string, fn: () => T, attributes?: OperationAttributes | undefined): T => {
    const attrs = { ...parseOperationAttributes(name), ...attributes };

    return tracer.startActiveSpan(name, { attributes: attrs }, (span) => {
      const start = performance.now();

      const finish = (cached: boolean) => {
        span.setAttribute('cached', cached);
        duration.record(performance.now() - start, { ...attrs, cached });
        span.end();
      };

      const fail = (error: unknown) => {
        duration.record(performance.now() - start, { ...attrs, cached: false });
        errors.add(1, attrs);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.end();
      };

      let result: T;

      try {
        result = fn();
      } catch (error) {
        fail(error);

        throw error;
      }

      if (result instanceof Promise) {
        const promise = result;

        return (async () => {
          try {
            const value = await promise;

            finish(false);

            return value;
          } catch (error) {
            fail(error);

            throw error;
          }
        })() as T;
      }

      finish(true);

      return result;
    });
  };

  return { wrap };
}

/**
 * Attributes for GraphQL operation spans, gated by `OTEL_CONTELLO_CAPTURE_QUERY` and
 * `OTEL_CONTELLO_CAPTURE_VARIABLES` (both off by default).
 */
export function graphqlOperationAttributes(
  document: string,
  variables?: Record<string, unknown> | undefined,
): OperationAttributes | undefined {
  if (!otel || (!otelEnv.captureQuery && !otelEnv.captureVariables)) {
    return undefined;
  }

  const attrs: OperationAttributes = {};

  if (otelEnv.captureQuery) {
    attrs['graphql.document'] = document;
  }

  if (otelEnv.captureVariables && variables !== undefined) {
    attrs['graphql.variables'] = JSON.stringify(variables);
  }

  return attrs;
}

/**
 * Injects W3C trace context (`traceparent` / `tracestate`) into an outgoing GraphQL
 * WebSocket message. Returns the message unchanged when telemetry is disabled.
 */
export function injectTraceContext(message: any): any {
  if (!otel) {
    return message;
  }

  const carrier: Record<string, string> = {};

  otel.propagation.inject(otel.context.active(), carrier);

  if (carrier['traceparent']) {
    message.traceparent = carrier['traceparent'];
  }

  if (carrier['tracestate']) {
    message.tracestate = carrier['tracestate'];
  }

  return message;
}
