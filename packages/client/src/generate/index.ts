import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { type FragmentDefinitionNode, Kind, Source, parse, visit } from 'graphql';

import { loadConfig } from './config';
import {
  collectFragments,
  collectOperations,
  fragmentBundleExpression,
  generateFragmentSchemas,
  operationDocumentExpression,
  validateDocuments,
} from './documents';
import { introspectSchema } from './introspect';
import { generateFragmentTypes, generateOperationTypes } from './operation-types';
import { generateOperationsConst, generateOperationsType } from './operations';
import { extractEntityModels, generateSchemaTypes } from './schema-types';
import {
  type SourceEntry,
  generateSourcesConst,
  generateSourcesType,
  indexBuiltInSources,
  indexEntitySources,
} from './sources';
import { transformFragment, transformOperation } from './transform-components';
import { uncapitalize } from './utils';

const ctrlSeq = '\x1b[';
const styled = (s: string, pre: string, post: string) => `${ctrlSeq}${pre}${s}${ctrlSeq}${post}`;

const dim = (s: string) => styled(s, '2m', '22m');
const bold = (s: string) => styled(s, '1m', '22m');
const green = (s: string) => styled(s, '32m', '39m');
const yellow = (s: string) => styled(s, '33m', '39m');
const cyan = (s: string) => styled(s, '36m', '39m');

function collectFragmentSpreads(fragment: FragmentDefinitionNode): Set<string> {
  const refs = new Set<string>();

  visit(fragment, {
    [Kind.FRAGMENT_SPREAD](node) {
      refs.add(node.name.value);
    },
  });

  return refs;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);

  console.log('');
  console.log(`${bold('@contello/client')} ${dim('generate')}`);
  console.log('');

  for (const project of config.projects) {
    const start = performance.now();

    console.log(`${cyan('●')} ${bold(project.project)}`);

    // remove stale output before generating
    rmSync(resolve(cwd, project.output), { force: true });

    // introspect schema
    const schema = await introspectSchema(project.url, project.project, project.token);

    // load .gql documents
    const patterns = Array.isArray(project.documents) ? project.documents : [project.documents];
    const documentPaths = (await Promise.all(patterns.map((p) => Array.fromAsync(glob(p, { cwd }))))).flat().sort();

    if (documentPaths.length === 0) {
      console.warn(`  ${yellow('⚠')} no documents found matching "${project.documents}"`);

      continue;
    }

    const documents = documentPaths.map((p) => parse(new Source(readFileSync(resolve(cwd, p), 'utf-8'), p)));
    const fragments = collectFragments(documents);
    const operations = collectOperations(documents);

    // validate user documents against the schema before transforming
    validateDocuments(schema, fragments, operations);

    // transform component fields (auto-inject _flat_ pattern)
    const transformedFragments = new Map(
      [...fragments].map(([name, frag]) => [name, transformFragment(schema, frag, fragments)]),
    );

    const transformedOperations = operations.map((op) => transformOperation(schema, op, transformedFragments));

    // source consts for entity-bound + built-in fragments (always emitted)
    const entityBindings = indexEntitySources(schema);
    const builtInBindings = indexBuiltInSources(schema);
    const sourceEntries: SourceEntry[] = [];

    // entity sources: one fragment per entity type — collected directly
    for (const [name, fragment] of fragments) {
      const entityBinding = entityBindings.get(fragment.typeCondition.name.value);

      if (!entityBinding) {
        continue;
      }

      const transformed = transformedFragments.get(name);

      if (!transformed) {
        continue;
      }

      sourceEntries.push({
        fragmentName: name,
        binding: {
          cardinality: entityBinding.cardinality,
          fieldName: entityBinding.fieldName,
          sourceKey: entityBinding.model,
        },
        fragmentExpression: fragmentBundleExpression(transformed, transformedFragments),
      });
    }

    // built-in sources: a type can have multiple fragments (e.g. MediaAsset base + StoreAsset),
    // pick the "root" — the one not spread by any other candidate fragment for the same type.
    for (const [typeName, builtInBinding] of builtInBindings) {
      const candidates: { name: string; fragment: FragmentDefinitionNode }[] = [];

      for (const [name, fragment] of fragments) {
        if (fragment.typeCondition.name.value === typeName) {
          candidates.push({ name, fragment });
        }
      }

      if (candidates.length === 0) {
        continue;
      }

      const candidateNames = new Set(candidates.map((c) => c.name));
      const spreadByOther = new Set<string>();

      for (const { name, fragment } of candidates) {
        for (const ref of collectFragmentSpreads(fragment)) {
          if (ref !== name && candidateNames.has(ref)) {
            spreadByOther.add(ref);
          }
        }
      }

      const roots = candidates.filter((c) => !spreadByOther.has(c.name));
      const picked = roots.length === 1 ? roots[0] : undefined;

      if (!picked) {
        throw new Error(
          `multiple fragments target the built-in type "${typeName}" without a clear root: ${candidates
            .map((c) => `"${c.name}"`)
            .join(', ')}. Either have one fragment spread the others, or remove the extras.`,
        );
      }

      const transformed = transformedFragments.get(picked.name);

      if (!transformed) {
        continue;
      }

      sourceEntries.push({
        fragmentName: picked.name,
        binding: {
          cardinality: builtInBinding.cardinality,
          fieldName: builtInBinding.fieldName,
          sourceKey: uncapitalize(picked.name),
        },
        fragmentExpression: fragmentBundleExpression(transformed, transformedFragments),
      });
    }

    const entityModels = extractEntityModels(schema);

    // assemble
    const parts: string[] = [];

    parts.push('/* eslint-disable */');
    parts.push('// @ts-nocheck');
    parts.push('/* this file is generated by contello-client — do not edit */');
    parts.push('');

    parts.push(`import type { SourceDef } from '@contello/client';`);
    parts.push('');

    parts.push(generateSchemaTypes(schema));

    parts.push(generateFragmentTypes(schema, fragments));

    parts.push(generateOperationTypes(schema, operations, fragments));

    if (transformedFragments.size > 0) {
      parts.push(generateFragmentSchemas(transformedFragments));
      parts.push('');
    }

    // operation document constants (template-literal interpolated, internal)
    for (let i = 0; i < operations.length; i++) {
      const camelName = uncapitalize(operations[i]!.name!.value);
      const docExpr = operationDocumentExpression(transformedOperations[i]!, transformedFragments);

      parts.push(`export const ${camelName}Document = ${docExpr};`);
    }

    if (operations.length > 0) {
      parts.push('');
    }

    // Operations type
    parts.push(generateOperationsType(operations));
    parts.push('');

    // Sources type (only when there are sources)
    const sourcesTypeSrc = generateSourcesType(sourceEntries);

    if (sourcesTypeSrc) {
      parts.push(sourcesTypeSrc);
      parts.push('');
    }

    // internal typed consts referenced by the schema bundle
    parts.push(generateOperationsConst(operations));
    parts.push('');

    const sourcesConstSrc = generateSourcesConst(sourceEntries);

    if (sourcesConstSrc) {
      parts.push(sourcesConstSrc);
      parts.push('');
    }

    // models const — entity-model reference name to typename mapping
    if (entityModels.size > 0) {
      const sorted = [...entityModels.entries()].sort(([a], [b]) => a.localeCompare(b));

      parts.push('const models = {');

      for (const [model, typeName] of sorted) {
        parts.push(`  ${model}: '${typeName}',`);
      }

      parts.push('} as const;');
      parts.push('');
    } else {
      parts.push('const models = {} as const;');
      parts.push('');
    }

    // the schema bundle — the single public export consumers pass to createContelloClient / createStore
    const sourcesPart = sourcesConstSrc ? ', sources' : ', sources: {}';

    parts.push(`export const schema = { operations${sourcesPart}, models };`);
    parts.push('export type Schema = typeof schema;');

    let output = parts.join('\n');

    // optional namespace wrapping
    if (project.namespace) {
      const indented = output
        .split('\n')
        .map((line) => (line ? `  ${line}` : ''))
        .join('\n');

      output = `export namespace ${project.namespace} {\n${indented}\n}\n`;
    }

    // write output
    const outputPath = resolve(cwd, project.output);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output, 'utf-8');

    const elapsed = Math.round(performance.now() - start);

    console.log(`  ${green('✓')} ${relative(cwd, outputPath)} ${dim(`${elapsed}ms`)}`);
    console.log(`      ${dim('operations')} ${operations.length}  ${dim('fragments')} ${fragments.size}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
