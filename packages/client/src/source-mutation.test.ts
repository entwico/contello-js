import { describe, expect, expectTypeOf, test } from 'vitest';

import { createSourceMutation, createSourceMutationVariables } from './source-mutation';
import type { SourceAccessors, SourceDef } from './types';

type Category = { id: string; name: string };

const source: SourceDef<'category', 'entity', Category> = {
  document: 'fragment Category on CategoryEntity { id name }',
  fragment: 'Category',
  subscription: 'categoriesBatch',
  mutations: {
    create: {
      field: 'createCategory',
      arguments: [{ name: 'request', type: 'CreateCategoryRequestInput!', from: 'input', envelope: 'entity' }],
      result: 'entity',
    },
    delete: {
      field: 'deleteCategory',
      arguments: [{ name: 'request', type: 'DeleteEntityByIdInput!', from: 'input' }],
      result: 'idObject',
    },
  },
  __model: 'category',
  __cardinality: 'entity',
};

describe('createSourceMutation', () => {
  test('selects the source fragment, so a create answers in the shape a read does', () => {
    expect(createSourceMutation(source, 'create')).toBe(
      'fragment Category on CategoryEntity { id name }\n' +
      'mutation($request: CreateCategoryRequestInput!) { result: createCategory(request: $request) { ...Category } }',
    );
  });

  test('selects only the id for a delete, which answers with a delete response', () => {
    expect(createSourceMutation(source, 'delete')).toBe(
      'mutation($request: DeleteEntityByIdInput!) { result: deleteCategory(request: $request) { id } }',
    );
  });

  test('returns the same document instance for repeated calls', () => {
    expect(createSourceMutation(source, 'create')).toBe(createSourceMutation(source, 'create'));
  });

  test('throws for a kind the schema exposes no mutation for', () => {
    expect(() => createSourceMutation(source, 'update')).toThrow(/has no update mutation/);
  });
});

describe('createSourceMutationVariables', () => {
  test('nests the input under the envelope field', () => {
    const variables = createSourceMutationVariables(source.mutations!.create!, {
      input: { attributes: { name: 'shoes' } },
    });

    expect(variables).toEqual({ request: { entity: { attributes: { name: 'shoes' } } } });
  });

  test('passes the input through when the argument is not an envelope', () => {
    const variables = createSourceMutationVariables(source.mutations!.delete!, {
      input: { id: 'a', force: true },
      id: 'a',
    });

    expect(variables).toEqual({ request: { id: 'a', force: true } });
  });

  test('encodes managed scalars on the way out', () => {
    const variables = createSourceMutationVariables(source.mutations!.create!, {
      input: { attributes: { publishedAt: { year: 2026, month: 8, day: 24, hour: 10, minute: 30, second: 0 } } },
    });

    expect(variables).toEqual({ request: { entity: { attributes: { publishedAt: '2026-08-24T10:30:00Z' } } } });
  });
});

describe('source write accessor typing', () => {
  type WritableSource = SourceDef<'category', 'entity', Category, { create: { name: string }; delete: { id: string } }>;

  // @ts-expect-error — the source binds no update mutation, so the accessor must not carry one
  type _NoUpdate = SourceAccessors<{ category: WritableSource }>['category']['update'];
  // @ts-expect-error — a source with no mutations at all carries no writers
  type _NoWriters = SourceAccessors<{ category: typeof source }>['category']['create'];

  test('carries one writer per bound mutation, typed from its input', () => {
    const accessors = {
      category: {
        fetch: async () => [],
        // a create selects the source fragment, so it answers with the entity, not with an id
        create: async (input: { name: string }) => ({ id: 'a', name: input.name }),
        delete: async (input: { id: string }) => input.id,
      },
    } satisfies SourceAccessors<{ category: WritableSource }>;

    expect(Object.keys(accessors.category)).toEqual(['fetch', 'create', 'delete']);
  });

  test('types a create as the source result and a delete as the id', () => {
    type Accessors = SourceAccessors<{ category: WritableSource }>['category'];

    expectTypeOf<Accessors['create']>().returns.resolves.toEqualTypeOf<Category>();
    expectTypeOf<Accessors['delete']>().returns.resolves.toEqualTypeOf<string>();
  });
});
