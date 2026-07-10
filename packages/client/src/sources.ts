import { graphqlOperationAttributes } from '@contello/opentelemetry';
import { concatAsync, firstAsync, mapAsync } from '@entwico/dash/async';
import { createSourceSubscription } from './source-subscription';
import { wrap } from './telemetry';
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
    const accessor = createSourceAccessor(name, def, doc, subscribe);

    if (accessor) {
      out[name] = accessor;
    }
  }

  return out as SourceAccessors<TSources>;
}

function createSourceAccessor(
  name: string,
  def: SourceDef,
  doc: string,
  subscribe: Subscribe,
): { fetch: (...args: any[]) => Promise<unknown> } | undefined {
  switch (def.__cardinality) {
    case 'singleton': {
      return {
        fetch: () =>
          wrap(
            `source:${name}`,
            () => firstAsync(mapAsync(subscribe<{ source: unknown }>(doc), (r) => r.source)),
            graphqlOperationAttributes(doc),
          ),
      };
    }
    case 'entity': {
      return {
        fetch: (vars?: { ids?: string[] }) => {
          const variables = transformVariables({ ids: vars?.ids });

          return wrap(
            `source:${name}`,
            () => concatAsync(mapAsync(subscribe<{ source: unknown[] }>(doc, variables), (r) => r.source)),
            graphqlOperationAttributes(doc, variables),
          );
        },
      };
    }
    case 'route': {
      return {
        fetch: (vars?: { ids?: string[] | undefined; paths?: string[] | undefined } | undefined) => {
          const variables = transformVariables({ ids: vars?.ids, paths: vars?.paths });

          return wrap(
            `source:${name}`,
            () => concatAsync(mapAsync(subscribe<{ source: unknown[] }>(doc, variables), (r) => r.source)),
            graphqlOperationAttributes(doc, variables),
          );
        },
      };
    }
    case 'asset': {
      return {
        fetch: (vars?: { ids?: string[] | undefined } | undefined) => {
          const variables = transformVariables({ ids: vars?.ids });

          return wrap(
            `source:${name}`,
            () => concatAsync(mapAsync(subscribe<{ source: unknown[] }>(doc, variables), (r) => r.source)),
            graphqlOperationAttributes(doc, variables),
          );
        },
      };
    }
    case 'i18nMessage': {
      return {
        fetch: (vars: { collection: string; ids?: string[] | undefined }) => {
          const variables = transformVariables({ collection: vars.collection, ids: vars.ids });

          return wrap(
            `source:${name}`,
            () => concatAsync(mapAsync(subscribe<{ source: unknown[] }>(doc, variables), (r) => r.source)),
            graphqlOperationAttributes(doc, variables),
          );
        },
      };
    }
  }
}
