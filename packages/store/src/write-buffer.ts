/**
 * Entities answered by a write, parked until the refresh that write schedules takes them into the
 * cache. A write mutation selects the source's fragment, so it comes back in exactly the shape the
 * subscription yields and the refresh can be served from here instead of going over the wire — the
 * entity still travels the one path that maps it, collects its dependencies, sorts and freezes it.
 *
 * A parked entity is a shortcut, never an authority. `ProjectedMap` debounces and coalesces partial
 * refreshes, so a refresh that some *other* change scheduled can be the one that consumes it —
 * answering an upstream event out of the local write and silently dropping the remote change until
 * the next full refresh. `awaitingUpstream` closes that window from both sides: it drops what is
 * already parked for those ids and refuses to park them again until the upstream refresh settles,
 * whichever of the two arrives first.
 *
 * `release` covers the rest: an id that was deleted, and a write whose own refresh failed — which
 * would otherwise leave the entity here to answer some unrelated partial refresh much later.
 */
export type WriteBuffer<T> = {
  /** Parks a written entity — ignored while an upstream refresh for that id is outstanding. */
  park(id: string, entity: T): void;
  release(ids: Iterable<string>): void;
  clear(): void;
  /** Splits requested ids into what this buffer answers (consuming it) and what must be fetched. */
  take(ids: readonly string[]): { written: T[]; missing: string[] };
  /**
   * Marks ids whose server version is being refetched, so nothing local answers that refresh.
   * Returns the function that unmarks them once it has settled.
   */
  awaitingUpstream(ids: readonly string[]): () => void;
};

export function createWriteBuffer<T>(): WriteBuffer<T> {
  const parked = new Map<string, T>();
  // refresh counts, not flags — refreshes for the same id can overlap and must each unmark once
  const awaited = new Map<string, number>();

  return {
    park(id, entity) {
      if (!awaited.has(id)) {
        parked.set(id, entity);
      }
    },

    release(ids) {
      for (const id of ids) {
        parked.delete(id);
      }
    },

    clear() {
      parked.clear();
    },

    take(ids) {
      const written: T[] = [];
      const missing: string[] = [];

      for (const id of ids) {
        const entity = parked.get(id);

        if (entity === undefined) {
          missing.push(id);
        } else {
          parked.delete(id);
          written.push(entity);
        }
      }

      return { written, missing };
    },

    awaitingUpstream(ids) {
      for (const id of ids) {
        parked.delete(id);
        awaited.set(id, (awaited.get(id) ?? 0) + 1);
      }

      return () => {
        for (const id of ids) {
          const count = awaited.get(id) ?? 0;

          if (count > 1) {
            awaited.set(id, count - 1);
          } else {
            awaited.delete(id);
          }
        }
      };
    },
  };
}
