import {
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  Kind,
  type OperationDefinitionNode,
  getLocation,
  print,
  validate,
} from 'graphql';

export function collectFragments(documents: DocumentNode[]): Map<string, FragmentDefinitionNode> {
  const fragments = new Map<string, FragmentDefinitionNode>();

  for (const doc of documents) {
    for (const def of doc.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(def.name.value, def);
      }
    }
  }

  return fragments;
}

export function collectOperations(documents: DocumentNode[]): OperationDefinitionNode[] {
  const operations: OperationDefinitionNode[] = [];
  const seen = new Set<string>();

  for (const doc of documents) {
    for (const def of doc.definitions) {
      if (def.kind === Kind.OPERATION_DEFINITION) {
        if (!def.name) {
          throw new Error(`unnamed operations are not supported:\n\n${print(def)}`);
        }

        if (seen.has(def.name.value)) {
          throw new Error(`duplicate operation name: "${def.name.value}"`);
        }

        seen.add(def.name.value);
        operations.push(def);
      }
    }
  }

  return operations;
}

function collectUsedFragments(
  node: OperationDefinitionNode | FragmentDefinitionNode,
  allFragments: Map<string, FragmentDefinitionNode>,
  collected: Map<string, FragmentDefinitionNode>,
): void {
  const selections = [...(node.selectionSet?.selections ?? [])];

  while (selections.length > 0) {
    const sel = selections.pop()!;

    if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value;

      if (!collected.has(name)) {
        const fragment = allFragments.get(name);

        if (!fragment) {
          throw new Error(`unknown fragment: "${name}"`);
        }

        collected.set(name, fragment);
        collectUsedFragments(fragment, allFragments, collected);
      }
    } else if ('selectionSet' in sel && sel.selectionSet) {
      selections.push(...sel.selectionSet.selections);
    }
  }
}

function sortFragmentsByDependency(fragments: Map<string, FragmentDefinitionNode>): FragmentDefinitionNode[] {
  const sorted: FragmentDefinitionNode[] = [];
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) {
      return;
    }

    visited.add(name);

    const fragment = fragments.get(name);

    if (!fragment) {
      return;
    }

    const deps = new Map<string, FragmentDefinitionNode>();

    collectUsedFragments(fragment, fragments, deps);

    for (const [depName] of deps) {
      if (depName !== name) {
        visit(depName);
      }
    }

    sorted.push(fragment);
  }

  for (const [name] of fragments) {
    visit(name);
  }

  return sorted;
}

export function validateDocuments(
  schema: GraphQLSchema,
  fragments: Map<string, FragmentDefinitionNode>,
  operations: OperationDefinitionNode[],
): void {
  const combined: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [...fragments.values(), ...operations],
  };

  const errors = validate(schema, combined);

  if (errors.length === 0) {
    return;
  }

  const formatted = errors.map((err) => {
    const locations = (err.nodes ?? [])
      .map((node) => {
        if (!node.loc) {
          return null;
        }

        const { source, start } = node.loc;
        const { line, column } = getLocation(source, start);

        return `    at ${source.name}:${line}:${column}`;
      })
      .filter((s): s is string => s !== null);

    return locations.length > 0 ? `  ${err.message}\n${locations.join('\n')}` : `  ${err.message}`;
  });

  throw new Error(`graphql validation failed:\n\n${formatted.join('\n\n')}\n`);
}

export function generateDocumentString(
  operation: OperationDefinitionNode,
  allFragments: Map<string, FragmentDefinitionNode>,
): string {
  const usedFragments = new Map<string, FragmentDefinitionNode>();

  collectUsedFragments(operation, allFragments, usedFragments);

  const sortedFragments = sortFragmentsByDependency(usedFragments);
  const parts = [...sortedFragments.map((f) => print(f)), print(operation)];

  return parts.join('\n');
}
