import type { OperationDefinitionNode } from 'graphql';

import { pascalCase, uncapitalize } from './utils';

/** Emits `export type Operations = { ... }`. */
export function generateOperationsType(operations: OperationDefinitionNode[]): string {
  const lines: string[] = ['export type Operations = {'];

  for (const op of operations) {
    const name = op.name!.value;
    const camelName = uncapitalize(name);
    const typeSuffix = pascalCase(op.operation);
    const resultType = `${name}${typeSuffix}`;
    const variablesType = `${resultType}Variables`;

    lines.push(`  ${camelName}: {`, `    document: string;`, `    kind: '${op.operation}';`, `    __result?: ${resultType} | undefined;`, `    __variables?: ${variablesType} | undefined;`, '  };');
  }

  lines.push('};');

  return lines.join('\n');
}

/**
 * Emits the typed `operations` const body for inclusion in the schema bundle:
 *   const operations: Operations = { getProducts: { document: getProductsDocument, kind: 'query' }, ... };
 */
export function generateOperationsConst(operations: OperationDefinitionNode[]): string {
  const lines: string[] = ['const operations: Operations = {'];

  for (const op of operations) {
    const camelName = uncapitalize(op.name!.value);

    lines.push(`  ${camelName}: { document: ${camelName}Document, kind: '${op.operation}' },`);
  }

  lines.push('};');

  return lines.join('\n');
}
