import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { type Options, defineConfig } from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

function resolveGqlImports(filePath: string, seen = new Set<string>()): string {
  if (seen.has(filePath)) {
    return '';
  }

  seen.add(filePath);

  const content = readFileSync(filePath, 'utf-8');
  const lines: string[] = [];

  for (const line of content.split('\n')) {
    const match = line.match(/^#import\s+['"](.+)['"]/);

    if (match?.[1]) {
      const importPath = resolve(dirname(filePath), match[1]);

      lines.push(resolveGqlImports(importPath, seen));
    } else {
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function gqlPlugin(): EsbuildPlugin {
  return {
    name: 'gql-import',
    setup(build) {
      build.onLoad({ filter: /\.gql$/ }, (args) => ({
        contents: resolveGqlImports(args.path),
        loader: 'text' as const,
      }));
    },
  };
}

export default defineConfig([
  {
    entry: ['src/fragments.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    esbuildPlugins: [gqlPlugin()],
  },
]);
