import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  fixedExtension: false,
  // index.ts uses createRequire(import.meta.url) — needs the import.meta.url shim in the cjs build
  shims: true,
});
