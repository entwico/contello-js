import {
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  type GraphQLType,
  Kind,
  type SelectionSetNode,
  isCompositeType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
} from 'graphql';

const SCALAR_PREFIX: Record<string, string> = {
  LocalDateTime: '_ldt_',
  LocalDate: '_ld_',
};

function namedTypeName(type: GraphQLType): string | undefined {
  let current: GraphQLType = type;

  while (isNonNullType(current) || isListType(current)) {
    current = current.ofType;
  }

  return isScalarType(current) ? current.name : undefined;
}

function prefixFor(typeName: string): string | undefined {
  return SCALAR_PREFIX[typeName];
}

/**
 * walks a selection set and aliases scalar fields whose type is a managed scalar
 * (LocalDateTime, LocalDate) with a marker prefix. the runtime transform reads the
 * prefix, decodes the wire string to a struct, and renames the key back.
 *
 * recurses through nested object selections and inline fragments — fragment spreads
 * are left intact (their definitions are transformed separately).
 */
function transformSelectionSet(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentTypeName: string,
): SelectionSetNode {
  const parentType = schema.getType(parentTypeName);

  if (!parentType || (!isObjectType(parentType) && !isInterfaceType(parentType))) {
    return selectionSet;
  }

  const parentFields = parentType.getFields();
  const newSelections: (typeof selectionSet.selections)[number][] = [];
  let changed = false;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const schemaField = parentFields[selection.name.value];

      if (!schemaField) {
        newSelections.push(selection);

        continue;
      }

      const scalarName = namedTypeName(schemaField.type);
      const prefix = scalarName ? prefixFor(scalarName) : undefined;

      if (prefix) {
        const aliasValue = selection.alias?.value ?? selection.name.value;

        if (aliasValue.startsWith(prefix)) {
          newSelections.push(selection);
        } else {
          changed = true;
          newSelections.push({
            ...selection,
            alias: { kind: Kind.NAME, value: `${prefix}${aliasValue}` },
          });
        }

        continue;
      }

      if (selection.selectionSet) {
        const nestedTypeName = namedCompositeName(schemaField.type);

        if (nestedTypeName) {
          const transformed = transformSelectionSet(schema, selection.selectionSet, nestedTypeName);

          if (transformed !== selection.selectionSet) {
            changed = true;
            newSelections.push({ ...selection, selectionSet: transformed });

            continue;
          }
        }
      }

      newSelections.push(selection);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const typeName = selection.typeCondition?.name.value;

      if (typeName && selection.selectionSet) {
        const type = schema.getType(typeName);

        if (type && isCompositeType(type)) {
          const transformed = transformSelectionSet(schema, selection.selectionSet, typeName);

          if (transformed !== selection.selectionSet) {
            changed = true;
            newSelections.push({ ...selection, selectionSet: transformed });

            continue;
          }
        }
      }

      newSelections.push(selection);
    } else {
      newSelections.push(selection);
    }
  }

  if (!changed) {
    return selectionSet;
  }

  return { ...selectionSet, selections: newSelections };
}

function namedCompositeName(type: GraphQLType): string | undefined {
  let current: GraphQLType = type;

  while (isNonNullType(current) || isListType(current)) {
    current = current.ofType;
  }

  return isCompositeType(current) ? current.name : undefined;
}

export function transformScalarOperation(
  schema: GraphQLSchema,
  operation: DocumentNode['definitions'][number] & { kind: typeof Kind.OPERATION_DEFINITION },
): typeof operation {
  const rootType =
    operation.operation === 'query'
      ? schema.getQueryType()
      : (operation.operation === 'mutation'
          ? schema.getMutationType()
          : schema.getSubscriptionType());

  if (!rootType || !operation.selectionSet) {
    return operation;
  }

  const transformed = transformSelectionSet(schema, operation.selectionSet, rootType.name);

  if (transformed === operation.selectionSet) {
    return operation;
  }

  return { ...operation, selectionSet: transformed };
}

export function transformScalarFragment(
  schema: GraphQLSchema,
  fragment: FragmentDefinitionNode,
): FragmentDefinitionNode {
  const type = schema.getType(fragment.typeCondition.name.value);

  if (!type || !isCompositeType(type)) {
    return fragment;
  }

  const transformed = transformSelectionSet(schema, fragment.selectionSet, type.name);

  if (transformed === fragment.selectionSet) {
    return fragment;
  }

  return { ...fragment, selectionSet: transformed };
}
