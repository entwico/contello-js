function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined) {
    return defaultValue;
  }

  const value = raw.trim().toLowerCase();

  if (value === '') {
    return defaultValue;
  }

  return !['false', '0', 'no', 'off'].includes(value);
}

export const otelEnv = {
  enabled: envFlag('OTEL_CONTELLO_ENABLED', true),
  captureQuery: envFlag('OTEL_CONTELLO_CAPTURE_QUERY', false),
  captureVariables: envFlag('OTEL_CONTELLO_CAPTURE_VARIABLES', false),
} as const;
