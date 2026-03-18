import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  Kind,
  type SelectionSetNode,
  isCompositeType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  parse,
} from 'graphql';

const FLAT_PREFIX = '_flat_';
const FLAT_COMPONENT_TYPE = 'ContelloFlatComponent';
const COMPONENT_UNION = 'ContelloComponent';

/**
 * checks if a schema type (unwrapped from list/non-null) is the ContelloComponent union.
 */
function isComponentUnion(schema: GraphQLSchema, typeName: string): boolean {
  const type = schema.getType(typeName);

  return !!type && isUnionType(type) && type.name === COMPONENT_UNION;
}

/**
 * unwraps NonNull and List wrappers to get the named type.
 */
function getNamedTypeName(type: any): string | undefined {
  if (isNonNullType(type)) return getNamedTypeName(type.ofType);
  if (isListType(type)) return getNamedTypeName(type.ofType);

  return type?.name;
}

/**
 * the flat ref selection: `{ __typename ... on ContelloFlatComponent { _flatId } }`
 */
const FLAT_REF_SELECTIONS: SelectionSetNode = parse(
  `{ __typename ... on ${FLAT_COMPONENT_TYPE} { _flatId } }`,
).definitions.flatMap((d) => ('selectionSet' in d ? [d.selectionSet] : []))[0]!;

/**
 * checks if a fragment on ContelloComponent already has the FlatComponent pattern
 * (i.e. already has `... on ContelloFlatComponent { _flatId }`)
 */
function hasExistingFlatSpread(selectionSet: SelectionSetNode): boolean {
  return selectionSet.selections.some(
    (s) => s.kind === Kind.INLINE_FRAGMENT && s.typeCondition?.name.value === FLAT_COMPONENT_TYPE,
  );
}

/**
 * adds flat ref selections (__typename + ... on ContelloFlatComponent { _flatId })
 * to a selection set, if not already present.
 */
function addFlatRefSelections(selectionSet: SelectionSetNode): SelectionSetNode {
  if (hasExistingFlatSpread(selectionSet)) {
    return selectionSet;
  }

  return {
    ...selectionSet,
    selections: [...FLAT_REF_SELECTIONS.selections, ...selectionSet.selections],
  };
}

/**
 * transforms a selection set by rewriting ContelloComponent fields:
 * - the original field gets flat ref selections only
 * - a `_flat_{fieldName}` sibling is added with the original selections + flat refs
 */
function transformSelectionSet(
  schema: GraphQLSchema,
  selectionSet: SelectionSetNode,
  parentTypeName: string,
  fragments: Map<string, FragmentDefinitionNode>,
  refsOnly = false,
): SelectionSetNode {
  const parentType = schema.getType(parentTypeName);

  if (!parentType || !isObjectType(parentType)) {
    return selectionSet;
  }

  const parentFields = parentType.getFields();
  const newSelections: (typeof selectionSet.selections)[number][] = [];
  let changed = false;

  function recurse<T extends { selectionSet?: SelectionSetNode | undefined }>(node: T, typeName: string): void {
    if (!node.selectionSet) {
      newSelections.push(node as any);

      return;
    }

    const transformed = transformSelectionSet(schema, node.selectionSet, typeName, fragments, refsOnly);

    if (transformed !== node.selectionSet) {
      changed = true;
      newSelections.push({ ...node, selectionSet: transformed } as any);
    } else {
      newSelections.push(node as any);
    }
  }

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.name.value;
      const schemaField = parentFields[fieldName];

      if (!schemaField) {
        newSelections.push(selection);

        continue;
      }

      const namedTypeName = getNamedTypeName(schemaField.type);

      // check if this field is a [ContelloComponent] field
      if (namedTypeName && isComponentUnion(schema, namedTypeName) && selection.selectionSet) {
        const flatFieldName = `${FLAT_PREFIX}${fieldName}`;

        if (!parentFields[flatFieldName]) {
          newSelections.push(selection);

          continue;
        }

        changed = true;

        newSelections.push({ ...selection, selectionSet: FLAT_REF_SELECTIONS } as FieldNode);

        if (!refsOnly) {
          newSelections.push({
            kind: Kind.FIELD,
            name: { kind: Kind.NAME, value: flatFieldName },
            selectionSet: addFlatRefSelections(selection.selectionSet),
          } as FieldNode);
        }
      } else if (namedTypeName) {
        recurse(selection, namedTypeName);
      } else {
        newSelections.push(selection);
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const typeName = selection.typeCondition?.name.value;
      const type = typeName ? schema.getType(typeName) : undefined;

      if (typeName && type && isCompositeType(type) && isObjectType(type)) {
        recurse(selection, typeName);
      } else {
        newSelections.push(selection);
      }
    } else {
      newSelections.push(selection);
    }
  }

  if (!changed) {
    return selectionSet;
  }

  return { ...selectionSet, selections: newSelections };
}

/**
 * transforms an operation by rewriting ContelloComponent fields in the query.
 * returns the original operation if no transform was needed.
 */
export function transformOperation(
  schema: GraphQLSchema,
  operation: DocumentNode['definitions'][number] & { kind: typeof Kind.OPERATION_DEFINITION },
  fragments: Map<string, FragmentDefinitionNode>,
): typeof operation {
  const rootType =
    operation.operation === 'query'
      ? schema.getQueryType()
      : operation.operation === 'mutation'
        ? schema.getMutationType()
        : schema.getSubscriptionType();

  if (!rootType || !operation.selectionSet) {
    return operation;
  }

  const transformed = transformSelectionSet(schema, operation.selectionSet, rootType.name, fragments);

  if (transformed === operation.selectionSet) {
    return operation;
  }

  return { ...operation, selectionSet: transformed };
}

/**
 * transforms a fragment definition by rewriting ContelloComponent fields.
 * also ensures fragments on ContelloComponent include flat ref selections.
 */
export function transformFragment(
  schema: GraphQLSchema,
  fragment: FragmentDefinitionNode,
  fragments: Map<string, FragmentDefinitionNode>,
): FragmentDefinitionNode {
  const typeName = fragment.typeCondition.name.value;
  const type = schema.getType(typeName);

  if (!type || !isCompositeType(type)) {
    return fragment;
  }

  let selectionSet = fragment.selectionSet;

  // if this fragment is on ContelloComponent, ensure it has flat ref selections
  if (typeName === COMPONENT_UNION) {
    selectionSet = addFlatRefSelections(selectionSet);
  }

  // transform any nested ContelloComponent fields within the fragment
  if (isObjectType(type)) {
    selectionSet = transformSelectionSet(schema, selectionSet, typeName, fragments, true);
  } else if (isUnionType(type)) {
    // for union fragments, transform inline fragments inside (refs only — no _flat_ siblings)
    const newSelections = selectionSet.selections.map((sel) => {
      if (sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition && sel.selectionSet) {
        const inlineTypeName = sel.typeCondition.name.value;
        const inlineType = schema.getType(inlineTypeName);

        if (inlineType && isObjectType(inlineType)) {
          const transformed = transformSelectionSet(schema, sel.selectionSet, inlineTypeName, fragments, true);

          if (transformed !== sel.selectionSet) {
            return { ...sel, selectionSet: transformed };
          }
        }
      }

      return sel;
    });

    selectionSet = { ...selectionSet, selections: newSelections };
  }

  if (selectionSet === fragment.selectionSet) {
    return fragment;
  }

  return { ...fragment, selectionSet };
}
