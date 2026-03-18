import { describe, expect, test } from 'bun:test';

import { pascalCase, uncapitalize } from './utils';

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
