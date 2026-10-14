import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    entry: ['src/assets-middleware-entrypoint.ts', 'src/routing-middleware-entrypoint.ts'],
    format: ['esm'],
    dts: true,
    fixedExtension: false,
    deps: {
      neverBundle: ['virtual:@contello/astro/instance', 'virtual:@contello/astro/config'],
    },
  },
]);
