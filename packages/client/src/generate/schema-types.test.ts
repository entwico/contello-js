import { describe, expect, test } from 'bun:test';
import { buildSchema } from 'graphql';

import { generateSchemaTypes } from './schema-types';

describe('generateSchemaTypes', () => {
  test('generates enum types', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      enum Status { ACTIVE INACTIVE DELETED }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain("export type Status = 'ACTIVE' | 'DELETED' | 'INACTIVE';");
  });

  test('generates object types with __typename', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      type User { id: ID! name: String }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('export type User = {');
    expect(result).toContain("__typename?: 'User' | undefined;");
    expect(result).toContain('id: string;');
    expect(result).toContain('name?: string | undefined;');
  });

  test('generates input types without __typename', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      input CreateUserInput { name: String! email: String }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('export type CreateUserInput = {');
    expect(result).toContain('name: string;');
    expect(result).toContain('email?: string | undefined;');
    expect(result).not.toContain('CreateUserInput = {\n  __typename');
  });

  test('generates union types', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      type Cat { name: String }
      type Dog { name: String }
      union Animal = Cat | Dog
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('export type Animal = Cat | Dog;');
  });

  test('generates interface types with string __typename', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      interface Node { id: ID! }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('export type Node = {');
    expect(result).toContain('__typename?: string | undefined;');
    expect(result).toContain('id: string;');
  });

  test('maps custom scalars to any', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      scalar JSON
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('export type JSON = unknown;');
  });

  test('does not emit known scalars as custom types', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      scalar DateTime
    `);

    const result = generateSchemaTypes(schema);

    expect(result).not.toContain('export type DateTime');
    expect(result).not.toContain('export type String');
  });

  test('handles list types', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      type User { tags: [String!]! friends: [User] }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('tags: string[];');
    expect(result).toContain('friends?: (User | undefined)[] | undefined;');
  });

  test('handles non-null fields', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      type User { id: ID! name: String! email: String }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('id: string;');
    expect(result).toContain('name: string;');
    expect(result).toContain('email?: string | undefined;');
  });

  test('skips internal types', () => {
    const schema = buildSchema(`type Query { dummy: String }`);
    const result = generateSchemaTypes(schema);

    expect(result).not.toContain('__Schema');
    expect(result).not.toContain('__Type');
    expect(result).not.toContain('__Field');
  });

  test('generates models const and type from ContelloEntity union', () => {
    const schema = buildSchema(`
      type Query { dummy: String }
      type ArticleEntity { id: ID! }
      type ProductEntity { id: ID! }
      union ContelloEntity = ArticleEntity | ProductEntity
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain("article: 'ArticleEntity',");
    expect(result).toContain("product: 'ProductEntity',");
    expect(result).toContain('export type ModelType = keyof typeof models;');
  });

  test('does not generate models when ContelloEntity union is missing', () => {
    const schema = buildSchema(`type Query { dummy: String }`);
    const result = generateSchemaTypes(schema);

    expect(result).not.toContain('export const models');
    expect(result).not.toContain('ModelType');
  });

  test('maps DateTime fields to string', () => {
    const schema = buildSchema(`
      scalar DateTime
      type Query { dummy: String }
      type Event { startedAt: DateTime! createdAt: DateTime }
    `);

    const result = generateSchemaTypes(schema);

    expect(result).toContain('startedAt: string;');
    expect(result).toContain('createdAt?: string | undefined;');
  });
});
