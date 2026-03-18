import { describe, expect, test } from 'bun:test';
import { parse } from 'graphql';

import { collectFragments, collectOperations, generateDocumentString } from './documents';

describe('collectFragments', () => {
  test('collects named fragments from documents', () => {
    const doc = parse(`
      fragment UserFields on User {
        id
        name
      }
      fragment PostFields on Post {
        id
        title
      }
    `);

    const fragments = collectFragments([doc]);

    expect(fragments.size).toBe(2);
    expect(fragments.has('UserFields')).toBe(true);
    expect(fragments.has('PostFields')).toBe(true);
  });

  test('returns empty map for no fragments', () => {
    const doc = parse(`query GetUser { user { id } }`);
    const fragments = collectFragments([doc]);

    expect(fragments.size).toBe(0);
  });

  test('collects from multiple documents', () => {
    const doc1 = parse(`fragment A on User { id }`);
    const doc2 = parse(`fragment B on Post { id }`);
    const fragments = collectFragments([doc1, doc2]);

    expect(fragments.size).toBe(2);
  });
});

describe('collectOperations', () => {
  test('collects named operations', () => {
    const doc = parse(`
      query GetUser { user { id } }
      mutation UpdateUser($id: ID!) { updateUser(id: $id) { id } }
    `);

    const operations = collectOperations([doc]);

    expect(operations.length).toBe(2);
    expect(operations[0]!.name!.value).toBe('GetUser');
    expect(operations[1]!.name!.value).toBe('UpdateUser');
  });

  test('throws on duplicate operation names', () => {
    const doc1 = parse(`query GetUser { user { id } }`);
    const doc2 = parse(`query GetUser { user { name } }`);

    expect(() => collectOperations([doc1, doc2])).toThrow('duplicate operation name: "GetUser"');
  });

  test('throws on unnamed operations', () => {
    const doc = parse(`query { user { id } }`);

    expect(() => collectOperations([doc])).toThrow('unnamed operations are not supported');
  });

  test('collects from multiple documents', () => {
    const doc1 = parse(`query A { user { id } }`);
    const doc2 = parse(`query B { post { id } }`);
    const operations = collectOperations([doc1, doc2]);

    expect(operations.length).toBe(2);
  });
});

describe('generateDocumentString', () => {
  test('generates document without fragments', () => {
    const doc = parse(`query GetUser { user { id name } }`);
    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);

    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('query GetUser');
    expect(result).toContain('id');
    expect(result).toContain('name');
  });

  test('includes used fragments', () => {
    const doc = parse(`
      fragment UserFields on User { id name }
      query GetUser { user { ...UserFields } }
    `);

    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment UserFields on User');
    expect(result).toContain('query GetUser');
  });

  test('excludes unused fragments', () => {
    const doc1 = parse(`fragment UserFields on User { id name }`);
    const doc2 = parse(`fragment PostFields on Post { id title }`);
    const doc3 = parse(`query GetUser { user { ...UserFields } }`);

    const fragments = collectFragments([doc1, doc2, doc3]);
    const operations = collectOperations([doc3]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment UserFields');
    expect(result).not.toContain('fragment PostFields');
  });

  test('includes transitively used fragments', () => {
    const doc = parse(`
      fragment BaseFields on User { id }
      fragment UserFields on User { ...BaseFields name }
      query GetUser { user { ...UserFields } }
    `);

    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment BaseFields');
    expect(result).toContain('fragment UserFields');
    expect(result).toContain('query GetUser');
  });

  test('orders dependent fragments before dependents', () => {
    const doc = parse(`
      fragment BaseFields on User { id }
      fragment UserFields on User { ...BaseFields name }
      query GetUser { user { ...UserFields } }
    `);

    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    const baseIndex = result.indexOf('fragment BaseFields');
    const userIndex = result.indexOf('fragment UserFields');
    const queryIndex = result.indexOf('query GetUser');

    expect(baseIndex).toBeLessThan(userIndex);
    expect(userIndex).toBeLessThan(queryIndex);
  });

  test('throws on unknown fragment spread', () => {
    const doc = parse(`query GetUser { user { ...UnknownFragment } }`);
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => generateDocumentString(operations[0]!, fragments)).toThrow('unknown fragment: "UnknownFragment"');
  });
});
