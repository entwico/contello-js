import { graphqlOperationAttributes } from '@contello/opentelemetry';
import { firstAsync, mapAsync } from '@entwico/dash/async';
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
type Collect = <TData>(query: string, variables?: Record<string, unknown> | undefined) => Promise<TData[]>;

/**
 * How the sources reach Contello. A read is sent again when its connection is lost; a write is
 * not, the first attempt may have arrived.
 */
export type SourceTransport = {
  write: Subscribe;
  /** The first message of a subscription. */
  readOne: Subscribe;
  /** Every message of a subscription that ends. */
  readAll: Collect;
};

async function collectSource(collect: Collect, doc: string, variables: Record<string, unknown>): Promise<unknown[]> {
  const batches = await collect<{ source: unknown[] }>(doc, variables);

  return batches.flatMap((batch) => batch.source);
}

const WRITE_KINDS: SourceMutationKind[] = ['create', 'update', 'delete'];

export function createSources<TSources extends SourceMap>(
  sources: TSources,
  transport: SourceTransport,
): SourceAccessors<TSources> {
  const out = {} as Record<string, Record<string, (...args: any[]) => Promise<unknown>>>;

  for (const [name, source] of Object.entries(sources)) {
    const def = source as SourceDef;
    const doc = createSourceSubscription(def);
    const accessor = createSourceAccessor(name, def, doc, transport);

    if (accessor) {
      out[name] = { ...accessor, ...createSourceWriters(name, def, transport.write) };
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
  transport: SourceTransport,
): { fetch: (...args: any[]) => Promise<unknown> } | undefined {
  switch (def.__cardinality) {
    case 'singleton': {
      return {
        fetch: () =>
          wrap(
            `source:${name}`,
            () => firstAsync(mapAsync(transport.readOne<{ source: unknown }>(doc), (r) => r.source)),
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
            () => collectSource(transport.readAll, doc, variables),
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
            () => collectSource(transport.readAll, doc, variables),
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
            () => collectSource(transport.readAll, doc, variables),
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
            () => collectSource(transport.readAll, doc, variables),
            graphqlOperationAttributes(doc, variables),
          );
        },
      };
    }
  }
}
