import { describe, expect, test } from 'vitest';

import {
  decodeLocalDate,
  decodeLocalDateTime,
  encodeLocalDate,
  encodeLocalDateTime,
  isLocalDate,
  isLocalDateTime,
} from './scalars';

describe('LocalDateTime', () => {
  test('decode strips trailing Z', () => {
    expect(decodeLocalDateTime('2026-05-26T20:00:00Z')).toEqual({
      year: 2026,
      month: 5,
      day: 26,
      hour: 20,
      minute: 0,
      second: 0,
    });
  });

  test('decode strips trailing offset', () => {
    expect(decodeLocalDateTime('2026-05-26T20:00:00+02:00')).toEqual({
      year: 2026,
      month: 5,
      day: 26,
      hour: 20,
      minute: 0,
      second: 0,
    });
  });

  test('decode strips fractional seconds', () => {
    expect(decodeLocalDateTime('2026-05-26T20:00:00.123Z')).toEqual({
      year: 2026,
      month: 5,
      day: 26,
      hour: 20,
      minute: 0,
      second: 0,
    });
  });

  test('decode tolerates missing tz', () => {
    expect(decodeLocalDateTime('2026-05-26T20:00:00')).toEqual({
      year: 2026,
      month: 5,
      day: 26,
      hour: 20,
      minute: 0,
      second: 0,
    });
  });

  test('decode throws on garbage', () => {
    expect(() => decodeLocalDateTime('not-a-date')).toThrow(/cannot decode LocalDateTime/);
  });

  test('encode always pins trailing Z and zero-pads', () => {
    expect(encodeLocalDateTime({ year: 2026, month: 5, day: 1, hour: 9, minute: 3, second: 7 })).toBe(
      '2026-05-01T09:03:07Z',
    );
  });

  test('encode handles single-digit year padding', () => {
    expect(encodeLocalDateTime({ year: 5, month: 1, day: 1, hour: 0, minute: 0, second: 0 })).toBe(
      '0005-01-01T00:00:00Z',
    );
  });

  test('isLocalDateTime — true for exact shape with numeric values', () => {
    expect(isLocalDateTime({ year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0 })).toBe(true);
  });

  test('isLocalDateTime — false when extra keys present', () => {
    expect(isLocalDateTime({ year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0, name: 'x' })).toBe(false);
  });

  test('isLocalDateTime — false when key is missing', () => {
    expect(isLocalDateTime({ year: 2026, month: 5, day: 1, hour: 0, minute: 0 })).toBe(false);
  });

  test('isLocalDateTime — false for string values', () => {
    expect(isLocalDateTime({ year: '2026', month: 5, day: 1, hour: 0, minute: 0, second: 0 })).toBe(false);
  });

  test('isLocalDateTime — false for primitives', () => {
    expect(isLocalDateTime(null)).toBe(false);
    expect(isLocalDateTime('2026-05-01T00:00:00Z')).toBe(false);
    expect(isLocalDateTime(undefined)).toBe(false);
    expect(isLocalDateTime([])).toBe(false);
  });

  test('isLocalDateTime — false for LocalDate shape', () => {
    expect(isLocalDateTime({ year: 2026, month: 5, day: 1 })).toBe(false);
  });
});

describe('LocalDate', () => {
  test('decode accepts plain date', () => {
    expect(decodeLocalDate('2026-05-26')).toEqual({ year: 2026, month: 5, day: 26 });
  });

  test('decode accepts datetime form', () => {
    expect(decodeLocalDate('2026-05-26T00:00:00Z')).toEqual({ year: 2026, month: 5, day: 26 });
  });

  test('decode throws on garbage', () => {
    expect(() => decodeLocalDate('not-a-date')).toThrow(/cannot decode LocalDate/);
  });

  test('encode always pads time with zeroes and trailing Z (Contello wire format)', () => {
    expect(encodeLocalDate({ year: 2026, month: 5, day: 1 })).toBe('2026-05-01T00:00:00Z');
  });

  test('isLocalDate — true for exact shape with numeric values', () => {
    expect(isLocalDate({ year: 2026, month: 5, day: 1 })).toBe(true);
  });

  test('isLocalDate — false for LocalDateTime shape', () => {
    expect(isLocalDate({ year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0 })).toBe(false);
  });

  test('isLocalDate — false when missing a key', () => {
    expect(isLocalDate({ year: 2026, month: 5 })).toBe(false);
  });

  test('isLocalDate — false for string values', () => {
    expect(isLocalDate({ year: '2026', month: 5, day: 1 })).toBe(false);
  });
});
