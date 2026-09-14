import { defineConfig } from '@entwico/eslint-config';

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  astro: true,
  ignores: ['**/generated/**', '**/_/gql/**', '**/tsdown.config.ts', '**/contello.config.ts'],
  // published entry points are the one legitimate barrel per package
  imports: {
    noReexport: {
      allow: [
        'packages/*/src/index.ts',
        'packages/media/src/react/index.ts',
        'packages/*/src/fragments.ts',
      ],
    },
  },
  extra: [
    {
      // @contello/media is framework-agnostic
      // import.meta.env.SSR is not always available
      files: ['packages/media/**'],
      rules: {
        '@astroscope/prefer-ssr-guard': 'off',
      },
    },
    {
      // runtime imports of astro would put every consumer of this package into astro's runtime module graph
      // (see packages/astro/src/middleware.ts) — types are fine
      files: ['packages/astro/src/**'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['astro', 'astro/*', 'astro:*'],
                allowTypeImports: true,
                message: 'import only types from astro here — a runtime import couples the package to astro\'s module graph',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.test.{ts,tsx}'],
      rules: {
        // tests pull vitest from the workspace root, not each package's package.json
        'import-x/no-extraneous-dependencies': 'off',
        // test doubles implement the async-iterator protocol (async next/return, async function*) without awaiting
        '@typescript-eslint/require-await': 'off',
        // tests pass explicit `undefined` to required params to exercise nullish branches — stripping it breaks arity
        'unicorn/no-useless-undefined': ['error', { checkArguments: false }],
      },
    },
  ],
});
