import { type GraphQLSchema, buildSchema, parse } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectFragments } from './documents';
import {
  type SourceBinding,
  type SourceEntry,
  generateSourcesConst,
  generateSourcesType,
  indexBuiltInMutations,
  indexBuiltInSources,
  indexEntityMutations,
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
        : (builtIn
            ? {
                cardinality: builtIn.cardinality,
                fieldName: builtIn.fieldName,
                sourceKey: name.charAt(0).toLowerCase() + name.slice(1),
              }
            : undefined);

      if (binding) {
        entries.push({ fragmentName: name, binding, fragmentExpression: `${name}FragmentSchema` });
      }
    }

    const out = generateSourcesType(entries);

    expect(out).toContain('export type Sources = {');
    expect(out).toContain('category: SourceDef<\'category\', \'entity\', CategoryFragment>;');
    expect(out).toContain('config: SourceDef<\'config\', \'singleton\', ConfigFragment>;');
    expect(out).toContain('storeRoute: SourceDef<\'storeRoute\', \'route\', StoreRouteFragment>;');
    expect(out).toContain('storeAsset: SourceDef<\'storeAsset\', \'asset\', StoreAssetFragment>;');
    expect(out).toContain('storeI18nMessage: SourceDef<\'storeI18nMessage\', \'i18nMessage\', StoreI18nMessageFragment>;');
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
    expect(out).toContain('fragment: \'Category\',');
    expect(out).toContain('subscription: \'categoriesBatch\',');
    expect(out).toContain('__cardinality: \'entity\',');
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
    expect(out).toContain('subscription: \'contelloRoutesBatch\',');
    expect(out).toContain('__cardinality: \'route\',');
    expect(out).toContain('__model: \'storeRoute\',');
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

const mutationSdl = `
  type Query {
    _empty: String
  }

  type Subscription {
    categoriesBatch: [CategoryEntity!]!
    config: ConfigEntity
    productsBatch: [ProductEntity!]!
  }

  type Mutation {
    createCategory(request: CreateCategoryRequestInput!): CategoryEntity
    updateCategory(request: UpdateCategoryRequestInput!): CategoryEntity
    deleteCategory(request: DeleteEntityByIdInput!): ContelloEntityDeleteResponse!
    createCategories(requests: [CreateCategoryRequestInput!]): [CategoryEntity!]
    updateConfig(request: UpdateConfigRequestInput!): ConfigEntity
    deleteConfig(request: DeleteEntityByIdInput!): ContelloEntityDeleteResponse!
    createProduct(request: CreateCategoryRequestInput!): SomeOther
    updateProduct(request: UpdateCategoryRequestInput!, dryRun: Boolean): ProductEntity
  }

  input CreateCategoryRequestInput { entity: CreateCategoryEntityInput! }
  input CreateCategoryEntityInput { attributes: CategoryAttributesInput! }
  input UpdateCategoryRequestInput { entity: UpdateCategoryEntityInput! }
  input UpdateCategoryEntityInput { id: ID!, attributes: CategoryAttributesInput! }
  input UpdateConfigRequestInput { entity: UpdateConfigEntityInput! }
  input UpdateConfigEntityInput { id: ID!, attributes: ConfigAttributesInput! }
  input CategoryAttributesInput { name: String }
  input ConfigAttributesInput { brandName: String }
  input DeleteEntityByIdInput { id: ID!, force: Boolean }

  type CategoryEntity { id: ID!, name: String }
  type ConfigEntity { id: ID!, brandName: String }
  type ProductEntity { id: ID!, name: String }
  type SomeOther { label: String }
  type ContelloEntityDeleteResponse { id: ID!, status: String! }

  union ContelloEntity = CategoryEntity | ConfigEntity | ProductEntity
`;

const mutationSchema = buildSchema(mutationSdl);

describe('indexEntityMutations', () => {
  test('binds create / update / delete for an entity model', () => {
    const map = indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema));

    expect(map.get('category')).toEqual({
      create: {
        field: 'createCategory',
        arguments: [{ name: 'request', type: 'CreateCategoryRequestInput!', from: 'input', envelope: 'entity' }],
        result: 'entity',
        inputType: 'CreateCategoryEntityInput',
      },
      update: {
        field: 'updateCategory',
        arguments: [{ name: 'request', type: 'UpdateCategoryRequestInput!', from: 'input', envelope: 'entity' }],
        result: 'entity',
        inputType: 'UpdateCategoryEntityInput',
      },
      delete: {
        field: 'deleteCategory',
        arguments: [{ name: 'request', type: 'DeleteEntityByIdInput!', from: 'input' }],
        result: 'idObject',
        inputType: 'DeleteEntityByIdInput',
      },
    });
  });

  test('omits create for a singleton model, which the schema exposes no createX for', () => {
    const map = indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema));
    const config = map.get('config');

    expect(config?.create).toBeUndefined();
    expect(config?.update?.field).toBe('updateConfig');
    expect(config?.delete?.field).toBe('deleteConfig');
  });

  test('skips a mutation that does not answer with the source entity type', () => {
    const map = indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema));

    expect(map.get('product')?.create).toBeUndefined();
  });

  test('skips a mutation taking more than the single request argument', () => {
    const map = indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema));

    expect(map.get('product')?.update).toBeUndefined();
  });

  test('leaves models with no mutations out of the map entirely', () => {
    const map = indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema));

    expect(map.has('product')).toBe(false);
  });

  test('returns an empty map when the schema has no Mutation type', () => {
    expect(indexEntityMutations(schema, indexEntitySources(schema)).size).toBe(0);
  });

  test('keeps the argument as-is when it is not a one-field envelope', () => {
    const flat = buildSchema(`
      type Query { _empty: String }
      type Subscription { categoriesBatch: [CategoryEntity!]! }
      type Mutation { updateCategory(request: UpdateCategoryEntityInput!): CategoryEntity }
      input UpdateCategoryEntityInput { id: ID!, name: String }
      type CategoryEntity { id: ID!, name: String }
      union ContelloEntity = CategoryEntity
    `);

    const binding = indexEntityMutations(flat, indexEntitySources(flat)).get('category')?.update;

    expect(binding?.arguments[0]?.envelope).toBeUndefined();
    expect(binding?.inputType).toBe('UpdateCategoryEntityInput');
  });
});

describe('source write emission', () => {
  const entry = (): SourceEntry => ({
    fragmentName: 'Category',
    binding: { cardinality: 'entity', fieldName: 'categoriesBatch', sourceKey: 'category' },
    fragmentExpression: 'CategoryFragmentSchema',
    mutations: indexEntityMutations(mutationSchema, indexEntitySources(mutationSchema)).get('category'),
  });

  test('carries the write input types as the fourth SourceDef argument', () => {
    expect(generateSourcesType([entry()])).toContain(
      'category: SourceDef<\'category\', \'entity\', CategoryFragment, ' +
      '{ create: CreateCategoryEntityInput; update: UpdateCategoryEntityInput; delete: DeleteEntityByIdInput }>;',
    );
  });

  test('emits the mutation bindings on the source const', () => {
    const out = generateSourcesConst([entry()]);

    expect(out).toContain('mutations: {');
    expect(out).toContain(
      'create: { field: \'createCategory\', arguments: [{ name: \'request\', ' +
      'type: \'CreateCategoryRequestInput!\', from: \'input\', envelope: \'entity\' }], result: \'entity\' },',
    );
    expect(out).toContain(
      'delete: { field: \'deleteCategory\', arguments: [{ name: \'request\', ' +
      'type: \'DeleteEntityByIdInput!\', from: \'input\' }], result: \'idObject\' },',
    );
  });

  test('omits the write argument and the mutations key for a source without mutations', () => {
    const without: SourceEntry = { ...entry(), mutations: undefined };

    expect(generateSourcesType([without])).toContain(
      'category: SourceDef<\'category\', \'entity\', CategoryFragment>;',
    );
    expect(generateSourcesConst([without])).not.toContain('mutations');
  });
});

const builtInMutationSdl = `
  type Query { _empty: String }

  type Subscription {
    contelloRoutesBatch: [ContelloRoute!]!
    contelloAssetsBatch: [ContelloAsset!]!
  }

  type Mutation {
    createContelloRoute(route: ContelloRouteInput!): ContelloRoute
    updateContelloRoute(route: ContelloRouteInput!): ContelloRoute
    deleteContelloRoute(id: String, path: String): String!
    updateContelloAsset(request: ContelloAssetUpdateInput!): ContelloAsset
    deleteContelloAsset(id: String!): ContelloAssetDeleteResponse!
  }

  input ContelloRouteInput { path: String!, targetType: String! }
  input ContelloAssetUpdateInput { id: String!, name: String }

  type ContelloRoute { id: ID!, path: String! }
  type ContelloAsset { id: ID! }
  type ContelloAssetDeleteResponse { id: ID!, status: String! }
`;

const builtInMutationSchema = buildSchema(builtInMutationSdl);

describe('indexBuiltInMutations', () => {
  const index = (schema: GraphQLSchema) => indexBuiltInMutations(schema, indexBuiltInSources(schema));

  test('binds the route mutations, taking argument types from the schema', () => {
    expect(index(builtInMutationSchema).get('route')).toEqual({
      create: {
        field: 'createContelloRoute',
        arguments: [{ name: 'route', type: 'ContelloRouteInput!', from: 'input' }],
        result: 'entity',
        inputType: 'ContelloRouteInput',
      },
      update: {
        field: 'updateContelloRoute',
        arguments: [{ name: 'route', type: 'ContelloRouteInput!', from: 'input' }],
        result: 'entity',
        inputType: 'ContelloRouteInput',
      },
      delete: {
        field: 'deleteContelloRoute',
        arguments: [{ name: 'id', type: 'String', from: 'id' }],
        result: 'idScalar',
        inputType: '{ id: string }',
      },
    });
  });

  test('binds only the id argument of a delete that also accepts a path', () => {
    const binding = index(builtInMutationSchema).get('route')?.delete;

    expect(binding?.arguments.map((argument) => argument.name)).toEqual(['id']);
  });

  test('gives assets update and delete, but no create — an asset is uploaded, not mutated into being', () => {
    const asset = index(builtInMutationSchema).get('asset');

    expect(asset?.create).toBeUndefined();
    expect(asset?.update?.field).toBe('updateContelloAsset');
    expect(asset?.delete?.result).toBe('idObject');
  });

  test('skips a binding whose field the schema does not have', () => {
    const withoutCreate = buildSchema(
      builtInMutationSdl.replace('createContelloRoute(route: ContelloRouteInput!): ContelloRoute', '_unused: String'),
    );

    expect(index(withoutCreate).get('route')?.create).toBeUndefined();
    expect(index(withoutCreate).get('route')?.update).toBeTruthy();
  });

  test('skips a binding whose result shape does not match', () => {
    // the binding expects a bare id back; a server answering with the route itself is a different contract
    const objectDelete = buildSchema(
      builtInMutationSdl.replace(
        'deleteContelloRoute(id: String, path: String): String!',
        'deleteContelloRoute(id: String, path: String): ContelloRoute!',
      ),
    );

    expect(index(objectDelete).get('route')?.delete).toBeUndefined();
    expect(index(objectDelete).get('route')?.create).toBeTruthy();
  });

  test('skips a binding whose argument was renamed', () => {
    const renamed = buildSchema(
      builtInMutationSdl.replace(
        'updateContelloAsset(request: ContelloAssetUpdateInput!): ContelloAsset',
        'updateContelloAsset(input: ContelloAssetUpdateInput!): ContelloAsset',
      ),
    );

    expect(index(renamed).get('asset')?.update).toBeUndefined();
  });

  test('skips a binding whose field grew a required argument the binding does not fill', () => {
    const extraRequired = buildSchema(
      builtInMutationSdl.replace(
        'createContelloRoute(route: ContelloRouteInput!): ContelloRoute',
        'createContelloRoute(route: ContelloRouteInput!, tenant: String!): ContelloRoute',
      ),
    );

    expect(index(extraRequired).get('route')?.create).toBeUndefined();
    expect(index(extraRequired).get('route')?.update).toBeTruthy();
  });

  test('keeps a binding whose field grew an optional or defaulted argument', () => {
    const extraOptional = buildSchema(
      builtInMutationSdl.replace(
        'createContelloRoute(route: ContelloRouteInput!): ContelloRoute',
        'createContelloRoute(route: ContelloRouteInput!, dryRun: Boolean, mode: String! = "merge"): ContelloRoute',
      ),
    );

    expect(index(extraOptional).get('route')?.create?.arguments.map((a) => a.name)).toEqual(['route']);
  });

  test('leaves out built-ins the schema does not expose as sources', () => {
    expect(index(schema).size).toBe(0);
  });
});
