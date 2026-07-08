import { createRequire } from 'node:module';
import type * as otelApi from '@opentelemetry/api';

export type OtelApi = typeof otelApi;

function loadApi(): OtelApi | undefined {
  try {
    return createRequire(import.meta.url)('@opentelemetry/api') as OtelApi;
  } catch {
    // @opentelemetry/api is not installed — telemetry stays disabled
    return undefined;
  }
}

export const api = loadApi();
