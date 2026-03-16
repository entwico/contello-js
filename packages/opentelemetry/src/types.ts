import type { InstrumentationConfig } from '@opentelemetry/instrumentation';

export type ContelloInstrumentationConfig = InstrumentationConfig & {
  onComplete?: ((name: string, durationMs: number) => void) | undefined;
  onError?: ((name: string, error: unknown) => void) | undefined;
};
