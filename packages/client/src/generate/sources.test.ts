import { buildSchema, parse } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectFragments } from './documents';
import { type EntitySourceBinding, generateSourcesObject, indexEntitySources } from './sources';

const sdl = `
  type Query {
    _empty: String
  }

  type Subscription {
    categoriesBatch: [CategoryEntity!]!
    categories: CategoryEntity
    config: ConfigEntity
    productsBatch: [ProductEntity!]!
    nonEntityField: SomeOther
  }

  type CategoryEntity {
    id: ID!
    name: String
  }

  type ConfigEntity {
    brandName: String
  }

  type ProductEntity {
    id: ID!
    name: String
  }

  type SomeOther {
    label: String
  }

  union ContelloEntity = CategoryEntity | ConfigEntity | ProductEntity
`;

const schema = buildSchema(sdl);

describe('indexEntitySources', () => {
  test('binds a list Subscription field as a collection', () => {
    const map = indexEntitySources(schema);

    expect(map.get('CategoryEntity')).toEqual({
      cardinality: 'collection',
      fieldName: 'categoriesBatch',
      model: 'category',
    });
  });

  test('binds a non-list Subscription field as a singleton', () => {
    const map = indexEntitySources(schema);

    expect(map.get('ConfigEntity')).toEqual({
      cardinality: 'singleton',
      fieldName: 'config',
      model: 'config',
    });
  });

  test('prefers the collection binding when both a list and a singleton lookup field exist for the same entity', () => {
    const map = indexEntitySources(schema);

    expect(map.get('CategoryEntity')?.cardinality).toBe('collection');
    expect(map.get('CategoryEntity')?.fieldName).toBe('categoriesBatch');
  });

  test('ignores types not in the ContelloEntity union', () => {
    const map = indexEntitySources(schema);

    expect(map.has('SomeOther')).toBe(false);
  });

  test('returns an empty map when the schema has no Subscription type', () => {
    const noSubSchema = buildSchema(`
      type Query { _empty: String }
      type CategoryEntity { id: ID! }
      union ContelloEntity = CategoryEntity
    `);

    expect(indexEntitySources(noSubSchema).size).toBe(0);
  });
});

describe('generateSourcesObject', () => {
  test('emits the Sources type and sources const keyed by model reference name', () => {
    const doc = parse(`
      fragment Category on CategoryEntity { id }
      fragment Config on ConfigEntity { brandName }
    `);
    const fragments = collectFragments([doc]);
    const bindings = indexEntitySources(schema);
    const entries = [...fragments].map(([name, fragment]) => ({
      fragmentName: name,
      binding: bindings.get(fragment.typeCondition.name.value)!,
      fragmentExpression: `${name}FragmentSchema`,
    }));

    const out = generateSourcesObject(entries);

    expect(out).toContain('export type Sources = {');
    expect(out).toContain("category: SourceDef<'category', 'collection', CategoryFragment>;");
    expect(out).toContain("config: SourceDef<'config', 'singleton', ConfigFragment>;");
    expect(out).toContain('export const sources: Sources = {');
    expect(out).toContain('category: {');
    expect(out).toContain('config: {');
    expect(out).toContain("fragment: 'Category',");
    expect(out).toContain("subscription: 'categoriesBatch',");
    expect(out).toContain("__cardinality: 'collection',");
    expect(out).toContain("__cardinality: 'singleton',");
  });

  test('returns empty string when there are no entries', () => {
    expect(generateSourcesObject([])).toBe('');
  });

  test('throws when two fragments target the same Contello model', () => {
    const binding: EntitySourceBinding = { cardinality: 'collection', fieldName: 'categoriesBatch', model: 'category' };

    expect(() =>
      generateSourcesObject([
        { fragmentName: 'CategoryListing', binding, fragmentExpression: 'CategoryListingFragmentSchema' },
        { fragmentName: 'CategoryDetail', binding, fragmentExpression: 'CategoryDetailFragmentSchema' },
      ]),
    ).toThrow(/multiple fragments target the same Contello model "category"/);
  });

  test('emits entries sorted by model name', () => {
    const collectionA: EntitySourceBinding = {
      cardinality: 'collection',
      fieldName: 'productsBatch',
      model: 'product',
    };
    const collectionB: EntitySourceBinding = { cardinality: 'singleton', fieldName: 'config', model: 'config' };

    const out = generateSourcesObject([
      { fragmentName: 'Product', binding: collectionA, fragmentExpression: 'ProductFragmentSchema' },
      { fragmentName: 'Config', binding: collectionB, fragmentExpression: 'ConfigFragmentSchema' },
    ]);

    expect(out.indexOf('config: {')).toBeLessThan(out.indexOf('product: {'));
  });
});
