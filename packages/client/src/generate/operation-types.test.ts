import { describe, expect, test } from 'bun:test';
import { buildSchema, parse } from 'graphql';

import { collectFragments, collectOperations } from './documents';
import { generateFragmentTypes, generateOperationTypes } from './operation-types';

function generate(sdl: string, gql: string): string {
  const schema = buildSchema(sdl);
  const doc = parse(gql);
  const operations = collectOperations([doc]);
  const fragments = collectFragments([doc]);

  return generateOperationTypes(schema, operations, fragments);
}

describe('generateOperationTypes', () => {
  const baseSdl = `
    type Query {
      user(id: ID!): User
      users: [User!]!
    }
    type User {
      id: ID!
      name: String!
      email: String
    }
  `;

  test('generates result type for query', () => {
    const result = generate(baseSdl, `query GetUser { user(id: "1") { id name } }`);

    expect(result).toContain('export type GetUserQuery = {');
    expect(result).toContain('id: string;');
    expect(result).toContain('name: string;');
  });

  test('generates variables type for query with variables', () => {
    const result = generate(baseSdl, `query GetUser($id: ID!) { user(id: $id) { id name } }`);

    expect(result).toContain('export type GetUserQueryVariables = {');
    expect(result).toContain('id: string;');
  });

  test('generates Record<string, never> for no variables', () => {
    const result = generate(baseSdl, `query GetUsers { users { id } }`);

    expect(result).toContain('export type GetUsersQueryVariables = Record<string, never>;');
  });

  test('handles optional variables', () => {
    const sdl = `
      type Query { users(limit: Int): [User!]! }
      type User { id: ID! }
    `;
    const result = generate(sdl, `query GetUsers($limit: Int) { users(limit: $limit) { id } }`);

    expect(result).toContain('limit?: number | undefined;');
  });

  test('handles nullable fields', () => {
    const result = generate(baseSdl, `query GetUser { user(id: "1") { id email } }`);

    expect(result).toContain('id: string;');
    expect(result).toContain('email?: string | undefined;');
  });

  test('handles nested selection sets', () => {
    const sdl = `
      type Query { user: User }
      type User { id: ID! profile: Profile }
      type Profile { bio: String avatar: String }
    `;
    const result = generate(sdl, `query GetUser { user { id profile { bio avatar } } }`);

    expect(result).toContain('export type GetUserQuery = {');
    expect(result).toContain('bio?: string | undefined;');
    expect(result).toContain('avatar?: string | undefined;');
  });

  test('handles list return types', () => {
    const result = generate(baseSdl, `query GetUsers { users { id name } }`);

    expect(result).toContain('id: string;');
    expect(result).toContain('name: string;');
  });

  test('handles mutation operations', () => {
    const sdl = `
      type Query { dummy: String }
      type Mutation { createUser(name: String!): User! }
      type User { id: ID! name: String! }
    `;
    const result = generate(sdl, `mutation CreateUser($name: String!) { createUser(name: $name) { id name } }`);

    expect(result).toContain('export type CreateUserMutation = {');
    expect(result).toContain('export type CreateUserMutationVariables = {');
    expect(result).toContain('name: string;');
  });

  test('handles subscription operations', () => {
    const sdl = `
      type Query { dummy: String }
      type Subscription { onUpdate: Update! }
      type Update { id: ID! data: String }
    `;
    const result = generate(sdl, `subscription OnUpdate { onUpdate { id data } }`);

    expect(result).toContain('export type OnUpdateSubscription = {');
    expect(result).toContain('export type OnUpdateSubscriptionVariables = Record<string, never>;');
  });

  test('handles enum fields', () => {
    const sdl = `
      type Query { user: User }
      type User { id: ID! status: Status! }
      enum Status { ACTIVE INACTIVE }
    `;
    const result = generate(sdl, `query GetUser { user { id status } }`);

    expect(result).toContain('status: Status;');
  });

  test('handles __typename field', () => {
    const sdl = `
      type Query { user: User }
      type User { id: ID! }
    `;
    const result = generate(sdl, `query GetUser { user { __typename id } }`);

    expect(result).toContain("__typename: 'User';");
  });

  test('handles inline fragments', () => {
    const sdl = `
      type Query { node: Node }
      interface Node { id: ID! }
      type User implements Node { id: ID! name: String }
      type Post implements Node { id: ID! title: String }
    `;
    const result = generate(
      sdl,
      `query GetNode {
        node {
          id
          ... on User { name }
          ... on Post { title }
        }
      }`,
    );

    expect(result).toContain('export type GetNodeQuery = {');
  });

  test('handles fragment spreads', () => {
    const sdl = `
      type Query { user: User }
      type User { id: ID! name: String! email: String }
    `;
    const result = generate(
      sdl,
      `
        fragment UserFields on User { id name }
        query GetUser { user { ...UserFields email } }
      `,
    );

    expect(result).toContain('export type GetUserQuery = {');
  });

  test('handles aliased fields', () => {
    const sdl = `
      type Query { user: User }
      type User { id: ID! name: String! }
    `;
    const result = generate(sdl, `query GetUser { user { identifier: id name } }`);

    expect(result).toContain('identifier: string;');
    expect(result).not.toContain('  id:');
  });

  test('handles DateTime scalar in operations', () => {
    const sdl = `
      scalar DateTime
      type Query { event: Event }
      type Event { id: ID! startedAt: DateTime! createdAt: DateTime }
    `;
    const result = generate(sdl, `query GetEvent { event { id startedAt createdAt } }`);

    expect(result).toContain('startedAt: string;');
    expect(result).toContain('createdAt?: string | undefined;');
  });

  test('handles input type variables', () => {
    const sdl = `
      type Query { dummy: String }
      type Mutation { createUser(input: CreateUserInput!): User! }
      input CreateUserInput { name: String! email: String }
      type User { id: ID! }
    `;

    const result = generate(sdl, `mutation CreateUser($input: CreateUserInput!) { createUser(input: $input) { id } }`);

    expect(result).toContain('input: CreateUserInput;');
  });

  test('handles variables with default values as optional', () => {
    const sdl = `
      type Query { users(limit: Int!): [User!]! }
      type User { id: ID! }
    `;
    const result = generate(sdl, `query GetUsers($limit: Int! = 10) { users(limit: $limit) { id } }`);

    expect(result).toContain('limit?: number | undefined;');
  });
});

function generateFragments(sdl: string, gql: string): string {
  const schema = buildSchema(sdl);
  const doc = parse(gql);
  const fragments = collectFragments([doc]);

  return generateFragmentTypes(schema, fragments);
}

describe('generateFragmentTypes', () => {
  test('generates named type for a simple fragment', () => {
    const sdl = `
      type Query { dummy: String }
      type User { id: ID! name: String! email: String }
    `;
    const result = generateFragments(sdl, `fragment UserFields on User { id name email }`);

    expect(result).toContain('export type UserFieldsFragment = {');
    expect(result).toContain('id: string;');
    expect(result).toContain('name: string;');
    expect(result).toContain('email?: string | undefined;');
  });

  test('generates types for multiple fragments', () => {
    const sdl = `
      type Query { dummy: String }
      type User { id: ID! name: String! }
      type Post { id: ID! title: String! }
    `;
    const result = generateFragments(
      sdl,
      `
        fragment UserFields on User { id name }
        fragment PostFields on Post { id title }
      `,
    );

    expect(result).toContain('export type UserFieldsFragment = {');
    expect(result).toContain('export type PostFieldsFragment = {');
  });

  test('handles fragment spreads within fragments', () => {
    const sdl = `
      type Query { dummy: String }
      type User { id: ID! name: String! profile: Profile }
      type Profile { bio: String avatar: String }
    `;
    const result = generateFragments(
      sdl,
      `
        fragment ProfileFields on Profile { bio avatar }
        fragment UserFields on User { id name profile { ...ProfileFields } }
      `,
    );

    expect(result).toContain('export type ProfileFieldsFragment = {');
    expect(result).toContain('export type UserFieldsFragment = {');
    expect(result).toContain('bio?: string | undefined;');
  });

  test('handles inline fragments on unions', () => {
    const sdl = `
      type Query { dummy: String }
      interface FileMetadata { width: Int! height: Int! }
      type ImageMetadata implements FileMetadata { width: Int! height: Int! }
      type VideoMetadata implements FileMetadata { width: Int! height: Int! }
      type File { uid: String! mimeType: String! metadata: FileMetadata }
    `;
    const result = generateFragments(
      sdl,
      `fragment FileFields on File {
        uid
        mimeType
        metadata {
          ... on ImageMetadata { width height }
          ... on VideoMetadata { width height }
        }
      }`,
    );

    expect(result).toContain('export type FileFieldsFragment = {');
    expect(result).toContain('uid: string;');
    expect(result).toContain('mimeType: string;');
    expect(result).toContain('width: number;');
    expect(result).toContain('height: number;');
  });

  test('returns empty string for no fragments', () => {
    const sdl = `type Query { dummy: String }`;
    const result = generateFragments(sdl, `query Dummy { dummy }`);

    expect(result).toBe('');
  });
});
