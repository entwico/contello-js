import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/*/src/**/*.browser.test.{ts,tsx}',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/generated/**',
        'packages/store/src/fragments.ts',
        'packages/media/src/fragments.ts',
        'packages/client/src/cli.ts',
      ],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, '**/*.browser.test.*'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
