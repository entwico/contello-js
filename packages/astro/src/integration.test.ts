import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AstroIntegration } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';

import contello from './integration';
import { CONFIG_VIRTUAL_MODULE_ID, INSTANCE_VIRTUAL_MODULE_ID, contelloVitePlugin } from './vite-plugin';

const roots: string[] = [];

function projectRoot(entry = 'src/server/contello.ts'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'contello-astro-'));

  mkdirSync(path.dirname(path.join(root, entry)), { recursive: true });
  writeFileSync(path.join(root, entry), 'export const contello = {};');
  roots.push(root);

  return root;
}

function setup(integration: AstroIntegration, root: string) {
  const addMiddleware = vi.fn();
  const updateConfig = vi.fn();
  const hook = integration.hooks['astro:config:setup'] as (params: unknown) => void;

  hook({ config: { root: pathToFileURL(`${root}/`) }, addMiddleware, updateConfig });

  return { addMiddleware, updateConfig };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('contello integration', () => {
  test('injects assets before and routing after the project middleware', () => {
    const { addMiddleware } = setup(contello(), projectRoot());

    expect(addMiddleware.mock.calls).toEqual([
      [{ order: 'pre', entrypoint: '@contello/astro/assets-middleware' }],
      [{ order: 'post', entrypoint: '@contello/astro/routing-middleware' }],
    ]);
  });

  test('skips the middlewares switched off', () => {
    const { addMiddleware } = setup(contello({ assets: false, routing: false }), projectRoot());

    expect(addMiddleware).not.toHaveBeenCalled();
  });

  test('resolves the instance module from the entry option', () => {
    const root = projectRoot('src/cms.ts');
    const { updateConfig } = setup(contello({ entry: 'src/cms.ts' }), root);
    const plugin = updateConfig.mock.calls[0]![0].vite.plugins[0];
    const resolveId = plugin.resolveId as (id: string) => string | undefined;

    expect(resolveId(INSTANCE_VIRTUAL_MODULE_ID)).toBe(path.join(root, 'src/cms.ts'));
  });

  test('fails when the instance module is missing', () => {
    expect(() => setup(contello(), projectRoot('src/elsewhere.ts'))).toThrow(/src\/server\/contello\.ts not found/);
  });
});

describe('contelloVitePlugin', () => {
  test('serves the exclude patterns as code, regexps included', () => {
    const plugin = contelloVitePlugin({ entry: '/app/src/server/contello.ts', exclude: [{ prefix: '/api/' }, { pattern: /^\/x/ }] });
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;
    const resolved = resolveId(CONFIG_VIRTUAL_MODULE_ID)!;

    expect(load(resolved)).toBe(String.raw`export const exclude = [{"prefix":"/api/"}, { pattern: /^\/x/ }];`);
  });

  test('serves null without exclude patterns', () => {
    const plugin = contelloVitePlugin({ entry: '/app/src/server/contello.ts', exclude: null });
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    const load = plugin.load as (id: string) => string | undefined;

    expect(load(resolveId(CONFIG_VIRTUAL_MODULE_ID)!)).toBe('export const exclude = null;');
  });
});
