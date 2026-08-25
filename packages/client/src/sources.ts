import { graphqlOperationAttributes } from '@contello/opentelemetry';
import { concatAsync, firstAsync, mapAsync } from '@entwico/dash/async';
import {
  type SourceMutationKind,
  createSourceMutation,
  createSourceMutationVariables,
  readSourceMutationId,
} from './source-mutation';
import { createSourceSubscription } from './source-subscription';
import { wrap } from './telemetry';
import { transformVariables } from './transform-variables';
import type { SourceAccessors, SourceDef, SourceMap } from './types';

type Subscribe = <TData>(query: string, variables?: Record<string, unknown> | undefined) => AsyncIterable<TData>;

const WRITE_KINDS: SourceMutationKind[] = ['create', 'update', 'delete'];

export function createSources<TSources extends SourceMap>(
  sources: TSources,
  subscribe: Subscribe,
): SourceAccessors<TSources> {
  const out = {} as Record<string, Record<string, (...args: any[]) => Promise<unknown>>>;

  for (const [name, source] of Object.entries(sources)) {
    const def = source as SourceDef;
    const doc = createSourceSubscription(def);
    const accessor = createSourceAccessor(name, def, doc, subscribe);

    if (accessor) {
      out[name] = { ...accessor, ...createSourceWriters(name, def, subscribe) };
    }
  }

  return out as SourceAccessors<TSources>;
}

/**
 * Write accessors for the mutations the generator bound to this source. A create/update answers
 * with the entity in the source's fragment shape, a delete with the id it removed. Nothing is
 * cached here — `@contello/store` collections take the same payload into their cache.
 */
function createSourceWriters(
  name: string,
  def: SourceDef,
  subscribe: Subscribe,
): Record<string, (input: unknown) => Promise<unknown>> {
  const out: Record<string, (input: unknown) => Promise<unknown>> = {};

  for (const kind of WRITE_KINDS) {
    const binding = def.mutations?.[kind];

    if (!binding) {
      continue;
    }

    const doc = createSourceMutation(def, kind);

    out[kind] = (input: unknown) => {
      // a delete is addressed by id: bindings that take a bare `id:` argument read it off the input
      const variables = createSourceMutationVariables(
        binding,
        kind === 'delete' ? { input, id: (input as { id: string }).id } : { input },
      );

      return wrap(
        `source:${name}:${kind}`,
        async () => {
          const response = await firstAsync(subscribe<{ result: unknown }>(doc, variables));

          if (response?.result === undefined || response.result === null) {
            throw new Error(`@contello/client: ${kind} on source "${name}" returned no entity`);
          }

          return kind === 'delete' ? readSourceMutationId(binding, response.result) : response.result;
        },
        graphqlOperationAttributes(doc, variables),
      );
    };
  }

  return out;
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
