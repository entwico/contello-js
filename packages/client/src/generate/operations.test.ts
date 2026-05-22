import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectOperations } from './documents';
import { generateOperationsConst, generateOperationsType } from './operations';

describe('generateOperationsType', () => {
  test('generates Operations type with phantom result + variables fields per operation', () => {
    const doc = parse(`query GetUsers { users { id } }`);
    const ops = collectOperations([doc]);
    const result = generateOperationsType(ops);

    expect(result).toContain('export type Operations = {');
    expect(result).toContain('  getUsers: {');
    expect(result).toContain('    document: string;');
    expect(result).toContain("    kind: 'query';");
    expect(result).toContain('    __result?: GetUsersQuery | undefined;');
    expect(result).toContain('    __variables?: GetUsersQueryVariables | undefined;');
  });

  test('discriminates query / mutation / subscription via `kind`', () => {
    const doc = parse(`
      query GetUser { user { id } }
      mutation CreateUser($name: String!) { createUser(name: $name) { id } }
      subscription OnUpdate { updates { id } }
    `);
    const result = generateOperationsType(collectOperations([doc]));

    expect(result).toContain("    kind: 'query';");
    expect(result).toContain("    kind: 'mutation';");
    expect(result).toContain("    kind: 'subscription';");
  });

  test('uncapitalizes operation names', () => {
    const doc = parse(`query FetchAllArticles { articles { id } }`);
    const result = generateOperationsType(collectOperations([doc]));

    expect(result).toContain('  fetchAllArticles: {');
    expect(result).toContain('    __result?: FetchAllArticlesQuery | undefined;');
  });

  test('returns just the empty Operations type when there are no operations', () => {
    expect(generateOperationsType([])).toBe(['export type Operations = {', '};'].join('\n'));
  });
});

describe('generateOperationsConst', () => {
  test('emits an internal `const operations: Operations = { ... }` referencing per-op document consts', () => {
    const doc = parse(`query GetUsers { users { id } }`);
    const result = generateOperationsConst(collectOperations([doc]));

    expect(result).toContain('const operations: Operations = {');
    expect(result).not.toContain('export const operations'); // internal, not exported
    expect(result).toContain("  getUsers: { document: getUsersDocument, kind: 'query' },");
  });

  test('handles multiple operations of mixed kinds', () => {
    const doc = parse(`
      query GetUser { user { id } }
      mutation DeleteUser($id: ID!) { deleteUser(id: $id) }
      subscription OnUserUpdate { userUpdate { id } }
    `);
    const result = generateOperationsConst(collectOperations([doc]));

    expect(result).toContain("getUser: { document: getUserDocument, kind: 'query' },");
    expect(result).toContain("deleteUser: { document: deleteUserDocument, kind: 'mutation' },");
    expect(result).toContain("onUserUpdate: { document: onUserUpdateDocument, kind: 'subscription' },");
  });
});
