import { decodeLocalDate, decodeLocalDateTime } from './scalars';

const FLAT_PREFIX = '_flat_';
const LDT_PREFIX = '_ldt_';
const LD_PREFIX = '_ld_';

const MODEL_SUFFIXES = ['Entity', 'Component'];

function decodeValue(value: unknown, decoder: (s: string) => unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item, decoder));
  }

  if (typeof value === 'string') {
    return decoder(value);
  }

  return value;
}

type FlatRef = { _flatId?: string | undefined };
type FlatComponent = FlatRef & { __typename?: string | undefined };

function deriveModel(typename: string): string | undefined {
  for (const suffix of MODEL_SUFFIXES) {
    if (typename.endsWith(suffix)) {
      const stripped = typename.slice(0, -suffix.length);

      return stripped.charAt(0).toLowerCase() + stripped.slice(1);
    }
  }

  return undefined;
}

/**
 * transforms a GraphQL response in a single depth-first pass:
 * - resolves `_flat_{field}` companions into nested component arrays (refs are
 *   matched against the companion map by `_flatId`, at any nesting depth — the
 *   companion lists the whole subtree, so one map serves every ref below it)
 * - injects `__model` on objects with entity/component `__typename`
 * - decodes managed scalar aliases (`_ldt_` / `_ld_`) into structured values
 *
 * a `seen` set guards against shared or cyclic references so every object is
 * visited exactly once.
 */
export function transformResponse<T>(data: T): T {
  transformNode(data, undefined, new WeakSet());

  return data;
}

function transformNode(
  value: unknown,
  flatMap: Map<string, FlatComponent> | undefined,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      transformNode(item, flatMap, seen);
    }

    return;
  }

  const obj = value as Record<string, unknown>;

  // inject __model from __typename
  const typename = obj['__typename'];

  if (typeof typename === 'string') {
    const model = deriveModel(typename);

    if (model) {
      obj['__model'] = model;
    }
  }

  // collect `_flat_*` companions into this scope's resolution map, extending any
  // map inherited from an ancestor so refs nested below resolve against the same
  // companion set
  let ownMap: Map<string, FlatComponent> | undefined;

  for (const key of Object.keys(obj)) {
    if (!key.startsWith(FLAT_PREFIX)) {
      continue;
    }

    const flatArray = obj[key] as FlatComponent[] | undefined;

    delete obj[key];

    if (!flatArray) {
      continue;
    }

    if (!ownMap) {
      ownMap = flatMap ? new Map(flatMap) : new Map();
    }

    for (const component of flatArray) {
      if (component._flatId) {
        ownMap.set(component._flatId, component);
      }
    }
  }

  // decode scalar aliases, resolve ref arrays, and recurse — one pass over keys.
  // refs resolve against this object's own companion map if it had `_flat_*`
  // siblings, otherwise against the inherited ancestor map
  const resolveMap = ownMap ?? flatMap;

  for (const key of Object.keys(obj)) {
    if (key.startsWith(LDT_PREFIX)) {
      obj[key.slice(LDT_PREFIX.length)] = decodeValue(obj[key], decodeLocalDateTime);
      delete obj[key];

      continue;
    }

    if (key.startsWith(LD_PREFIX)) {
      obj[key.slice(LD_PREFIX.length)] = decodeValue(obj[key], decodeLocalDate);
      delete obj[key];

      continue;
    }

    const inner = obj[key];

    if (
      resolveMap &&
      Array.isArray(inner) &&
      inner.length > 0 &&
      (inner[0] as FlatRef | undefined)?._flatId !== undefined
    ) {
      obj[key] = resolveRefs(inner as FlatRef[], resolveMap);
    }

    transformNode(obj[key], resolveMap, seen);
  }
}

function resolveRefs(refs: readonly FlatRef[], flatMap: Map<string, FlatComponent>): FlatComponent[] {
  const resolved: FlatComponent[] = [];

  for (const ref of refs) {
    if (!ref._flatId) {
      continue;
    }

    const component = flatMap.get(ref._flatId);

    if (component) {
      resolved.push(component);
    }
  }

  return resolved;
}
