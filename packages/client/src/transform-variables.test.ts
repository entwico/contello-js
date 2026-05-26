import { describe, expect, test } from 'vitest';

import { transformVariables } from './transform-variables';

describe('transformVariables', () => {
  test('encodes LocalDateTime POJO to wire string', () => {
    const out = transformVariables({
      request: {
        entity: {
          attributes: {
            startDate: { year: 2026, month: 5, day: 26, hour: 20, minute: 0, second: 0 },
          },
        },
      },
    });

    expect(out).toEqual({
      request: { entity: { attributes: { startDate: '2026-05-26T20:00:00Z' } } },
    });
  });

  test('encodes LocalDate POJO to datetime wire string with zeroed time', () => {
    const out = transformVariables({ filter: { day: { year: 2026, month: 5, day: 26 } } });

    expect(out).toEqual({ filter: { day: '2026-05-26T00:00:00Z' } });
  });

  test('encodes arrays of structs', () => {
    const out = transformVariables({
      dates: [
        { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
        { year: 2027, month: 2, day: 2, hour: 0, minute: 0, second: 0 },
      ],
    });

    expect(out).toEqual({ dates: ['2026-01-01T00:00:00Z', '2027-02-02T00:00:00Z'] });
  });

  test('leaves non-managed values untouched', () => {
    const input = {
      name: 'foo',
      count: 42,
      flag: true,
      tags: ['a', 'b'],
      nested: { inner: 'val' },
    };

    expect(transformVariables(input)).toEqual(input);
  });

  test('does not encode objects with extra keys beyond the struct shape', () => {
    const input = {
      event: { year: 2026, month: 5, day: 1, hour: 0, minute: 0, second: 0, name: 'concert' },
    };

    expect(transformVariables(input)).toEqual(input);
  });

  test('passes through null and undefined', () => {
    expect(transformVariables(null)).toBeNull();
    expect(transformVariables(undefined)).toBeUndefined();
  });
});
