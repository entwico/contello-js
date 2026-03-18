import { describe, expect, test } from 'bun:test';
import { parse } from 'graphql';

import { collectOperations } from './documents';
import { generateOperationsObject } from './operations';

describe('generateOperationsObject', () => {
  test('generates type and runtime object for a query', () => {
    const doc = parse(`query GetUsers { users { id } }`);
    const operations = collectOperations([doc]);
    const result = generateOperationsObject(operations);

    expect(result).toContain('export type Operations = {');
    expect(result).toContain('  getUsers: {');
    expect(result).toContain('    document: string;');
    expect(result).toContain("    kind: 'query';");
    expect(result).toContain('    __result?: GetUsersQuery | undefined;');
    expect(result).toContain('    __variables?: GetUsersQueryVariables | undefined;');
    expect(result).toContain('export const operations: Operations = {');
    expect(result).toContain("  getUsers: { document: getUsersDocument, kind: 'query' },");
  });

  test('generates correct types for mutation', () => {
    const doc = parse(`mutation CreateUser($name: String!) { createUser(name: $name) { id } }`);
    const operations = collectOperations([doc]);
    const result = generateOperationsObject(operations);

    expect(result).toContain("    kind: 'mutation';");
    expect(result).toContain('    __result?: CreateUserMutation | undefined;');
    expect(result).toContain('    __variables?: CreateUserMutationVariables | undefined;');
    expect(result).toContain("  createUser: { document: createUserDocument, kind: 'mutation' },");
  });

  test('generates correct types for subscription', () => {
    const doc = parse(`subscription OnUpdate { updates { id } }`);
    const operations = collectOperations([doc]);
    const result = generateOperationsObject(operations);

    expect(result).toContain("    kind: 'subscription';");
    expect(result).toContain('    __result?: OnUpdateSubscription | undefined;');
    expect(result).toContain('    __variables?: OnUpdateSubscriptionVariables | undefined;');
  });

  test('handles multiple operations', () => {
    const doc = parse(`
      query GetUser { user { id } }
      mutation DeleteUser($id: ID!) { deleteUser(id: $id) }
      subscription OnUserUpdate { userUpdate { id } }
    `);

    const operations = collectOperations([doc]);
    const result = generateOperationsObject(operations);

    expect(result).toContain('getUser:');
    expect(result).toContain('deleteUser:');
    expect(result).toContain('onUserUpdate:');
  });

  test('uncapitalizes operation names', () => {
    const doc = parse(`query FetchAllArticles { articles { id } }`);
    const operations = collectOperations([doc]);
    const result = generateOperationsObject(operations);

    expect(result).toContain('  fetchAllArticles: {');
    expect(result).toContain('    __result?: FetchAllArticlesQuery | undefined;');
  });

  test('returns empty structures for no operations', () => {
    const result = generateOperationsObject([]);

    expect(result).toContain('export type Operations = {');
    expect(result).toContain('};');
    expect(result).toContain('export const operations: Operations = {');
    expect(result).toContain('} as Operations;');
  });
});
