import {
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';

import { deriveModelName, isContelloModel } from './utils';

export type BuiltInCardinality = 'route' | 'asset' | 'i18nMessage';
export type SourceCardinality = 'entity' | 'singleton' | BuiltInCardinality;

export type EntitySourceBinding = {
  cardinality: 'entity' | 'singleton';
  /** subscription field name — `categoriesBatch` for entity-collections, `config` for singletons */
  fieldName: string;
  /** model reference name — `category`, `config` */
  model: string;
};

export type SourceBinding = {
  cardinality: SourceCardinality;
  /** subscription field name */
  fieldName: string;
  /** key used in the `Sources` type — model name for entity/singleton, the cardinality literal for built-ins */
  sourceKey: string;
};

/** Built-in (non-entity) types that are source-able through dedicated Subscription fields. */
const BUILT_IN_SOURCES: { typeName: string; cardinality: BuiltInCardinality; fieldName: string }[] = [
  { typeName: 'ContelloRoute', cardinality: 'route', fieldName: 'contelloRoutesBatch' },
  { typeName: 'ContelloAsset', cardinality: 'asset', fieldName: 'contelloAssetsBatch' },
  { typeName: 'ContelloI18nMessage', cardinality: 'i18nMessage', fieldName: 'contelloI18nMessagesBatch' },
];

/**
 * Walks Subscription fields once and indexes, for each contello-entity type, the
 * subscription that feeds the store (a `[Entity!]!` field → entity-collection; a non-list
 * `Entity` field → singleton). Types without a matching Subscription field don't
 * appear in the map and stay non-source-able.
 */
export function indexEntitySources(schema: GraphQLSchema): Map<string, EntitySourceBinding> {
  const result = new Map<string, EntitySourceBinding>();
  const subscription = schema.getSubscriptionType();

  if (!subscription) {
    return result;
  }

  const singletonCandidates = new Map<string, { fieldName: string }>();

  for (const field of Object.values(subscription.getFields())) {
    const { entityType, isList } = unwrapEntity(field.type);

    if (!entityType || !isContelloModel(schema, entityType.name)) {
      continue;
    }

    const model = deriveModelName(entityType.name);

    if (!model) {
      continue;
    }

    if (isList) {
      result.set(entityType.name, { cardinality: 'entity', fieldName: field.name, model });
    } else if (!singletonCandidates.has(entityType.name)) {
      singletonCandidates.set(entityType.name, { fieldName: field.name });
    }
  }

  for (const [typeName, { fieldName }] of singletonCandidates) {
    // entity-collection wins over any singleton-shaped lookup field (e.g. `categories(id: ID)`)
    if (result.has(typeName)) {
      continue;
    }

    const model = deriveModelName(typeName);

    if (!model) {
      continue;
    }

    result.set(typeName, { cardinality: 'singleton', fieldName, model });
  }

  return result;
}

/**
 * Indexes the built-in (route/asset/i18nMessage) types that the schema actually exposes
 * as batch subscriptions. A type is included only when both the GraphQL type and the
 * matching subscription field are present.
 */
export function indexBuiltInSources(
  schema: GraphQLSchema,
): Map<string, { cardinality: BuiltInCardinality; fieldName: string }> {
  const result = new Map<string, { cardinality: BuiltInCardinality; fieldName: string }>();
  const subscription = schema.getSubscriptionType();

  if (!subscription) {
    return result;
  }

  const fields = subscription.getFields();

  for (const builtIn of BUILT_IN_SOURCES) {
    if (!schema.getType(builtIn.typeName) || !fields[builtIn.fieldName]) {
      continue;
    }

    result.set(builtIn.typeName, {
      cardinality: builtIn.cardinality,
      fieldName: builtIn.fieldName,
    });
  }

  return result;
}

function unwrapEntity(type: GraphQLType): { entityType: GraphQLObjectType | undefined; isList: boolean } {
  let current = type;
  let isList = false;

  if (isNonNullType(current)) {
    current = current.ofType;
  }

  if (isListType(current)) {
    isList = true;
    current = current.ofType;

    if (isNonNullType(current)) {
      current = current.ofType;
    }
  }

  return {
    entityType: isObjectType(current) ? current : undefined,
    isList,
  };
}

export type SourceEntry = {
  fragmentName: string;
  binding: SourceBinding;
  fragmentExpression: string;
};

/**
 * Dedupe + sort entries by source key. Throws on duplicates.
 */
function organize(entries: SourceEntry[]): SourceEntry[] {
  const byKey = new Map<string, SourceEntry>();

  for (const entry of entries) {
    const existing = byKey.get(entry.binding.sourceKey);

    if (existing) {
      throw new Error(
        `multiple fragments target the same source key "${entry.binding.sourceKey}": ` +
        `"${existing.fragmentName}" and "${entry.fragmentName}". A source key can have at most one fragment — ` +
        `merge the fragments or use the raw client for the alternative shape.`,
      );
    }

    byKey.set(entry.binding.sourceKey, entry);
  }

  return [...byKey.values()].toSorted((a, b) => a.binding.sourceKey.localeCompare(b.binding.sourceKey));
}

/** Emits `export type Sources = { ... }`. */
export function generateSourcesType(entries: SourceEntry[]): string {
  const sorted = organize(entries);

  if (sorted.length === 0) {
    return '';
  }

  const lines: string[] = ['export type Sources = {'];

  for (const { fragmentName, binding } of sorted) {
    const type = `SourceDef<'${binding.sourceKey}', '${binding.cardinality}', ${fragmentName}Fragment>`;

    lines.push(`  ${binding.sourceKey}: ${type};`);
  }

  lines.push('};');

  return lines.join('\n');
}

/** Emits `const sources: Sources = { ... }` for inclusion in the schema bundle. */
export function generateSourcesConst(entries: SourceEntry[]): string {
  const sorted = organize(entries);

  if (sorted.length === 0) {
    return '';
  }

  const lines: string[] = ['const sources: Sources = {'];

  for (const { fragmentName, binding, fragmentExpression } of sorted) {
    lines.push(`  ${binding.sourceKey}: {`, `    document: ${fragmentExpression},`, `    fragment: '${fragmentName}',`, `    subscription: '${binding.fieldName}',`, `    __model: '${binding.sourceKey}',`, `    __cardinality: '${binding.cardinality}',`, `  },`);
  }

  lines.push('};');

  return lines.join('\n');
}
