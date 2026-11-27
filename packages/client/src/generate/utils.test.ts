import { describe, expect, test } from 'vitest';

import { compareCodeUnits, deriveModelName, pascalCase, uncapitalize } from './utils';

describe('uncapitalize', () => {
  test('lowercases first character', () => {
    expect(uncapitalize('Hello')).toBe('hello');
    expect(uncapitalize('GetArticles')).toBe('getArticles');
  });

  test('keeps already lowercase', () => {
    expect(uncapitalize('hello')).toBe('hello');
  });

  test('handles single character', () => {
    expect(uncapitalize('A')).toBe('a');
  });
});

describe('pascalCase', () => {
  test('uppercases first character', () => {
    expect(pascalCase('query')).toBe('Query');
    expect(pascalCase('mutation')).toBe('Mutation');
    expect(pascalCase('subscription')).toBe('Subscription');
  });

  test('keeps already uppercase', () => {
    expect(pascalCase('Query')).toBe('Query');
  });

  test('handles single character', () => {
    expect(pascalCase('q')).toBe('Q');
  });
});

describe('codegen naming helpers', () => {
  test('compareCodeUnits orders by code unit and reports equal strings', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1);
    expect(compareCodeUnits('b', 'a')).toBe(1);
    expect(compareCodeUnits('a', 'a')).toBe(0);
    // unlike localeCompare, uppercase sorts before lowercase
    expect(['b', 'B', 'a'].toSorted(compareCodeUnits)).toEqual(['B', 'a', 'b']);
  });

  test('deriveModelName knows entity and component types only', () => {
    expect(deriveModelName('BlogPostEntity')).toBe('blogPost');
    expect(deriveModelName('TextComponent')).toBe('text');
    expect(deriveModelName('ContelloRoute')).toBeUndefined();
  });
});
