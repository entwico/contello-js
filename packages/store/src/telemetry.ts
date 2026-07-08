import { createOperationTelemetry } from '@contello/opentelemetry';

export const { wrap } = createOperationTelemetry('@contello/store');
