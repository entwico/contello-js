import { graphqlOperationAttributes } from '@contello/opentelemetry';
import type { OperationOptions } from './deadline';
import {
  type SourceMutationKind,
  type SourceMutationValues,
  createSourceMutation,
  createSourceMutationVariables,
  readSourceMutationId,
} from './source-mutation';
import { createSourceSubscription } from './source-subscription';
import { wrap } from './telemetry';
import { transformVariables } from './transform-variables';
import type { SourceAccessors, SourceDef, SourceMap, SourceMutationBinding } from './types';

type Variables = Record<string, unknown> | undefined;
type Options = OperationOptions | undefined;

/**
 * How the sources reach Contello. A read is sent again when its connection is lost; a write is
 * not, the first attempt may have arrived.
 */
export type SourceTransport = {
  write: <TData>(query: string, variables: Variables, options: Options) => Promise<TData>;
  /** The first message of a subscription. */
  readOne: <TData>(query: string, variables: Variables, options: Options) => Promise<TData>;
  /** Every message of a subscription that ends. */
  readAll: <TData>(query: string, variables: Variables, options: Options) => Promise<TData[]>;
};

type ListRequest = OperationOptions & {
  ids?: string[] | undefined;
  paths?: string[] | undefined;
  collection?: string | undefined;
};

async function collectSource(
  transport: SourceTransport,
  doc: string,
  variables: Record<string, unknown>,
  options: Options,
): Promise<unknown[]> {
  const batches = await transport.readAll<{ source: unknown[] }>(doc, variables, options);

  return batches.flatMap((batch) => batch.source);
}

const WRITE_KINDS: SourceMutationKind[] = ['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'];

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
      out[name] = { ...accessor, ...createSourceWriters(name, def, transport) };
    }
  }

  return out as SourceAccessors<TSources>;
}

type WriteValues = { values: SourceMutationValues; count: number | undefined };

/** What a write sends, and for a write of a list how many entities it holds. */
function readWriteInput(kind: SourceMutationKind, input: unknown): WriteValues {
  switch (kind) {
    case 'createMany':
    case 'updateMany': {
      return { values: { input }, count: (input as unknown[]).length };
    }
    case 'deleteMany': {
      return { values: { input }, count: (input as { ids: unknown[] }).ids.length };
    }
    case 'delete': {
      // a delete is addressed by id: bindings that take a bare `id:` argument read it off the input
      return { values: { input, id: (input as { id: string }).id }, count: undefined };
    }
    default: {
      return { values: { input }, count: undefined };
    }
  }
}

/**
 * The entities a batch write answered with, in the order of its inputs. The server reads them back
 * by id, in no order of its own; inputs without ids (a create may leave them to the server) keep
 * the order of the answer.
 */
export function orderLikeInputs<T extends { id: string }>(inputs: readonly unknown[], entities: T[]): T[] {
  const ids = inputs.map((input) => (input as { id?: unknown }).id);

  if (ids.some((id) => typeof id !== 'string')) {
    return entities;
  }

  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  return (ids as string[]).flatMap((id) => byId.get(id) ?? []);
}

function readWriteResult(
  kind: SourceMutationKind,
  binding: SourceMutationBinding,
  input: unknown,
  result: unknown,
): unknown {
  switch (kind) {
    case 'createMany':
    case 'updateMany': {
      return orderLikeInputs(input as unknown[], result as { id: string }[]);
    }
    case 'deleteMany': {
      return (result as unknown[]).map((item) => readSourceMutationId(binding, item));
    }
    case 'delete': {
      return readSourceMutationId(binding, result);
    }
    default: {
      return result;
    }
  }
}

/**
 * Write accessors for the mutations the generator bound to this source. A create/update answers
 * with the entity in the source's fragment shape, a delete with the id it removed; the `*Many`
 * kinds do the same for a list, in one mutation. Nothing is cached here — `@contello/store`
 * collections take the same payload into their cache.
 */
function createSourceWriters(
  name: string,
  def: SourceDef,
  transport: SourceTransport,
): Record<string, (input: unknown, options?: Options) => Promise<unknown>> {
  const out: Record<string, (input: unknown, options?: Options) => Promise<unknown>> = {};

  for (const kind of WRITE_KINDS) {
    const binding = def.mutations?.[kind];

    if (!binding) {
      continue;
    }

    const doc = createSourceMutation(def, kind);

    out[kind] = (input: unknown, options?: Options) => {
      const { values, count } = readWriteInput(kind, input);

      // nothing to write: the server is not asked
      if (count === 0) {
        return Promise.resolve([]);
      }

      const variables = createSourceMutationVariables(binding, values);

      return wrap(
        `source:${name}:${kind}`,
        async () => {
          const response = await transport.write<{ result: unknown }>(doc, variables, options);

          if (response?.result === undefined || response.result === null) {
            throw new Error(`@contello/client: ${kind} on source "${name}" returned no entity`);
          }

          return readWriteResult(kind, binding, input, response.result);
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
  if (def.__cardinality === 'singleton') {
    return {
      fetch: (options?: Options) =>
        wrap(
          `source:${name}`,
          async () => {
            const response = await transport.readOne<{ source: unknown }>(doc, undefined, options);

            return response.source;
          },
          graphqlOperationAttributes(doc),
        ),
    };
  }

  // what each kind of list can be narrowed to; the rest of the request are the options of the call
  const filterOf: Record<Exclude<SourceDef['__cardinality'], 'singleton'>, (request: ListRequest) => Variables> = {
    entity: ({ ids }) => ({ ids }),
    route: ({ ids, paths }) => ({ ids, paths }),
    asset: ({ ids }) => ({ ids }),
    i18nMessage: ({ collection, ids }) => ({ collection, ids }),
  };

  const readFilter = filterOf[def.__cardinality];

  return {
    fetch: (request?: ListRequest | undefined) => {
      const variables = transformVariables(readFilter(request ?? {})) ?? {};

      return wrap(
        `source:${name}`,
        () => collectSource(transport, doc, variables, request?.signal ? { signal: request.signal } : undefined),
        graphqlOperationAttributes(doc, variables),
      );
    },
  };
}
