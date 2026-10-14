import { type ExcludePattern, serializeExcludePatterns } from '@astroscope/node/excludes';
import type { Plugin } from 'vite';

export const INSTANCE_VIRTUAL_MODULE_ID = 'virtual:@contello/astro/instance';
export const CONFIG_VIRTUAL_MODULE_ID = 'virtual:@contello/astro/config';

const RESOLVED_CONFIG_VIRTUAL_MODULE_ID = `\0${CONFIG_VIRTUAL_MODULE_ID}`;

export type ContelloVitePluginOptions = {
  /** absolute path of the module exporting the `contello` instance */
  entry: string;
  /** routing exclude patterns, null for the middleware default */
  exclude: ExcludePattern[] | null;
};

/**
 * Resolves the instance id straight to the project's module, so the injected
 * middlewares and the project's own imports share one `Contello` instance, and
 * serves the serializable integration options as a config module.
 */
export function contelloVitePlugin(options: ContelloVitePluginOptions): Plugin {
  return {
    name: '@contello/astro',

    resolveId(id) {
      if (id === INSTANCE_VIRTUAL_MODULE_ID) {
        return options.entry;
      }

      if (id === CONFIG_VIRTUAL_MODULE_ID) {
        return RESOLVED_CONFIG_VIRTUAL_MODULE_ID;
      }
    },

    load(id) {
      if (id === RESOLVED_CONFIG_VIRTUAL_MODULE_ID) {
        // exclude patterns may contain RegExp — serialized as code, not JSON
        return `export const exclude = ${options.exclude ? serializeExcludePatterns(options.exclude) : 'null'};`;
      }
    },
  };
}
