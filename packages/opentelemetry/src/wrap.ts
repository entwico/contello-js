import dc from 'node:diagnostics_channel';
import { type Attributes, context, propagation } from '@opentelemetry/api';
import { InstrumentationBase } from '@opentelemetry/instrumentation';

import type { ContelloInstrumentationConfig } from './types';

declare const PACKAGE_VERSION: string;

/**
 * Parses the operation name into metric attributes.
 *
 * All callers use the convention `category:operation`, e.g.:
 * - `singleton:routes` -> { category: 'singleton', operation: 'routes' }
 * - `collection:assets` -> { category: 'collection', operation: 'assets' }
 * - `sdk:execute` -> { category: 'sdk', operation: 'execute' }
 * - `store:init` -> { category: 'store', operation: 'init' }
 *
 * If the name doesn't contain `:`, the whole name is used as the operation
 * with category 'unknown'.
 */
function parseMetricAttrs(name: string, extra?: Record<string, unknown>): Attributes {
  const colonIndex = name.indexOf(':');

  if (colonIndex === -1) {
    return { category: 'unknown', operation: name, ...extra };
  }

  return {
    category: name.slice(0, colonIndex),
    operation: name.slice(colonIndex + 1),
    ...extra,
  };
}

const CHANNEL_PREFIXES = ['contello:store', 'contello:sdk', 'contello:astro'] as const;

type ChannelHandler = (message: unknown) => void;

type Subscription = {
  channel: ReturnType<typeof dc.channel>;
  handler: ChannelHandler;
};

export class ContelloInstrumentation extends InstrumentationBase<ContelloInstrumentationConfig> {
  private _subscriptions: Subscription[] = [];

  constructor(config: ContelloInstrumentationConfig = {}) {
    super('@contello/opentelemetry', PACKAGE_VERSION, config);
  }

  override init() {
    return [];
  }

  override enable() {
    this._subscriptions ??= [];

    if (this._subscriptions.length > 0) {
      return;
    }

    const tracer = this.tracer;
    const meter = this.meter;

    const durationHistogram = meter.createHistogram('contello.operation.duration', {
      description: 'Duration of contello operations',
      unit: 'ms',
    });

    const errorCounter = meter.createCounter('contello.operation.error', {
      description: 'Number of failed contello operations',
    });

    const userConfig = this.getConfig() as ContelloInstrumentationConfig;

    for (const prefix of CHANNEL_PREFIXES) {
      const endChannel = dc.channel(`${prefix}.end`);
      const errorChannel = dc.channel(`${prefix}.error`);

      const onEnd: ChannelHandler = (message) => {
        const msg = message as { name: string; durationMs: number; cached?: boolean };
        const attrs = parseMetricAttrs(msg.name, { cached: msg.cached ?? false });

        durationHistogram.record(msg.durationMs, attrs);
        userConfig?.onComplete?.(msg.name, msg.durationMs);

        const span = tracer.startSpan(msg.name);

        span.setAttributes(attrs);
        span.end();
      };

      const onError: ChannelHandler = (message) => {
        const msg = message as { name: string; error: unknown; durationMs: number };
        const attrs = parseMetricAttrs(msg.name, { cached: false });

        durationHistogram.record(msg.durationMs, attrs);
        errorCounter.add(1, attrs);
        userConfig?.onError?.(msg.name, msg.error);

        const span = tracer.startSpan(msg.name);

        span.setAttributes(attrs);
        span.recordException(msg.error as Error);
        span.end();
      };

      endChannel.subscribe(onEnd);
      errorChannel.subscribe(onError);

      this._subscriptions.push({ channel: endChannel, handler: onEnd });
      this._subscriptions.push({ channel: errorChannel, handler: onError });
    }

    // message decorator for trace context propagation on WebSocket messages
    const messageChannel = dc.channel('contello:sdk.message');

    const onMessage: ChannelHandler = (message) => {
      const msg = message as { message: any };
      const output = {} as Record<string, string>;

      propagation.inject(context.active(), output);

      if (output['traceparent']) {
        msg.message.traceparent = output['traceparent'];
      }

      if (output['tracestate']) {
        msg.message.tracestate = output['tracestate'];
      }
    };

    messageChannel.subscribe(onMessage);

    this._subscriptions.push({ channel: messageChannel, handler: onMessage });
  }

  override disable() {
    for (const { channel, handler } of this._subscriptions) {
      channel.unsubscribe(handler);
    }

    this._subscriptions = [];
  }
}
