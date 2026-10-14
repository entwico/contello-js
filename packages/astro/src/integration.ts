import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExcludePattern } from '@astroscope/node/excludes';
import type { AstroIntegration } from 'astro';
import { contelloVitePlugin } from './vite-plugin';

const DEFAULT_ENTRY = 'src/server/contello.ts';

export type ContelloIntegrationOptions = {
  /**
   * Module exporting the `contello` instance (`export const contello = createContello(...)`),
   * relative to the project root.
   * @default 'src/server/contello.ts'
   */
  entry?: string | undefined;
  /**
   * Where the assets middleware (`/_contello/i/`, `/_contello/f/`, `/_contello/v/`) is injected;
   * `false` leaves it to the project (`contello.createAssetsMiddleware()`).
   * @default 'pre'
   */
  assets?: 'pre' | false | undefined;
  /**
   * Where the routing middleware is injected; `false` leaves it to the project
   * (`contello.createRoutingMiddleware()`). Post middlewares run in `integrations` order, so list
   * `contello()` before integrations whose middleware depends on the resolved route, e.g. `@astroscope/wormhole`.
   * @default 'post'
   */
  routing?: 'post' | false | undefined;
  /**
   * Paths the routing middleware skips.
   * @default RECOMMENDED_EXCLUDES from `@astroscope/node/excludes`
   */
  exclude?: ExcludePattern[] | undefined;
};

/**
 * Astro integration for Contello.
 *
 * Injects the assets middleware ahead of the project's own middleware and the routing
 * middleware after it, both bound to the project's `contello` instance, which the
 * integration resolves from `src/server/contello.ts` (or `entry`). Runtime options
 * (`resolveRoutePath`, assets cache control, the routes instance) live on the instance,
 * only serializable ones belong here.
 */
export default function contelloIntegration(options: ContelloIntegrationOptions = {}): AstroIntegration {
  const { entry = DEFAULT_ENTRY, assets = 'pre', routing = 'post', exclude = null } = options;

  return {
    name: '@contello/astro',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, addMiddleware }) => {
        const entryPath = path.resolve(fileURLToPath(config.root), entry);

        if (!fs.existsSync(entryPath)) {
          throw new Error(
            `@contello/astro: instance module ${entry} not found — ` +
            'export `contello = createContello(...)` from it or point the integration\'s `entry` option at it',
          );
        }

        if (assets) {
          addMiddleware({ order: assets, entrypoint: '@contello/astro/assets-middleware' });
        }

        if (routing) {
          addMiddleware({ order: routing, entrypoint: '@contello/astro/routing-middleware' });
        }

        updateConfig({
          vite: {
            plugins: [contelloVitePlugin({ entry: entryPath, exclude })],
          },
        });
      },
    },
  };
}
