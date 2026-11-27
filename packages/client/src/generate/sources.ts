import {
  type GraphQLInputObjectType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isRequiredArgument,
  isScalarType,
} from 'graphql';

import { BUILT_IN_MUTATIONS } from '../built-in-mutations';
import type { SourceMutationArgument, SourceMutationBinding, SourceMutations } from '../types';
import { deriveModelName, isContelloModel, pascalCase } from './utils';

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
    if (!schema.getType(builtIn.typeName) || !Object.hasOwn(fields, builtIn.fieldName)) {
      continue;
    }

    result.set(builtIn.typeName, {
      cardinality: builtIn.cardinality,
      fieldName: builtIn.fieldName,
    });
  }

  return result;
}

export type MutationKind = 'create' | 'update' | 'delete' | 'createMany' | 'updateMany' | 'deleteMany';

/** A runtime binding plus the TS type the generated accessor takes for it. */
export type MutationBinding = SourceMutationBinding & {
  /** TS type expression the accessor takes — the inner type when enveloped */
  inputType: string;
};

export type MutationBindings = Partial<Record<MutationKind, MutationBinding>>;

const SINGLE_KINDS = ['create', 'update', 'delete'] as const;
const MUTATION_KINDS: MutationKind[] = [...SINGLE_KINDS, 'createMany', 'updateMany', 'deleteMany'];

/**
 * A create/update mutation answers with the entity itself; a delete answers with a response
 * object. Both are only ever selected down to `id`, so the requirement is structural: the
 * return type must be an object type carrying an `id` field, and for create/update it must be
 * the entity type the source is bound to.
 */
function returnsEntityId(type: GraphQLType, entityTypeName: string | undefined): boolean {
  const { entityType, isList } = unwrapEntity(type);

  if (!entityType || isList) {
    return false;
  }

  if (entityTypeName !== undefined && entityType.name !== entityTypeName) {
    return false;
  }

  return Object.hasOwn(entityType.getFields(), 'id');
}

/**
 * Unwraps a one-field envelope argument (`CreateCategoryRequestInput { entity: ... }`) so the
 * accessor takes the entity input directly. Only a single non-null input-object field is
 * unwrapped — anything else (lists, scalars, several fields) is passed through as-is.
 */
function resolveArgumentInput(type: GraphQLInputObjectType): { envelope: string | undefined; inputTypeName: string } {
  const fields = Object.values(type.getFields());
  const only = fields.length === 1 ? fields[0] : undefined;

  if (only && isNonNullType(only.type) && isInputObjectType(only.type.ofType)) {
    return { envelope: only.name, inputTypeName: only.type.ofType.name };
  }

  return { envelope: undefined, inputTypeName: type.name };
}

const BATCH_SUFFIX = 'Batch';

/** The named type of a `[T!]` or `[T!]!`, and nothing for a type that is no list. */
function unwrapList(type: GraphQLType): GraphQLType | undefined {
  const list = isNonNullType(type) ? type.ofType : type;

  if (!isListType(list)) {
    return undefined;
  }

  return isNonNullType(list.ofType) ? list.ofType.ofType : list.ofType;
}

function returnsEntityIdList(type: GraphQLType, entityTypeName: string | undefined): boolean {
  const item = unwrapList(type);

  return item !== undefined && returnsEntityId(item, entityTypeName);
}

/**
 * The batch mutations of a model, which write a list in one call. The server names them after the
 * plural of the model, the name its batch subscription carries too, so that is where the plural
 * is read from. Each one is taken only when its shape is the list form of the single mutation:
 * a create/update takes a list of the very request type the single one takes and answers with a
 * list of the entity, a delete takes one request object with `ids`.
 */
function indexBatchMutationsForModel(
  mutationType: GraphQLObjectType,
  subscriptionField: string,
  entityTypeName: string,
  single: MutationBindings,
): MutationBindings {
  const result: MutationBindings = {};

  if (!subscriptionField.endsWith(BATCH_SUFFIX)) {
    return result;
  }

  const fields = mutationType.getFields();
  const plural = pascalCase(subscriptionField.slice(0, -BATCH_SUFFIX.length));

  for (const kind of ['create', 'update'] as const) {
    const field = fields[`${kind}${plural}`];
    const one = single[kind];
    const argument = field?.args.length === 1 ? field.args[0] : undefined;
    const item = argument ? unwrapList(argument.type) : undefined;

    if (!field || !one || !argument || !item || !returnsEntityIdList(field.type, entityTypeName)) {
      continue;
    }

    // the same request type as the single mutation: the same input, the same envelope
    if (item.toString() !== one.arguments[0]?.type.replace(/!$/, '')) {
      continue;
    }

    result[`${kind}Many`] = {
      field: field.name,
      arguments: [
        {
          name: argument.name,
          type: argument.type.toString(),
          from: 'input',
          each: true,
          ...(one.arguments[0]?.envelope !== undefined && { envelope: one.arguments[0].envelope }),
        },
      ],
      result: 'entity',
      inputType: one.inputType,
    };
  }

  const removal = fields[`delete${plural}`];
  const removalArgument = removal?.args.length === 1 ? removal.args[0] : undefined;
  const removalInput =
    removalArgument && isNonNullType(removalArgument.type) ? removalArgument.type.ofType : removalArgument?.type;

  if (
    removal &&
    removalArgument &&
    isInputObjectType(removalInput) &&
    Object.hasOwn(removalInput.getFields(), 'ids') &&
    returnsEntityIdList(removal.type, undefined)
  ) {
    result.deleteMany = {
      field: removal.name,
      arguments: [{ name: removalArgument.name, type: removalArgument.type.toString(), from: 'input' }],
      result: 'idObject',
      inputType: removalInput.name,
    };
  }

  return result;
}

function indexMutationsForModel(
  mutationType: GraphQLObjectType,
  model: string,
  entityTypeName: string,
): MutationBindings {
  const fields = mutationType.getFields();
  const result: MutationBindings = {};

  for (const kind of SINGLE_KINDS) {
    // the server derives these names the same way — `create` + the capitalized model reference name
    const field = fields[`${kind}${pascalCase(model)}`];

    if (!field || field.args.length !== 1) {
      continue;
    }

    // a delete answers with a delete-response object, not with the entity
    if (!returnsEntityId(field.type, kind === 'delete' ? undefined : entityTypeName)) {
      continue;
    }

    const argument = field.args[0]!;
    const argumentNamedType = isNonNullType(argument.type) ? argument.type.ofType : argument.type;

    if (!isInputObjectType(argumentNamedType)) {
      continue;
    }

    const { envelope, inputTypeName } = resolveArgumentInput(argumentNamedType);

    result[kind] = {
      field: field.name,
      arguments: [
        {
          name: argument.name,
          type: argument.type.toString(),
          from: 'input',
          ...(envelope !== undefined && { envelope }),
        },
      ],
      result: kind === 'delete' ? 'idObject' : 'entity',
      inputType: inputTypeName,
    };
  }

  return result;
}

/**
 * TS input types for the built-in write bindings. Route and asset inputs are fixed schema types;
 * a delete is addressed by id alone, so its input type is spelled out rather than named.
 */
const BUILT_IN_INPUT_TYPES: Partial<Record<BuiltInCardinality, Partial<Record<MutationKind, string>>>> = {
  route: { create: 'ContelloRouteInput', update: 'ContelloRouteInput', delete: '{ id: string }' },
  asset: { update: 'ContelloAssetUpdateInput', delete: '{ id: string }' },
};

/**
 * Checks one built-in binding against the introspected schema: the field must exist, carry every
 * bound argument, leave no required argument unbound, and answer with the shape the binding
 * declares. A server that renamed, dropped or added to any of it yields no binding at all rather
 * than a document that fails at request time.
 */
function verifyBuiltInMutation(
  mutationType: GraphQLObjectType,
  binding: SourceMutationBinding,
  typeName: string,
): SourceMutationBinding | undefined {
  const field = mutationType.getFields()[binding.field];

  if (!field) {
    return undefined;
  }

  const args = binding.arguments.map((argument) => {
    const schemaArgument = field.args.find((a) => a.name === argument.name);

    return schemaArgument ? { ...argument, type: schemaArgument.type.toString() } : undefined;
  });

  if (args.includes(undefined)) {
    return undefined;
  }

  const bound = new Set(binding.arguments.map((argument) => argument.name));

  if (field.args.some((argument) => !bound.has(argument.name) && isRequiredArgument(argument))) {
    return undefined;
  }

  const answersWithEntity = returnsEntityId(field.type, typeName);
  const matches =
    binding.result === 'entity'
      ? answersWithEntity
      : (binding.result === 'idObject' ? returnsEntityId(field.type, undefined) : isScalarResult(field.type));

  if (!matches) {
    return undefined;
  }

  return { ...binding, arguments: args as SourceMutationArgument[] };
}

function isScalarResult(type: GraphQLType): boolean {
  return isScalarType(isNonNullType(type) ? type.ofType : type);
}

function verifyBuiltInMutations(
  mutationType: GraphQLObjectType,
  typeName: string,
  declared: SourceMutations,
  inputTypes: Partial<Record<MutationKind, string>>,
): MutationBindings {
  const bindings: MutationBindings = {};

  for (const kind of MUTATION_KINDS) {
    const binding = declared[kind];
    const inputType = inputTypes[kind];
    const verified = binding && inputType ? verifyBuiltInMutation(mutationType, binding, typeName) : undefined;

    if (verified && inputType) {
      bindings[kind] = { ...verified, inputType };
    }
  }

  return bindings;
}

/**
 * Indexes the write mutations of the built-in sources the schema actually exposes, keyed by
 * cardinality. Bindings are fixed (their field names are part of every Contello schema) but each
 * one is verified before it is emitted.
 */
export function indexBuiltInMutations(
  schema: GraphQLSchema,
  builtInBindings: Map<string, { cardinality: BuiltInCardinality; fieldName: string }>,
): Map<BuiltInCardinality, MutationBindings> {
  const result = new Map<BuiltInCardinality, MutationBindings>();
  const mutationType = schema.getMutationType();

  if (!mutationType) {
    return result;
  }

  for (const [typeName, { cardinality }] of builtInBindings) {
    const declared = BUILT_IN_MUTATIONS[cardinality];
    const inputTypes = BUILT_IN_INPUT_TYPES[cardinality];

    if (!declared || !inputTypes) {
      continue;
    }

    const bindings = verifyBuiltInMutations(mutationType, typeName, declared, inputTypes);

    if (Object.keys(bindings).length > 0) {
      result.set(cardinality, bindings);
    }
  }

  return result;
}

/**
 * Indexes the write mutations each entity source can bind to, keyed by model reference name.
 * A model with no mutations at all is left out of the map; a model missing one kind gets the
 * others — singletons, for one, have no `create`.
 */
export function indexEntityMutations(
  schema: GraphQLSchema,
  entityBindings: Map<string, EntitySourceBinding>,
): Map<string, MutationBindings> {
  const result = new Map<string, MutationBindings>();
  const mutationType = schema.getMutationType();

  if (!mutationType) {
    return result;
  }

  for (const [entityTypeName, binding] of entityBindings) {
    const single = indexMutationsForModel(mutationType, binding.model, entityTypeName);
    const batch =
      binding.cardinality === 'entity'
        ? indexBatchMutationsForModel(mutationType, binding.fieldName, entityTypeName, single)
        : {};
    const bindings = { ...single, ...batch };

    if (Object.keys(bindings).length > 0) {
      result.set(binding.model, bindings);
    }
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
  mutations?: MutationBindings | undefined;
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

  return byKey.values().toArray().toSorted((a, b) => a.binding.sourceKey.localeCompare(b.binding.sourceKey));
}

/** Emits `export type Sources = { ... }`. */
export function generateSourcesType(entries: SourceEntry[]): string {
  const sorted = organize(entries);

  if (sorted.length === 0) {
    return '';
  }

  const lines: string[] = ['export type Sources = {'];

  for (const { fragmentName, binding, mutations } of sorted) {
    const writes = generateWritesType(mutations);
    const args = [`'${binding.sourceKey}'`, `'${binding.cardinality}'`, `${fragmentName}Fragment`];

    if (writes) {
      args.push(writes);
    }

    lines.push(`  ${binding.sourceKey}: SourceDef<${args.join(', ')}>;`);
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

  for (const { fragmentName, binding, fragmentExpression, mutations } of sorted) {
    lines.push(`  ${binding.sourceKey}: {`, `    document: ${fragmentExpression},`, `    fragment: '${fragmentName}',`, `    subscription: '${binding.fieldName}',`);

    for (const line of generateMutationsConst(mutations)) {
      lines.push(line);
    }

    lines.push(`    __model: '${binding.sourceKey}',`, `    __cardinality: '${binding.cardinality}',`, `  },`);
  }

  lines.push('};');

  return lines.join('\n');
}

/** The phantom write shape — `{ create: CreateCategoryEntityInput; ... }`, omitted when there are no mutations. */
function generateWritesType(mutations: MutationBindings | undefined): string | undefined {
  const entries = mutationEntries(mutations);

  if (entries.length === 0) {
    return undefined;
  }

  return `{ ${entries.map(([kind, binding]) => `${kind}: ${binding.inputType}`).join('; ')} }`;
}

/** The runtime `mutations` object of a source const. */
function generateMutationsConst(mutations: MutationBindings | undefined): string[] {
  const entries = mutationEntries(mutations);

  if (entries.length === 0) {
    return [];
  }

  const lines = ['    mutations: {'];

  for (const [kind, binding] of entries) {
    const args = binding.arguments
      .map((argument) => {
        const parts = [`name: '${argument.name}'`, `type: '${argument.type}'`, `from: '${argument.from}'`];

        if (argument.envelope) {
          parts.push(`envelope: '${argument.envelope}'`);
        }

        if (argument.each === true) {
          parts.push('each: true');
        }

        return `{ ${parts.join(', ')} }`;
      })
      .join(', ');

    lines.push(
      `      ${kind}: { field: '${binding.field}', arguments: [${args}], result: '${binding.result}' },`,
    );
  }

  lines.push('    },');

  return lines;
}

function mutationEntries(mutations: MutationBindings | undefined): [MutationKind, MutationBinding][] {
  return MUTATION_KINDS.flatMap((kind) => {
    const binding = mutations?.[kind];

    return binding ? [[kind, binding] as [MutationKind, MutationBinding]] : [];
  });
}
