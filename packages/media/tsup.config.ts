import { defineConfig } from 'tsup';

// `src/fragments.ts` uses `import.meta.url` to resolve bundled .gql file paths
// at runtime — ESM-only syntax. it builds as its own entry (CJS would compile to
// a broken file). runs first with `clean: true` so the shared cleanup happens
// before the main build writes; otherwise parallel DTS passes can clobber the
// fragments.d.ts output.
export default defineConfig([
  {
    entry: ['src/fragments.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    external: ['react', 'react/jsx-runtime'],
  },
]);
