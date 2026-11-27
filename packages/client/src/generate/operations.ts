import type { OperationDefinitionNode } from 'graphql';

import { RETRY_SUFFIX } from '../rpc';
import { pascalCase, uncapitalize } from './utils';

function assertNoRetryNameCollision(operations: OperationDefinitionNode[]): void {
  const names = new Set(operations.map((op) => uncapitalize(op.name!.value)));

  for (const op of operations) {
    const name = uncapitalize(op.name!.value);

    if (op.operation === 'subscription' && names.has(name + RETRY_SUFFIX)) {
      throw new Error(
        `operation "${name}${RETRY_SUFFIX}" collides with the retrying rpc method of subscription "${name}" — rename it`,
      );
    }
  }
}

/** Emits `export type Operations = { ... }`. */
export function generateOperationsType(operations: OperationDefinitionNode[]): string {
  assertNoRetryNameCollision(operations);

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
