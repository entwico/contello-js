import { describe, expect, test } from 'vitest';

import { DEFAULT_CUSTOM_SCALAR, SCALAR_MAP, resolveScalarType } from './scalar-types';

describe('SCALAR_MAP', () => {
  test('maps built-in scalars', () => {
    expect(SCALAR_MAP['String']).toBe('string');
    expect(SCALAR_MAP['Int']).toBe('number');
    expect(SCALAR_MAP['Float']).toBe('number');
    expect(SCALAR_MAP['Boolean']).toBe('boolean');
    expect(SCALAR_MAP['ID']).toBe('string');
  });

  test('maps DateTime to string', () => {
    expect(SCALAR_MAP['DateTime']).toBe('string');
  });
});

describe('resolveScalarType', () => {
  test('resolves known scalars', () => {
    expect(resolveScalarType('String')).toBe('string');
    expect(resolveScalarType('Int')).toBe('number');
    expect(resolveScalarType('DateTime')).toBe('string');
  });

  test('returns default for unknown scalars', () => {
    expect(resolveScalarType('JSON')).toBe(DEFAULT_CUSTOM_SCALAR);
    expect(resolveScalarType('Upload')).toBe('unknown');
  });
});
