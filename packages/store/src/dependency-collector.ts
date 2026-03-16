import type { UpdateEvent } from './watcher';

type NonEntityTarget = Exclude<UpdateEvent['target'], 'entity'>;

/**
 * passed to `map()` so the mapper can declare which external entities this item depends on.
 * calls are collected during mapping and indexed once the item key is known.
 * designed to be destructurable: `map(raw, { track, trackRoute }) => ...`
 *
 * `track()` inspects `__typename` to auto-detect the dependency type:
 *   - `ContelloAsset` → asset dep
 *   - `ContelloRoute` → route dep
 *   - `*Entity` → entity dep
 *   - anything else → throws
 *
 * explicit methods (`trackEntity`, `trackAsset`, `trackRoute`) are available
 * for cases where only an id is known without the full GraphQL object.
 */
export type MapperContext<TEntityTypes extends string = string> = {
  track(obj: { __typename: string; id: string }): void;
  trackEntity(typename: TEntityTypes, id: string): void;
  trackAsset(id: string): void;
  trackRoute(id: string): void;
};

// dep key for non-entity targets (route, asset) — `${target}\0${id}`
function createDependencyKey(target: NonEntityTarget, id: string): string {
  return `${target}\0${id}`;
}

// dep key for entity deps — prefixed with `entity\0` to avoid collisions with other targets
// e.g. a model named 'route' would otherwise collide with ref.route() deps
function createEntityDependencyKey(typename: string, id: string): string {
  return `entity\0${typename}\0${id}`;
}

// key used to register and look up route-target interest deps.
// separate from createDependencyKey because the value is a compound (typename \0 id) pair itself.
function createRouteTargetKey(typename: string, id: string): string {
  return `routeTarget\0${typename}\0${id}`;
}

/**
 * bidirectional dependency index for a single collection.
 *
 * during each map cycle, `createContext` is called per item. it creates a `MapperContext` the mapper
 * uses to declare cross-entity dependencies, and a `register(key)` function the caller invokes
 * once the item key is known. `register` flushes the collected deps into two maps:
 *
 *   forwardIndex:  item key  ->  set of dep keys it declared
 *   reverseIndex:  dep key   ->  set of item keys that declared it
 *
 * the reverse map is the hot path: given an update event (typename + id), `getAffectedKeys()`
 * looks up the dep key and returns all item keys that need to be invalidated.
 *
 * lifecycle per map cycle:
 *   1. createContext(fn)  — allocates deps array, creates MapperContext, calls fn(ctx, register)
 *   2. fn calls map(raw, ctx)  — mapper runs, calls track methods, fills deps array
 *   3. fn calls register(key)  — real item key is known, deps written into both maps
 */
export class DependencyCollector<TKey, TEntityTypes extends string = string> {
  /** dep key -> item keys that declared a dependency on it */
  private reverseIndex = new Map<string, Set<TKey>>();
  /** item key -> dep keys it currently declares */
  private forwardIndex = new Map<TKey, Set<string>>();

  constructor(
    /** the model typename of the owning collection, used to form route-target dep keys */
    private readonly model: string,
    /** known entity types — used to warn when tracking an entity type that the watcher ignores */
    private readonly entityTypes: ReadonlySet<string> | undefined,
  ) {}

  /**
   * creates a scoped MapperContext for one item and runs `fn` with it.
   * `fn` receives the context (for declaring deps during mapping) and a `register(key)` function
   * that must be called once the item key is known — it writes all declared deps into the index.
   * returns whatever `fn` returns, preserving MaybePromise semantics.
   */
  createContext<T>(fn: (ctx: MapperContext<TEntityTypes>, register: (key: TKey) => void) => T): T {
    const deps: string[] = [];

    const ctx: MapperContext<TEntityTypes> = {
      track: (obj) => {
        if (!obj.id) {
          throw new Error(`track(): object with __typename "${obj.__typename}" has no "id" field`);
        }

        switch (obj.__typename) {
          case 'ContelloAsset':
            deps.push(createDependencyKey('asset', obj.id));
            break;
          case 'ContelloRoute':
            deps.push(createDependencyKey('route', obj.id));
            break;
          default:
            if (!obj.__typename.endsWith('Entity')) {
              throw new Error(
                `track(): unexpected __typename "${obj.__typename}" — expected ContelloAsset, ContelloRoute, or *Entity`,
              );
            }

            this.warnIfUnknownEntityType(obj.__typename);
            deps.push(createEntityDependencyKey(obj.__typename, obj.id));
        }
      },
      trackEntity: (typename, id) => {
        this.warnIfUnknownEntityType(typename);
        deps.push(createEntityDependencyKey(typename, id));
      },
      trackAsset: (id) => deps.push(createDependencyKey('asset', id)),
      trackRoute: (id) => deps.push(createDependencyKey('route', id)),
    };

    const register = (key: TKey) => {
      this.clearItem(key);

      deps.push(createRouteTargetKey(this.model, String(key)));

      const fwd = new Set<string>();

      for (const dk of deps) {
        fwd.add(dk);

        let set = this.reverseIndex.get(dk);

        if (!set) {
          set = new Set();
          this.reverseIndex.set(dk, set);
        }

        set.add(key);
      }

      if (fwd.size > 0) {
        this.forwardIndex.set(key, fwd);
      }
    };

    return fn(ctx, register);
  }

  /**
   * looks up which item keys are affected by an update event.
   * for route events, checks route-target deps for both the new and previous entity targets.
   */
  getAffectedKeys(event: UpdateEvent): Set<TKey> {
    if (event.target === 'entity') {
      return this.reverseIndex.get(createEntityDependencyKey(event.model, event.id)) ?? new Set();
    }

    let affected = this.reverseIndex.get(createDependencyKey(event.target, event.id));

    if (event.target === 'route') {
      if ('after' in event && event.after.type === 'entity') {
        affected = this.mergeRouteTargetKeys(affected, event.after.entityType, event.after.entityId);
      }

      if ('before' in event && event.before.type === 'entity') {
        affected = this.mergeRouteTargetKeys(affected, event.before.entityType, event.before.entityId);
      }
    }

    return affected ?? new Set();
  }

  private mergeRouteTargetKeys(
    existing: Set<TKey> | undefined,
    entityType: string,
    entityId: string,
  ): Set<TKey> | undefined {
    const items = this.reverseIndex.get(createRouteTargetKey(entityType, entityId));

    if (!items) {
      return existing;
    }

    return existing ? new Set([...existing, ...items]) : items;
  }

  /** removes all recorded deps for a single item (called on eviction) */
  removeItem(key: TKey): void {
    this.clearItem(key);
  }

  /** drops all recorded deps — used when clearing the entire cache */
  clear(): void {
    this.reverseIndex.clear();
    this.forwardIndex.clear();
  }

  /**
   * removes index entries for any item key NOT present in `keys`.
   * called after a full re-fetch to prune refs from items that were deleted upstream.
   */
  retainOnly(keys: Set<TKey>): void {
    for (const key of this.forwardIndex.keys()) {
      if (!keys.has(key)) {
        this.clearItem(key);
      }
    }
  }

  private warnIfUnknownEntityType(typename: string): void {
    if (this.entityTypes && !this.entityTypes.has(typename)) {
      console.warn(
        `[contello/store] tracking entity type "${typename}" which is not in entityTypes — updates for this type will be ignored`,
      );
    }
  }

  /**
   * removes all index entries for one item key.
   * cleans up the forward entry and removes the item from every reverse set it appeared in.
   * if a reverse set becomes empty after removal, it is deleted to avoid memory leaks.
   */
  private clearItem(key: TKey): void {
    const existingDeps = this.forwardIndex.get(key);

    if (!existingDeps) {
      return;
    }

    for (const dk of existingDeps) {
      const set = this.reverseIndex.get(dk);

      if (set) {
        set.delete(key);

        if (set.size === 0) {
          this.reverseIndex.delete(dk);
        }
      }
    }

    this.forwardIndex.delete(key);
  }
}
