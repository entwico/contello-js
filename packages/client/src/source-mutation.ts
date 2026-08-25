import { transformVariables } from './transform-variables';
import type { SourceDef, SourceMutationBinding, SourceMutations } from './types';

export type SourceMutationKind = keyof SourceMutations;

/** What a write takes: the caller's input, and the id for a delete. */
export type SourceMutationValues = {
  input?: unknown;
  id?: string | undefined;
};

const cache = new WeakMap<SourceDef, Partial<Record<SourceMutationKind, string>>>();

/**
 * A create/update answers with the entity itself, so it selects the source's own fragment — the
 * write comes back in the same shape a read does and needs no follow-up fetch. A delete answers
 * with an id, either wrapped in a response object or, for routes, as a bare scalar.
 */
function createSelection(source: SourceDef, binding: SourceMutationBinding): string {
  const declarations = binding.arguments.map((argument) => `$${argument.name}: ${argument.type}`).join(', ');
  const args = binding.arguments.map((argument) => `${argument.name}: $${argument.name}`).join(', ');
  const selection = { entity: ` { ...${source.fragment} }`, idObject: ' { id }', idScalar: '' }[binding.result];
  const operation = `mutation(${declarations}) { result: ${binding.field}(${args})${selection} }`;

  return binding.result === 'entity' ? `${source.document}\n${operation}` : operation;
}

export function getSourceMutation(source: SourceDef, kind: SourceMutationKind): SourceMutationBinding | undefined {
  return source.mutations?.[kind];
}

/** The mutation document for one write operation of a source. Cached per source + kind. */
export function createSourceMutation(source: SourceDef, kind: SourceMutationKind): string {
  const binding = getSourceMutation(source, kind);

  if (!binding) {
    throw new Error(
      `@contello/client: source "${source.__model}" has no ${kind} mutation — ` +
      `the schema exposes none for this model`,
    );
  }

  const cached = cache.get(source);

  if (cached?.[kind] !== undefined) {
    return cached[kind];
  }

  const doc = createSelection(source, binding);
  const entry = cached ?? {};

  entry[kind] = doc;
  cache.set(source, entry);

  return doc;
}

/**
 * Variables for a write: one per bound argument, the input nested under the envelope field when
 * the argument is a one-field wrapper, and everything encoded on the way out (LocalDate /
 * LocalDateTime structs become wire strings) — every caller goes through here, so no write path
 * can skip the encoding.
 */
export function createSourceMutationVariables(
  binding: SourceMutationBinding,
  values: SourceMutationValues,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};

  for (const argument of binding.arguments) {
    variables[argument.name] =
      argument.from === 'id' ? values.id : (argument.envelope ? { [argument.envelope]: values.input } : values.input);
  }

  return transformVariables(variables);
}

/** Pulls the id out of whatever shape the mutation answered with. */
export function readSourceMutationId(binding: SourceMutationBinding, result: unknown): string {
  return binding.result === 'idScalar' ? (result as string) : (result as { id: string }).id;
}
