import { encodeLocalDate, encodeLocalDateTime, isLocalDate, isLocalDateTime } from './scalars';

/**
 * encodes outgoing variables: LocalDateTime / LocalDate POJOs become wire strings.
 * detection is by shape — generated input types use the struct types, so consumers
 * pass structs in the right places, and stray objects with the same shape would be
 * an extremely unusual coincidence.
 */
export function transformVariables<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => transformVariables(item)) as unknown as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (isLocalDateTime(value)) {
    return encodeLocalDateTime(value) as unknown as T;
  }

  if (isLocalDate(value)) {
    return encodeLocalDate(value) as unknown as T;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    out[key] = transformVariables(obj[key]);
  }

  return out as unknown as T;
}
