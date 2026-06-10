import {
  type GraphQLEnumType,
  type GraphQLField,
  type GraphQLInputObjectType,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type GraphQLUnionType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import { DEFAULT_CUSTOM_SCALAR, SCALAR_MAP, resolveScalarType } from './scalar-types';
import { deriveModelName } from './utils';

function typeToTs(type: GraphQLType, nonNull = false): string {
  if (isNonNullType(type)) {
    return typeToTs(type.ofType, true);
  }

  if (isListType(type)) {
    const inner = typeToTs(type.ofType);
    const wrapped = inner.includes(' | ') ? `(${inner})` : inner;

    return nonNull ? `${wrapped}[]` : `${wrapped}[] | undefined`;
  }

  const name = isScalarType(type) ? resolveScalarType(type.name) : type.name;

  return nonNull ? name : `${name} | undefined`;
}

function inputTypeToTs(type: GraphQLType, nonNull = false): string {
  return typeToTs(type, nonNull);
}

function generateEnum(type: GraphQLEnumType): string {
  const values = type
    .getValues()
    .map((v) => `'${v.value}'`)
    .toSorted()
    .join(' | ');

  return `export type ${type.name} = ${values};`;
}

function sortedFields(type: GraphQLObjectType | GraphQLInputObjectType) {
  return Object.values(type.getFields()).toSorted((a, b) => a.name.localeCompare(b.name));
}

function generateObjectType(type: GraphQLObjectType, modelNames: Map<string, string>): string {
  const fields = sortedFields(type);
  const lines: string[] = [];
  const model = modelNames.get(type.name);

  lines.push(`export type ${type.name} = {`, `  __typename?: '${type.name}' | undefined;`);

  if (model) {
    lines.push(`  __model?: '${model}' | undefined;`);
  }

  for (const field of fields) {
    lines.push(`  ${field.name}${isNonNullType(field.type) ? '' : '?'}: ${typeToTs(field.type)};`);
  }

  lines.push('};');

  return lines.join('\n');
}

function generateInputType(type: GraphQLInputObjectType): string {
  const fields = sortedFields(type);
  const lines: string[] = [`export type ${type.name} = {`];

  for (const field of fields) {
    lines.push(`  ${field.name}${isNonNullType(field.type) ? '' : '?'}: ${inputTypeToTs(field.type)};`);
  }

  lines.push('};');

  return lines.join('\n');
}

function generateUnion(type: GraphQLUnionType): string {
  const members = type
    .getTypes()
    .map((t) => t.name)
    .toSorted();

  return `export type ${type.name} = ${members.join(' | ')};`;
}

function isInternalType(name: string): boolean {
  return name.startsWith('__');
}

export function generateSchemaTypes(schema: GraphQLSchema): string {
  const typeMap = schema.getTypeMap();
  const lines: string[] = [];

  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

  // scalars (as a reference type)
  const customScalars = Object.values(typeMap)
    .filter((t) => isScalarType(t) && !isInternalType(t.name) && !SCALAR_MAP[t.name])
    .toSorted(byName);

  if (customScalars.length > 0) {
    for (const scalar of customScalars) {
      lines.push(`export type ${scalar.name} = ${DEFAULT_CUSTOM_SCALAR};`);
    }

    lines.push('');
  }

  // enums
  const enums = Object.values(typeMap)
    .filter((t): t is GraphQLEnumType => isEnumType(t) && !isInternalType(t.name))
    .toSorted(byName);

  for (const e of enums) {
    lines.push(generateEnum(e));
  }

  if (enums.length > 0) {
    lines.push('');
  }

  // input types
  const inputs = Object.values(typeMap)
    .filter((t): t is GraphQLInputObjectType => isInputObjectType(t) && !isInternalType(t.name))
    .toSorted(byName);

  for (const input of inputs) {
    lines.push(generateInputType(input), '');
  }

  // build model name map from ContelloEntity and ContelloComponent unions
  const modelNames = new Map<string, string>();
  const entityModelNames = new Map<string, string>();

  for (const unionName of ['ContelloEntity', 'ContelloComponent']) {
    const union = typeMap[unionName];

    if (union && isUnionType(union)) {
      for (const member of union.getTypes()) {
        const model = deriveModelName(member.name);

        if (model) {
          modelNames.set(member.name, model);

          if (unionName === 'ContelloEntity') {
            entityModelNames.set(member.name, model);
          }
        }
      }
    }
  }

  // object types
  const objects = Object.values(typeMap)
    .filter((t): t is GraphQLObjectType => isObjectType(t) && !isInternalType(t.name))
    .toSorted(byName);

  for (const obj of objects) {
    lines.push(generateObjectType(obj, modelNames), '');
  }

  // interfaces (generate as object types)
  const interfaces = Object.values(typeMap)
    .filter((t): t is GraphQLObjectType => isInterfaceType(t) && !isInternalType(t.name))
    .toSorted(byName);

  for (const iface of interfaces) {
    const fields = Object.values((iface as any).getFields() as Record<string, GraphQLField<any, any>>).toSorted(
      (a, b) => a.name.localeCompare(b.name),
    );
    const fieldLines: string[] = [`export type ${iface.name} = {`, `  __typename?: string | undefined;`];

    for (const field of fields) {
      fieldLines.push(`  ${field.name}${isNonNullType(field.type) ? '' : '?'}: ${typeToTs(field.type)};`);
    }

    fieldLines.push('};');
    lines.push(fieldLines.join('\n'), '');
  }

  // unions
  const unions = Object.values(typeMap)
    .filter((t): t is GraphQLUnionType => isUnionType(t) && !isInternalType(t.name))
    .toSorted(byName);

  for (const union of unions) {
    lines.push(generateUnion(union));
  }

  if (unions.length > 0) {
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Returns the model-reference-name → typename map for entities in `ContelloEntity`.
 * Used by the schema bundle assembly to emit `models: { category: 'CategoryEntity', ... }`.
 */
export function extractEntityModels(schema: GraphQLSchema): Map<string, string> {
  const map = new Map<string, string>();
  const union = schema.getTypeMap()['ContelloEntity'];

  if (!union || !isUnionType(union)) {
    return map;
  }

  for (const member of union.getTypes()) {
    const model = deriveModelName(member.name);

    if (model) {
      map.set(model, member.name);
    }
  }

  return map;
}
