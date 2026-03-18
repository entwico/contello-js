import type { OperationDefinitionNode } from 'graphql';

import { pascalCase, uncapitalize } from './utils';

export function generateOperationsObject(operations: OperationDefinitionNode[]): string {
  const lines: string[] = [];

  // operations type (with phantom type metadata)
  lines.push('export type Operations = {');

  for (const op of operations) {
    const name = op.name!.value;
    const camelName = uncapitalize(name);
    const typeSuffix = pascalCase(op.operation);
    const resultType = `${name}${typeSuffix}`;
    const variablesType = `${resultType}Variables`;

    lines.push(`  ${camelName}: {`);
    lines.push(`    document: string;`);
    lines.push(`    kind: '${op.operation}';`);
    lines.push(`    __result?: ${resultType} | undefined;`);
    lines.push(`    __variables?: ${variablesType} | undefined;`);
    lines.push('  };');
  }

  lines.push('};');
  lines.push('');

  // runtime operations object
  lines.push('export const operations: Operations = {');

  for (const op of operations) {
    const camelName = uncapitalize(op.name!.value);

    lines.push(`  ${camelName}: { document: ${camelName}Document, kind: '${op.operation}' },`);
  }

  lines.push('} as Operations;');

  return lines.join('\n');
}
