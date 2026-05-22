import { buildSchema, parse } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectFragments } from './documents';
import {
  type SourceBinding,
  type SourceEntry,
  generateSourcesConst,
  generateSourcesType,
  indexBuiltInSources,
  indexEntitySources,
} from './sources';

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
    contelloAssetsBatch: [ContelloAsset!]!
    contelloRoutesBatch: [ContelloRoute!]!
    contelloI18nMessagesBatch(collectionReferenceName: String!): [ContelloI18nMessage!]!
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

  type ContelloAsset { id: ID! }
  type ContelloRoute { id: ID! }
  type ContelloI18nMessage { id: ID!, token: String! }

  union ContelloEntity = CategoryEntity | ConfigEntity | ProductEntity
`;

const schema = buildSchema(sdl);

describe('indexEntitySources', () => {
  test('binds a list Subscription field as an entity-collection', () => {
    const map = indexEntitySources(schema);

    expect(map.get('CategoryEntity')).toEqual({
      cardinality: 'entity',
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

  test('prefers the entity binding when both a list and a singleton lookup field exist for the same entity', () => {
    const map = indexEntitySources(schema);

    expect(map.get('CategoryEntity')?.cardinality).toBe('entity');
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

describe('indexBuiltInSources', () => {
  test('binds ContelloRoute / ContelloAsset / ContelloI18nMessage when their batch subscriptions exist', () => {
    const map = indexBuiltInSources(schema);

    expect(map.get('ContelloRoute')).toEqual({
      cardinality: 'route',
      fieldName: 'contelloRoutesBatch',
    });
    expect(map.get('ContelloAsset')).toEqual({
      cardinality: 'asset',
      fieldName: 'contelloAssetsBatch',
    });
    expect(map.get('ContelloI18nMessage')).toEqual({
      cardinality: 'i18nMessage',
      fieldName: 'contelloI18nMessagesBatch',
    });
  });

  test('skips types whose subscription field is absent', () => {
    const partial = buildSchema(`
      type Query { _empty: String }
      type Subscription { contelloRoutesBatch: [ContelloRoute!]! }
      type ContelloRoute { id: ID! }
      type ContelloAsset { id: ID! }
    `);

    const map = indexBuiltInSources(partial);

    expect(map.has('ContelloRoute')).toBe(true);
    expect(map.has('ContelloAsset')).toBe(false);
  });
});

describe('generateSourcesType', () => {
  test('emits entity + built-in entries keyed correctly', () => {
    const doc = parse(`
      fragment Category on CategoryEntity { id }
      fragment Config on ConfigEntity { brandName }
      fragment StoreRoute on ContelloRoute { id }
      fragment StoreAsset on ContelloAsset { id }
      fragment StoreI18nMessage on ContelloI18nMessage { id token }
    `);
    const fragments = collectFragments([doc]);
    const entityBindings = indexEntitySources(schema);
    const builtInBindings = indexBuiltInSources(schema);

    const entries: SourceEntry[] = [];

    for (const [name, fragment] of fragments) {
      const typeName = fragment.typeCondition.name.value;
      const entity = entityBindings.get(typeName);
      const builtIn = builtInBindings.get(typeName);

      const binding: SourceBinding | undefined = entity
        ? { cardinality: entity.cardinality, fieldName: entity.fieldName, sourceKey: entity.model }
        : builtIn
          ? {
              cardinality: builtIn.cardinality,
              fieldName: builtIn.fieldName,
              sourceKey: name.charAt(0).toLowerCase() + name.slice(1),
            }
          : undefined;

      if (binding) {
        entries.push({ fragmentName: name, binding, fragmentExpression: `${name}FragmentSchema` });
      }
    }

    const out = generateSourcesType(entries);

    expect(out).toContain('export type Sources = {');
    expect(out).toContain("category: SourceDef<'category', 'entity', CategoryFragment>;");
    expect(out).toContain("config: SourceDef<'config', 'singleton', ConfigFragment>;");
    expect(out).toContain("storeRoute: SourceDef<'storeRoute', 'route', StoreRouteFragment>;");
    expect(out).toContain("storeAsset: SourceDef<'storeAsset', 'asset', StoreAssetFragment>;");
    expect(out).toContain("storeI18nMessage: SourceDef<'storeI18nMessage', 'i18nMessage', StoreI18nMessageFragment>;");
  });

  test('returns empty string when there are no entries', () => {
    expect(generateSourcesType([])).toBe('');
  });
});

describe('generateSourcesConst', () => {
  test('emits an internal `const sources: Sources = { ... }` (not exported)', () => {
    const doc = parse(`fragment Category on CategoryEntity { id }`);
    const fragments = collectFragments([doc]);
    const bindings = indexEntitySources(schema);
    const entries: SourceEntry[] = [...fragments].map(([name, fragment]) => {
      const b = bindings.get(fragment.typeCondition.name.value)!;

      return {
        fragmentName: name,
        binding: { cardinality: b.cardinality, fieldName: b.fieldName, sourceKey: b.model },
        fragmentExpression: `${name}FragmentSchema`,
      };
    });

    const out = generateSourcesConst(entries);

    expect(out).toContain('const sources: Sources = {');
    expect(out).not.toContain('export const sources');
    expect(out).toContain('category: {');
    expect(out).toContain("fragment: 'Category',");
    expect(out).toContain("subscription: 'categoriesBatch',");
    expect(out).toContain("__cardinality: 'entity',");
  });

  test('emits a built-in entry keyed by uncapitalized fragment name with cardinality + subscription', () => {
    const builtIns = indexBuiltInSources(schema);
    const b = builtIns.get('ContelloRoute')!;

    const out = generateSourcesConst([
      {
        fragmentName: 'StoreRoute',
        binding: { cardinality: b.cardinality, fieldName: b.fieldName, sourceKey: 'storeRoute' },
        fragmentExpression: 'StoreRouteFragmentSchema',
      },
    ]);

    expect(out).toContain('storeRoute: {');
    expect(out).toContain("subscription: 'contelloRoutesBatch',");
    expect(out).toContain("__cardinality: 'route',");
    expect(out).toContain("__model: 'storeRoute',");
  });

  test('returns empty string when there are no entries', () => {
    expect(generateSourcesConst([])).toBe('');
  });

  test('throws when two fragments target the same source key', () => {
    const binding: SourceBinding = { cardinality: 'entity', fieldName: 'categoriesBatch', sourceKey: 'category' };

    expect(() =>
      generateSourcesConst([
        { fragmentName: 'CategoryListing', binding, fragmentExpression: 'CategoryListingFragmentSchema' },
        { fragmentName: 'CategoryDetail', binding, fragmentExpression: 'CategoryDetailFragmentSchema' },
      ]),
    ).toThrow(/multiple fragments target the same source key "category"/);
  });

  test('emits entries sorted by source key', () => {
    const product: SourceBinding = { cardinality: 'entity', fieldName: 'productsBatch', sourceKey: 'product' };
    const config: SourceBinding = { cardinality: 'singleton', fieldName: 'config', sourceKey: 'config' };

    const out = generateSourcesConst([
      { fragmentName: 'Product', binding: product, fragmentExpression: 'ProductFragmentSchema' },
      { fragmentName: 'Config', binding: config, fragmentExpression: 'ConfigFragmentSchema' },
    ]);

    expect(out.indexOf('config: {')).toBeLessThan(out.indexOf('product: {'));
  });
});
