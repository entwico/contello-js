import {
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLSchema,
  type GraphQLType,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  doTypesOverlap as checkTypesOverlap,
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
  fragmentRefs: string[];
  hasTypenameField: boolean;
};

function resolveSelectionSet(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentType: GraphQLCompositeType,
  fragments: Map<string, FragmentDefinitionNode>,
  indent: string,
): SelectionSetResult {
  const fields: string[] = [];
  const inlineUnions: string[] = [];
  const fragmentRefs: string[] = [];
  let hasTypenameField = false;

  for (const selection of selectionSet.selections) {
    const contribution = resolveSelection(schema, selection, parentType, fragments, indent);

    fields.push(...contribution.fields);
    inlineUnions.push(...contribution.inlineUnions);
    fragmentRefs.push(...contribution.fragmentRefs);

    if (contribution.hasTypenameField) {
      hasTypenameField = true;
    }
  }

  return { fields, inlineUnions, fragmentRefs, hasTypenameField };
}

function resolveSelection(
  schema: GraphQLSchema,
  selection: SelectionSetNode['selections'][number],
  parentType: GraphQLCompositeType,
  fragments: Map<string, FragmentDefinitionNode>,
  indent: string,
): SelectionSetResult {
  const fields: string[] = [];
  const inlineUnions: string[] = [];
  const fragmentRefs: string[] = [];

  switch (selection.kind) {
    case Kind.FIELD: {
      if (selection.name.value === '__typename') {
        return { fields, inlineUnions, fragmentRefs, hasTypenameField: true };
      }

      const fieldName = selection.alias?.value ?? selection.name.value;

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
        tsType = resolveSelectionSetType(schema, selection.selectionSet, namedType, fragments, `${indent}  `);
      } else if (isScalarType(namedType)) {
        tsType = resolveScalarType(namedType.name);
      } else if (isEnumType(namedType)) {
        tsType = namedType.name;
      } else {
        tsType = namedType.toString();
      }

      if (isList) {
        const wrapped = /[ |&]/.test(tsType) ? `(${tsType})` : tsType;

        tsType = `${wrapped}[]`;
      }

      if (isNonNull) {
        fields.push(`${indent}  ${fieldName}: ${tsType};`);
      } else {
        fields.push(`${indent}  ${fieldName}?: ${tsType} | undefined;`);
      }

      break;
    }
    case Kind.INLINE_FRAGMENT: {
      if (selection.typeCondition && selection.selectionSet) {
        const typeName = selection.typeCondition.name.value;
        const conditionalType = schema.getType(typeName);

        if (!conditionalType) {
          throw new Error(`unknown type "${typeName}" in inline fragment`);
        }

        if (isCompositeType(conditionalType)) {
          if (isInterfaceType(conditionalType)) {
          // interface spreads merge fields into the base (not a discriminated branch)
            const inner = resolveSelectionSet(schema, selection.selectionSet, conditionalType, fragments, indent);

            fields.push(...inner.fields);
            fragmentRefs.push(...inner.fragmentRefs);
          } else if (isObjectType(conditionalType)) {
          // inject __typename discriminant for proper narrowing
            const nested = resolveSelectionSetType(
              schema,
              selection.selectionSet,
              conditionalType,
              fragments,
              indent,
            );

            const model = isContelloModel(schema, conditionalType.name)
              ? deriveModelName(conditionalType.name)
              : undefined;

            if (nested.startsWith('{')) {
              const discriminant = model
                ? `${indent}  __typename: '${conditionalType.name}';\n${indent}  __model: '${model}';`
                : `${indent}  __typename: '${conditionalType.name}';`;

              inlineUnions.push(`{\n${discriminant}\n${nested.slice(2)}`);
            } else {
              const discriminant = model
                ? `{\n${indent}  __typename: '${conditionalType.name}';\n${indent}  __model: '${model}';\n${indent}}`
                : `{\n${indent}  __typename: '${conditionalType.name}';\n${indent}}`;

              inlineUnions.push(`${discriminant} & ${nested}`);
            }
          } else {
            const nested = resolveSelectionSetType(
              schema,
              selection.selectionSet,
              conditionalType,
              fragments,
              indent,
            );

            inlineUnions.push(nested);
          }
        }
      }

      break;
    }
    case Kind.FRAGMENT_SPREAD: {
      const fragmentName = selection.name.value;
      const fragment = fragments.get(fragmentName);

      if (fragment?.selectionSet) {
        const fragmentType = schema.getType(fragment.typeCondition.name.value);

        if (fragmentType && isCompositeType(fragmentType)) {
          if (!checkTypesOverlap(schema, parentType, fragmentType)) {
            throw new Error(
              `fragment "${fragmentName}" (on ${fragmentType.name}) cannot be spread on type "${parentType.name}"`,
            );
          }

          fragmentRefs.push(`${fragmentName}Fragment`);
        }
      }

      break;
    }
  // No default
  }

  return { fields, inlineUnions, fragmentRefs, hasTypenameField: false };
}

function resolveSelectionSetType(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentType: GraphQLCompositeType,
  fragments: Map<string, FragmentDefinitionNode>,
  indent: string,
): string {
  const { fields, inlineUnions, fragmentRefs, hasTypenameField } = resolveSelectionSet(
    schema,
    selectionSet,
    parentType,
    fragments,
    indent,
  );

  // add __typename to base fields only when there are no inline union branches
  // (inline branches carry their own __typename discriminants)
  if (hasTypenameField && inlineUnions.length === 0) {
    const typenameField = isObjectType(parentType)
      ? `${indent}  __typename: '${parentType.name}';`
      : `${indent}  __typename: string;`;

    fields.unshift(typenameField);
  }

  // only inline unions, no base fields and no fragment refs — emit a bare union
  if (fields.length === 0 && fragmentRefs.length === 0 && inlineUnions.length > 0) {
    return inlineUnions.join(' | ');
  }

  const parts: string[] = [];

  if (fields.length > 0) {
    parts.push(`{\n${fields.join('\n')}\n${indent}}`);
  }

  parts.push(...fragmentRefs);

  if (inlineUnions.length > 0) {
    parts.push(`(${inlineUnions.join(' | ')})`);
  }

  if (parts.length === 0) {
    return '{}';
  }

  return parts.join(' & ');
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
  let current = type;

  while (isNonNullType(current)) {
    current = current.ofType;
  }

  if (isListType(current)) {
    return `${graphqlTypeToTs(current.ofType)}[]`;
  }

  if (isScalarType(current)) {
    return resolveScalarType(current.name);
  }

  if (isEnumType(current)) {
    return current.name;
  }

  return current.name;
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
        : (op.operation === 'mutation'
            ? schema.getMutationType()
            : schema.getSubscriptionType());

    if (rootType && op.selectionSet) {
      const resultType = resolveSelectionSetType(schema, op.selectionSet, rootType, fragments, '');

      lines.push(`export type ${resultTypeName} = ${resultType};`);
    } else {
      lines.push(`export type ${resultTypeName} = {};`);
    }

    lines.push('');

    // variables type
    const variablesType = generateVariablesType(schema, op);

    lines.push(`export type ${variablesTypeName} = ${variablesType};`, '');
  }

  return lines.join('\n');
}
