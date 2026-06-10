import { defineConfig } from '@entwico/eslint-config';

export default defineConfig({
  root: import.meta.dirname,
  react: true,
  astro: true,
  ignores: ['**/generated/**', '**/tsup.config.ts', '**/contello.config.ts'],
  extra: [
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
