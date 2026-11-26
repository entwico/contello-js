import type { SourceDef } from '@contello/client';
import { createFakeContelloClient } from '@contello/client/testing';
import { type AsyncIterableSubject, createAsyncIterableSubject } from '@entwico/dash/async';
import { countAlive } from '@entwico/dash/testing';
import { runInContexts } from '@entwico/dash/testing/node';
import { afterEach, describe, expect, test } from 'vitest';

import { createCollection } from './collection';
import { createLazyCollection } from './lazy-collection';
import { ModelResolver } from './model-resolver';
import { createSingleton } from './singleton';
import type { RefreshKind } from './types';
import { createRefreshByTtlQueue } from './utils';
import { type UpdateBatch, createInternalWatcher } from './watcher';
import { createWriteBuffer } from './write-buffer';

// what must not stay in memory once it is replaced or removed: a store lives for the life of the
// process, so whatever it keeps of one fetch, one update or one request, it keeps of all of them

/** Waits for `action` and drops its result: a test that awaited it itself would be what keeps it in memory. */
async function settled(action: () => unknown): Promise<void> {
  await action();
}

type Item = { id: string; payload: number[] };

const entitySource: SourceDef<'thing', 'entity', Item> = {
  document: '',
  fragment: 'Thing',
  subscription: 'things',
  __model: 'thing',
  __cardinality: 'entity',
};

const singletonSource: SourceDef<'settings', 'singleton', Item> = {
  document: '',
  fragment: 'Settings',
  subscription: 'settings',
  __model: 'settings',
  __cardinality: 'singleton',
};

const ids = ['a', 'b', 'c'];

/** Contello as the store sees it: every fetch answers with new entities, which only the weak references remember. */
function createBackend(cardinality: 'entity' | 'singleton' = 'entity') {
  const fetched = new Map<string, WeakRef<Item>[]>();
  let present = ids;
  let failing = false;
  let fetches = 0;

  function fetch(id: string): Item {
    const item: Item = { id, payload: Array.from({ length: 1000 }, () => 0) };

    fetched.set(id, [...(fetched.get(id) ?? []), new WeakRef(item)]);

    return item;
  }

  const { client } = createFakeContelloClient({
    subscribe(_query, variables) {
      fetches++;

      if (failing) {
        throw new Error('contello is down');
      }

      if (cardinality === 'singleton') {
        return { source: fetch('a') };
      }

      // a lazy collection asks for ids nobody listed before
      const requested = (variables?.['ids'] as string[] | undefined)?.filter(
        (id) => !ids.includes(id) || present.includes(id),
      ) ?? present;

      return { source: requested.map((id) => fetch(id)) };
    },
  });

  return {
    client,
    remove: (id: string) => void (present = present.filter((other) => other !== id)),
    fail: () => void (failing = true),
    fetches: () => fetches,
    /** Every version of the entity that was fetched, oldest first. */
    versions: (id: string): WeakRef<Item>[] => fetched.get(id) ?? [],
    all: (): WeakRef<Item>[] => fetched.values().toArray().flat(),
  };
}

function entityBatch(id: string, mutation: 'update' | 'delete'): UpdateBatch {
  return {
    entity: new Map([['thing', [{ id, mutation, target: 'entity', model: 'thing' }]]]),
    events: [],
    route: [],
    asset: [],
    i18nMessage: [],
    routeByEntityModel: new Map(),
  } as unknown as UpdateBatch;
}

function singletonBatch(): UpdateBatch {
  return {
    ...entityBatch('a', 'update'),
    entity: new Map([['settings', [{ id: 'a', mutation: 'update', target: 'entity', model: 'settings' }]]]),
  } as unknown as UpdateBatch;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** The updates of the watcher: it outlives every collection that listens to it. */
function createUpdates(): AsyncIterableSubject<UpdateBatch> {
  return createAsyncIterableSubject<UpdateBatch>();
}

function startCollection() {
  const backend = createBackend();
  const updates$ = createUpdates();
  const refreshes: RefreshKind[] = [];

  const { instance, destroy } = createCollection(
    entitySource,
    { onRefresh: (event) => void refreshes.push(event.kind) },
    backend.client,
    updates$,
    new ModelResolver(undefined),
    createRefreshByTtlQueue(),
  );

  cleanups.push(destroy);

  return { backend, updates$, collection: instance, refreshes, destroy };
}

function startLazyCollection(max?: number | undefined) {
  const backend = createBackend();
  const updates$ = createUpdates();

  const { instance, destroy } = createLazyCollection(
    entitySource,
    max === undefined ? undefined : { cache: { max } },
    backend.client,
    updates$,
    new ModelResolver(undefined),
  );

  cleanups.push(destroy);

  return { backend, updates$, collection: instance, destroy };
}

function startSingleton() {
  const backend = createBackend('singleton');
  const updates$ = createUpdates();
  const refreshes: RefreshKind[] = [];

  const { instance, destroy } = createSingleton(
    singletonSource,
    { onRefresh: (event) => void refreshes.push(event.kind) },
    backend.client,
    updates$,
    new ModelResolver(undefined),
    createRefreshByTtlQueue(),
  );

  cleanups.push(destroy);

  return { backend, updates$, singleton: instance, refreshes, destroy };
}

describe('a collection that stays in use', () => {
  test('keeps the entities it serves', async () => {
    const { backend, collection } = startCollection();

    await collection.load();

    expect(await countAlive(backend.all())).toBe(3);
  });

  test('keeps nothing of the entities that a refresh replaced', async () => {
    const { backend, collection, refreshes } = startCollection();

    await collection.load();

    const replaced = backend.all();

    collection.refresh();
    await expect.poll(() => refreshes).toEqual(['on-demand']);

    expect(await countAlive(replaced)).toBe(0);
  });

  test('keeps nothing of an entity that an update replaced', async () => {
    const { backend, collection, updates$, refreshes } = startCollection();

    await collection.load();
    updates$.next(entityBatch('a', 'update'));
    await expect.poll(() => refreshes).toEqual(['upstream-update']);

    expect(backend.versions('a')).toHaveLength(2);
    expect(await countAlive(backend.versions('a').slice(0, 1))).toBe(0);
  });

  test('keeps nothing of an entity that an update deleted', async () => {
    const { backend, collection, updates$, refreshes } = startCollection();

    await collection.load();
    backend.remove('a');
    updates$.next(entityBatch('a', 'delete'));
    await expect.poll(() => refreshes).toEqual(['upstream-update']);

    expect(await countAlive(backend.versions('a'))).toBe(0);
  });

  test('keeps nothing of the request that loaded it', async () => {
    const { collection } = startCollection();

    const contexts = await runInContexts(3, () => collection.getAll());

    expect(await countAlive(contexts)).toBe(0);
  });

  test('keeps nothing of the requests that read it, updates in between', async () => {
    const { collection, updates$, refreshes } = startCollection();

    await collection.load();

    const contexts = await runInContexts(30, async () => {
      const seen = refreshes.length;

      await collection.get('a');
      await collection.getAll();
      updates$.next(entityBatch('a', 'update'));
      collection.refresh();
      await expect.poll(() => refreshes.length).toBeGreaterThan(seen);
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('a lazy collection that stays in use', () => {
  test('keeps no more entities than its limit', async () => {
    const { backend, collection } = startLazyCollection(5);

    for (let id = 0; id < 50; id++) {
      await settled(() => collection.get(`entity-${id}`));
    }

    expect(backend.all()).toHaveLength(50);
    expect(await countAlive(backend.all())).toBe(5);
  });

  test('keeps nothing of an entity that an update evicted', async () => {
    const { backend, collection, updates$ } = startLazyCollection();

    await settled(() => collection.get(ids));
    updates$.next(entityBatch('a', 'update'));

    expect(await countAlive(backend.versions('a'))).toBe(0);
    expect(await countAlive(backend.all())).toBe(2);
  });

  test('keeps nothing of an entity that a refresh replaced or no longer found', async () => {
    const { backend, collection } = startLazyCollection();
    let refreshed = false;

    void (async () => {
      for await (const _event of collection.refresh$) {
        refreshed = true;
      }
    })();

    await settled(() => collection.get(ids));
    backend.remove('b');
    collection.refresh();
    await expect.poll(() => refreshed).toBe(true);

    expect(await countAlive([...backend.versions('a').slice(0, 1), ...backend.versions('b')])).toBe(0);
  });

  test('keeps nothing of entities that were cleared', async () => {
    const { backend, collection } = startLazyCollection();

    await settled(() => collection.get(ids));
    collection.clear();

    expect(await countAlive(backend.all())).toBe(0);
  });

  test('keeps nothing of the requests that read it', async () => {
    const { collection, updates$ } = startLazyCollection(2);
    let id = 0;

    const contexts = await runInContexts(30, async () => {
      await Promise.all([collection.get('a'), collection.get(['a', 'b']), collection.get(`entity-${id++}`)]);
      updates$.next(entityBatch('a', 'update'));
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('a singleton that stays in use', () => {
  test('keeps nothing of a value that a refresh replaced', async () => {
    const { backend, singleton, refreshes } = startSingleton();

    await singleton.load();
    singleton.refresh();
    await expect.poll(() => refreshes).toEqual(['on-demand']);

    expect(await countAlive(backend.versions('a').slice(0, 1))).toBe(0);
  });

  test('keeps nothing of a value that an update replaced', async () => {
    const { backend, singleton, updates$, refreshes } = startSingleton();

    await singleton.load();
    updates$.next(singletonBatch());
    await expect.poll(() => refreshes).toEqual(['upstream-update']);

    expect(await countAlive(backend.versions('a').slice(0, 1))).toBe(0);
  });

  test('keeps nothing of the request that loaded it', async () => {
    const { singleton } = startSingleton();

    const contexts = await runInContexts(3, () => singleton.get());

    expect(await countAlive(contexts)).toBe(0);
  });

  test('keeps nothing of the requests that read it, updates in between', async () => {
    const { singleton, updates$, refreshes } = startSingleton();

    await singleton.load();

    const contexts = await runInContexts(30, async () => {
      const seen = refreshes.length;

      await singleton.get();
      updates$.next(singletonBatch());
      await expect.poll(() => refreshes.length).toBeGreaterThan(seen);
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('what was destroyed, while the updates it listened to go on', () => {
  // everything of the collection lives in these frames only: a test that held it would be what keeps it
  async function destroyedCollection(updates: AsyncIterableSubject<UpdateBatch>[]): Promise<WeakRef<object>[]> {
    const { backend, updates$, collection, destroy } = startCollection();

    await collection.load();
    updates.push(updates$);
    destroy();

    return [new WeakRef(collection), ...backend.all()];
  }

  async function destroyedLazyCollection(updates: AsyncIterableSubject<UpdateBatch>[]): Promise<WeakRef<object>[]> {
    const { backend, updates$, collection, destroy } = startLazyCollection();

    await collection.get(ids);
    updates.push(updates$);
    destroy();

    return [new WeakRef(collection), ...backend.all()];
  }

  async function destroyedSingleton(updates: AsyncIterableSubject<UpdateBatch>[]): Promise<WeakRef<object>[]> {
    const { backend, updates$, singleton, destroy } = startSingleton();

    await singleton.load();
    updates.push(updates$);
    destroy();

    return [new WeakRef(singleton), ...backend.all()];
  }

  test.each([
    ['a collection', destroyedCollection],
    ['a lazy collection', destroyedLazyCollection],
    ['a singleton', destroyedSingleton],
  ] as const)('%s is collected, with what it served', async (_name, destroyed) => {
    const updates: AsyncIterableSubject<UpdateBatch>[] = [];
    const refs = await destroyed(updates);

    // the test must not be what keeps it either
    cleanups.length = 0;

    expect(await countAlive(refs)).toBe(0);
    expect(updates).toHaveLength(1);
  });
});

describe('what was destroyed while its source kept failing', () => {
  // a refresh that fails is retried, with a wait of over a second before the first retry
  async function destroyedCollection(): Promise<{ refs: WeakRef<object>[]; fetches: () => number }> {
    const { backend, updates$, collection, destroy } = startCollection();

    await collection.load();
    backend.fail();
    updates$.next(entityBatch('a', 'update'));
    collection.refresh();
    await expect.poll(() => backend.fetches()).toBeGreaterThan(1);
    destroy();

    return { refs: [new WeakRef(collection), ...backend.all()], fetches: backend.fetches };
  }

  async function destroyedSingleton(): Promise<{ refs: WeakRef<object>[]; fetches: () => number }> {
    const { backend, updates$, singleton, destroy } = startSingleton();

    await singleton.load();
    backend.fail();
    updates$.next(singletonBatch());
    await expect.poll(() => backend.fetches()).toBeGreaterThan(1);
    destroy();

    return { refs: [new WeakRef(singleton), ...backend.all()], fetches: backend.fetches };
  }

  async function destroyedLazyCollection(): Promise<{ refs: WeakRef<object>[]; fetches: () => number }> {
    const { backend, collection, destroy } = startLazyCollection();

    await collection.get(ids);
    backend.fail();
    collection.refresh();
    await expect.poll(() => backend.fetches()).toBeGreaterThan(1);
    destroy();

    return { refs: [new WeakRef(collection), ...backend.all()], fetches: backend.fetches };
  }

  test.each([
    ['a collection', destroyedCollection],
    ['a lazy collection', destroyedLazyCollection],
    ['a singleton', destroyedSingleton],
  ] as const)('%s stops retrying and is collected', async (_name, destroyed) => {
    const { refs, fetches } = await destroyed();
    const fetchesAtDestroy = fetches();

    // the test must not be what keeps it either
    cleanups.length = 0;

    expect(await countAlive(refs)).toBe(0);

    // long enough for the retry that was waiting
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(fetches()).toBe(fetchesAtDestroy);
  });
});

describe('a watcher that was stopped', () => {
  // contello has nothing to say for as long as nothing changes: the subscription just stays open
  function startWatcher() {
    const updates = createAsyncIterableSubject<unknown>();
    const fake = createFakeContelloClient({ subscribe: () => updates });
    const watcher = createInternalWatcher(fake.client, new ModelResolver(undefined));

    watcher.start();

    return { watcher, open: fake.open, calls: fake.calls };
  }

  test('closes its subscription, though no update arrived', async () => {
    const { watcher, open, calls } = startWatcher();

    await expect.poll(() => open()).toBe(1);
    watcher.stop();

    await expect.poll(() => open()).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test('is collected', async () => {
    const stopped = await (async () => {
      const { watcher, open } = startWatcher();

      await expect.poll(() => open()).toBe(1);
      watcher.stop();

      return [new WeakRef(watcher), new WeakRef(watcher.updates$)];
    })();

    expect(await countAlive(stopped)).toBe(0);
  });
});

describe('a write buffer that stays in use', () => {
  function park(buffer: ReturnType<typeof createWriteBuffer<Item>>, id: string): WeakRef<object> {
    const entity: Item = { id, payload: Array.from({ length: 1000 }, () => 0) };

    buffer.park(id, entity);

    return new WeakRef(entity);
  }

  test('keeps a written entity until a refresh takes it', async () => {
    const buffer = createWriteBuffer<Item>();
    const written = [park(buffer, 'a')];

    expect(await countAlive(written)).toBe(1);

    expect(buffer.take(['a']).written).toHaveLength(1);

    expect(await countAlive(written)).toBe(0);
  });

  test('keeps nothing of a written entity that was released, cleared or overruled by upstream', async () => {
    const buffer = createWriteBuffer<Item>();
    const written = [park(buffer, 'a'), park(buffer, 'b'), park(buffer, 'c'), park(buffer, 'd')];

    buffer.release(['a']);

    const settle = buffer.awaitingUpstream(['b']);

    written.push(park(buffer, 'b'));
    settle();
    buffer.clear();

    expect(await countAlive(written)).toBe(0);
  });
});
