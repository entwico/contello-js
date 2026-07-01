import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/fragments.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    fixedExtension: false,
  },
]);
