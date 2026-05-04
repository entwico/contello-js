const FLAT_PREFIX = '_flat_';

const MODEL_SUFFIXES = ['Entity', 'Component'];

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
 * transforms a GraphQL response:
 * - resolves `_flat_{field}` refs into nested component arrays
 * - injects `__model` on objects with entity/component `__typename`
 */
export function transformResponse<T>(data: T): T {
  if (data === null || data === undefined || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      transformResponse(item);
    }

    return data;
  }

  const obj = data as Record<string, unknown>;

  // inject __model from __typename
  const typename = obj['__typename'];

  if (typeof typename === 'string') {
    const model = deriveModel(typename);

    if (model) {
      obj['__model'] = model;
    }
  }

  // resolve _flat_ siblings
  const flatKeys = Object.keys(obj).filter((k) => k.startsWith(FLAT_PREFIX));

  for (const flatKey of flatKeys) {
    const fieldKey = flatKey.slice(FLAT_PREFIX.length);
    const flatArray = obj[flatKey] as FlatComponent[] | undefined;
    const refArray = obj[fieldKey] as FlatRef[] | undefined;

    if (!flatArray || !refArray) {
      continue;
    }

    const flatMap = new Map<string, FlatComponent>();

    for (const component of flatArray) {
      if (component._flatId) {
        flatMap.set(component._flatId, component);
      }
    }

    obj[fieldKey] = resolveRefs(refArray, flatMap);
    delete obj[flatKey];
  }

  // recurse into all object values
  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            transformResponse(item);
          }
        }
      } else {
        transformResponse(value);
      }
    }
  }

  return data;
}

function resolveRefs(refs: readonly FlatRef[], flatMap: Map<string, FlatComponent>): FlatComponent[] {
  return refs.flatMap((ref) => {
    if (!ref._flatId) return [];

    const component = flatMap.get(ref._flatId);

    if (!component) return [];

    // ref-arrays may be nested arbitrarily deep inside the resolved component
    // (e.g. items[i].contentSection1) — the `_flat_<field>` companion only ever
    // sits at the owning entity level, so resolve all nested refs against the
    // same flatMap.
    resolveNestedRefs(component, flatMap);

    // inject __model on resolved components
    transformResponse(component);

    return [component];
  });
}

function resolveNestedRefs(value: unknown, flatMap: Map<string, FlatComponent>): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) {
      resolveNestedRefs(item, flatMap);
    }

    return;
  }

  const obj = value as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    const inner = obj[key];

    if (Array.isArray(inner) && inner.length > 0 && (inner[0] as FlatRef | undefined)?._flatId !== undefined) {
      obj[key] = resolveRefs(inner as FlatRef[], flatMap);
    } else if (inner && typeof inner === 'object') {
      resolveNestedRefs(inner, flatMap);
    }
  }
}
