import {
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  isListType,
  isNonNullType,
  isObjectType,
} from 'graphql';

import { deriveModelName, isContelloModel } from './utils';

export type EntitySourceBinding = {
  cardinality: 'collection' | 'singleton';
  /** subscription field name — `categoriesBatch` for collections, `config` for singletons */
  fieldName: string;
  /** model reference name — `category`, `config` */
  model: string;
};

/**
 * Walks Subscription fields once and indexes, for each contello-entity type, the
 * subscription that feeds the store (a `[Entity!]!` field → collection; a non-list
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
      result.set(entityType.name, { cardinality: 'collection', fieldName: field.name, model });
    } else if (!singletonCandidates.has(entityType.name)) {
      singletonCandidates.set(entityType.name, { fieldName: field.name });
    }
  }

  for (const [typeName, { fieldName }] of singletonCandidates) {
    // collection wins over any singleton-shaped lookup field (e.g. `categories(id: ID)`)
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

export function generateSourcesObject(
  entries: { fragmentName: string; binding: EntitySourceBinding; fragmentExpression: string }[],
): string {
  if (entries.length === 0) {
    return '';
  }

  // each Contello model gets exactly one source — multiple fragments on the same entity collide
  const byModel = new Map<string, { fragmentName: string; binding: EntitySourceBinding; fragmentExpression: string }>();

  for (const entry of entries) {
    const existing = byModel.get(entry.binding.model);

    if (existing) {
      throw new Error(
        `multiple fragments target the same Contello model "${entry.binding.model}": ` +
          `"${existing.fragmentName}" and "${entry.fragmentName}". A model can have at most one source — ` +
          `merge the fragments or use the raw client for the alternative shape.`,
      );
    }

    byModel.set(entry.binding.model, entry);
  }

  const sorted = [...byModel.values()].sort((a, b) => a.binding.model.localeCompare(b.binding.model));
  const lines: string[] = [];

  lines.push('export type Sources = {');

  for (const { fragmentName, binding } of sorted) {
    const type = `SourceDef<'${binding.model}', '${binding.cardinality}', ${fragmentName}Fragment>`;

    lines.push(`  ${binding.model}: ${type};`);
  }

  lines.push('};');
  lines.push('');
  lines.push('export const sources: Sources = {');

  for (const { fragmentName, binding, fragmentExpression } of sorted) {
    lines.push(`  ${binding.model}: {`);
    lines.push(`    document: ${fragmentExpression},`);
    lines.push(`    fragment: '${fragmentName}',`);
    lines.push(`    subscription: '${binding.fieldName}',`);
    lines.push(`    __model: '${binding.model}',`);
    lines.push(`    __cardinality: '${binding.cardinality}',`);
    lines.push(`  },`);
  }

  lines.push('};');

  return lines.join('\n');
}
