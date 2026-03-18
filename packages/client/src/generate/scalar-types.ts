export const SCALAR_MAP: Record<string, string> = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  ID: 'string',
  DateTime: 'string',
};

export const DEFAULT_CUSTOM_SCALAR = 'unknown';

export function resolveScalarType(name: string): string {
  return SCALAR_MAP[name] ?? DEFAULT_CUSTOM_SCALAR;
}
