import {
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLSchema,
  type GraphQLType,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  isCompositeType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  typeFromAST,
} from 'graphql';

import { resolveScalarType } from './scalar-types';
import { deriveModelName, isContelloModel, pascalCase } from './utils';

function unwrapType(type: GraphQLType): { namedType: GraphQLType; isList: boolean; isNonNull: boolean } {
  let isList = false;
  let isNonNull = false;
  let current = type;

  if (isNonNullType(current)) {
    isNonNull = true;
    current = current.ofType;
  }

  if (isListType(current)) {
    isList = true;
    current = current.ofType;

    if (isNonNullType(current)) {
      current = current.ofType;
    }
  }

  return { namedType: current, isList, isNonNull };
}

type SelectionSetResult = {
  fields: string[];
  inlineUnions: string[];
  hasTypenameField: boolean;
};

function resolveSelectionSet(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentType: GraphQLCompositeType,
  fragments: Map<string, FragmentDefinitionNode>,
  indent: string,
  visited: Set<string>,
): SelectionSetResult {
  const fields: string[] = [];
  const inlineUnions: string[] = [];
  let hasTypenameField = false;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.alias?.value ?? selection.name.value;

      if (selection.name.value === '__typename') {
        hasTypenameField = true;

        continue;
      }

      const schemaField =
        isObjectType(parentType) || isInterfaceType(parentType)
          ? parentType.getFields()[selection.name.value]
          : undefined;

      if (!schemaField) {
        throw new Error(`field "${selection.name.value}" does not exist on type "${parentType.name}"`);
      }

      const { namedType, isList, isNonNull } = unwrapType(schemaField.type);

      let tsType: string;

      if (selection.selectionSet && isCompositeType(namedType)) {
        tsType = resolveSelectionSetType(schema, selection.selectionSet, namedType, fragments, `${indent}  `, visited);
      } else if (isScalarType(namedType)) {
        tsType = resolveScalarType(namedType.name);
      } else if (isEnumType(namedType)) {
        tsType = namedType.name;
      } else {
        tsType = namedType.toString();
      }

      if (isList) {
        const wrapped = tsType.includes(' | ') ? `(${tsType})` : tsType;

        tsType = `${wrapped}[]`;
      }

      if (isNonNull) {
        fields.push(`${indent}  ${fieldName}: ${tsType};`);
      } else {
        fields.push(`${indent}  ${fieldName}?: ${tsType} | undefined;`);
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      if (selection.typeCondition && selection.selectionSet) {
        const typeName = selection.typeCondition.name.value;
        const conditionalType = schema.getType(typeName);

        if (!conditionalType) {
          throw new Error(`unknown type "${typeName}" in inline fragment`);
        }

        if (isCompositeType(conditionalType)) {
          if (isInterfaceType(conditionalType)) {
            // interface spreads merge fields into the base (not a discriminated branch)
            const inner = resolveSelectionSet(
              schema,
              selection.selectionSet,
              conditionalType,
              fragments,
              indent,
              visited,
            );

            fields.push(...inner.fields);
          } else if (isObjectType(conditionalType)) {
            // inject __typename discriminant for proper narrowing
            const nested = resolveSelectionSetType(
              schema,
              selection.selectionSet,
              conditionalType,
              fragments,
              indent,
              visited,
            );

            if (nested.startsWith('{')) {
              const model = isContelloModel(schema, conditionalType.name)
                ? deriveModelName(conditionalType.name)
                : undefined;
              const discriminant = model
                ? `${indent}  __typename: '${conditionalType.name}';\n${indent}  __model: '${model}';`
                : `${indent}  __typename: '${conditionalType.name}';`;

              inlineUnions.push(`{\n${discriminant}\n${nested.slice(2)}`);
            } else {
              inlineUnions.push(nested);
            }
          } else {
            const nested = resolveSelectionSetType(
              schema,
              selection.selectionSet,
              conditionalType,
              fragments,
              indent,
              visited,
            );

            inlineUnions.push(nested);
          }
        }
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;

      if (visited.has(fragmentName)) {
        // cycle detected — reference the fragment type by name instead of expanding inline
        inlineUnions.push(`${fragmentName}Fragment`);

        continue;
      }

      const fragment = fragments.get(fragmentName);

      if (fragment?.selectionSet) {
        const fragmentType = schema.getType(fragment.typeCondition.name.value);

        if (fragmentType && isCompositeType(fragmentType)) {
          const nextVisited = new Set(visited);

          nextVisited.add(fragmentName);

          const fragmentResult = resolveSelectionSet(
            schema,
            fragment.selectionSet,
            fragmentType,
            fragments,
            indent,
            nextVisited,
          );

          fields.push(...fragmentResult.fields);
          inlineUnions.push(...fragmentResult.inlineUnions);

          if (fragmentResult.hasTypenameField) {
            hasTypenameField = true;
          }
        }
      }
    }
  }

  return { fields, inlineUnions, hasTypenameField };
}

function resolveSelectionSetType(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentType: GraphQLCompositeType,
  fragments: Map<string, FragmentDefinitionNode>,
  indent: string,
  visited: Set<string> = new Set(),
): string {
  const { fields, inlineUnions, hasTypenameField } = resolveSelectionSet(
    schema,
    selectionSet,
    parentType,
    fragments,
    indent,
    visited,
  );

  // add __typename to base fields only when there are no inline union branches
  // (inline branches carry their own __typename discriminants)
  if (hasTypenameField && inlineUnions.length === 0) {
    const typenameField = isObjectType(parentType)
      ? `${indent}  __typename: '${parentType.name}';`
      : `${indent}  __typename: string;`;

    fields.unshift(typenameField);
  }

  if (inlineUnions.length > 0 && fields.length === 0) {
    return inlineUnions.join(' | ');
  }

  const baseType = fields.length > 0 ? `{\n${fields.join('\n')}\n${indent}}` : '{}';

  if (inlineUnions.length > 0) {
    return `${baseType} & (${inlineUnions.join(' | ')})`;
  }

  return baseType;
}

function generateVariablesType(schema: GraphQLSchema, operation: OperationDefinitionNode): string {
  const vars = operation.variableDefinitions ?? [];

  if (vars.length === 0) {
    return 'Record<string, never>';
  }

  const fields: string[] = [];

  for (const v of vars) {
    const varType = typeFromAST(schema, v.type as any);

    if (!varType) {
      throw new Error(`cannot resolve type for variable "$${v.variable.name.value}"`);
    }

    const isRequired = isNonNullType(varType) && !v.defaultValue;
    const tsType = graphqlTypeToTs(varType);

    if (isRequired) {
      fields.push(`  ${v.variable.name.value}: ${tsType};`);
    } else {
      fields.push(`  ${v.variable.name.value}?: ${tsType} | undefined;`);
    }
  }

  return `{\n${fields.join('\n')}\n}`;
}

function graphqlTypeToTs(type: GraphQLType): string {
  if (isNonNullType(type)) {
    return graphqlTypeToTs(type.ofType);
  }

  if (isListType(type)) {
    return `${graphqlTypeToTs(type.ofType)}[]`;
  }

  if (isScalarType(type)) {
    return resolveScalarType(type.name);
  }

  if (isEnumType(type)) {
    return type.name;
  }

  return type.name;
}

export function generateFragmentTypes(schema: GraphQLSchema, fragments: Map<string, FragmentDefinitionNode>): string {
  const lines: string[] = [];

  for (const [name, fragment] of fragments) {
    const typeName = `${name}Fragment`;
    const parentType = schema.getType(fragment.typeCondition.name.value);

    if (parentType && isCompositeType(parentType)) {
      const resultType = resolveSelectionSetType(schema, fragment.selectionSet, parentType, fragments, '');

      lines.push(`export type ${typeName} = ${resultType};`);
    } else {
      lines.push(`export type ${typeName} = {};`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function generateOperationTypes(
  schema: GraphQLSchema,
  operations: OperationDefinitionNode[],
  fragments: Map<string, FragmentDefinitionNode>,
): string {
  const lines: string[] = [];

  for (const op of operations) {
    const name = op.name!.value;
    const typeSuffix = pascalCase(op.operation);
    const resultTypeName = `${name}${typeSuffix}`;
    const variablesTypeName = `${resultTypeName}Variables`;

    // result type
    const rootType =
      op.operation === 'query'
        ? schema.getQueryType()
        : op.operation === 'mutation'
          ? schema.getMutationType()
          : schema.getSubscriptionType();

    if (rootType && op.selectionSet) {
      const resultType = resolveSelectionSetType(schema, op.selectionSet, rootType, fragments, '');

      lines.push(`export type ${resultTypeName} = ${resultType};`);
    } else {
      lines.push(`export type ${resultTypeName} = {};`);
    }

    lines.push('');

    // variables type
    const variablesType = generateVariablesType(schema, op);

    lines.push(`export type ${variablesTypeName} = ${variablesType};`);
    lines.push('');
  }

  return lines.join('\n');
}
