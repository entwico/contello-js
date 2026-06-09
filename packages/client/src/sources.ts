import { collectAsync, firstAsync, mapAsync } from './async-iterable-utils';
import { wrap } from './diagnostics';
import { createSourceSubscription } from './source-subscription';
import { transformVariables } from './transform-variables';
import type { SourceAccessors, SourceDef, SourceMap } from './types';

type Subscribe = <TData>(query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<TData>;

export function createSources<TSources extends SourceMap>(
  sources: TSources,
  subscribe: Subscribe,
): SourceAccessors<TSources> {
  const out = {} as Record<string, { fetch: (...args: any[]) => Promise<unknown> }>;

  for (const [name, source] of Object.entries(sources)) {
    const def = source as SourceDef;
    const doc = createSourceSubscription(def);

    switch (def.__cardinality) {
      case 'singleton':
        out[name] = {
          fetch: () =>
            wrap(`source:${name}`, () => firstAsync(mapAsync(subscribe<{ source: unknown }>(doc), (r) => r.source))),
        };
        break;
      case 'entity':
        out[name] = {
          fetch: (vars?: { ids?: string[] }) =>
            wrap(`source:${name}`, () =>
              collectAsync(
                mapAsync(
                  subscribe<{ source: unknown[] }>(doc, transformVariables({ ids: vars?.ids })),
                  (r) => r.source,
                ),
              ),
            ),
        };
        break;
      case 'route':
        out[name] = {
          fetch: (vars?: { ids?: string[] | undefined; paths?: string[] | undefined } | undefined) =>
            wrap(`source:${name}`, () =>
              collectAsync(
                mapAsync(
                  subscribe<{ source: unknown[] }>(doc, transformVariables({ ids: vars?.ids, paths: vars?.paths })),
                  (r) => r.source,
                ),
              ),
            ),
        };
        break;
      case 'asset':
        out[name] = {
          fetch: (vars?: { ids?: string[] | undefined } | undefined) =>
            wrap(`source:${name}`, () =>
              collectAsync(
                mapAsync(
                  subscribe<{ source: unknown[] }>(doc, transformVariables({ ids: vars?.ids })),
                  (r) => r.source,
                ),
              ),
            ),
        };
        break;
      case 'i18nMessage':
        out[name] = {
          fetch: (vars: { collection: string; ids?: string[] | undefined }) =>
            wrap(`source:${name}`, () =>
              collectAsync(
                mapAsync(
                  subscribe<{ source: unknown[] }>(
                    doc,
                    transformVariables({ collection: vars.collection, ids: vars.ids }),
                  ),
                  (r) => r.source,
                ),
              ),
            ),
        };
        break;
    }
  }

  return out as SourceAccessors<TSources>;
}
