import { describe, expect, test, vi } from 'vitest';

import { DependencyCollector } from './dependency-collector';
import { ModelResolver } from './model-resolver';
import type { StoreRoute } from './routes-mapping';
import type { UpdateEvent } from './watcher';

const resolver = new ModelResolver({ article: 'ArticleEntity', product: 'ProductEntity' });

function entityEvent(model: string, id: string): UpdateEvent {
  return { id, mutation: 'update', target: 'entity', model };
}

function assetEvent(id: string): UpdateEvent {
  return { id, mutation: 'update', target: 'asset' };
}

function entityRouteTarget(model: string, entityId: string): StoreRoute {
  return {
    id: 'route-x',
    path: '/x',
    customHeaders: [],
    type: 'entity',
    model,
    entityType: 'X',
    entityId,
  };
}

describe('DependencyCollector track auto-detection', () => {
  test('track detects assets, routes, and entities by __typename', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.track({ __typename: 'ContelloAsset', id: 'asset-1' });
      ref.track({ __typename: 'ContelloRoute', id: 'route-1' });
      ref.track({ __typename: 'ArticleEntity', id: 'entity-1' });
      register('item-1');
    });

    expect([...collector.getAffectedKeys(assetEvent('asset-1'))]).toEqual(['item-1']);
    expect([...collector.getAffectedKeys({ id: 'route-1', mutation: 'delete', target: 'route' })]).toEqual([
      'item-1',
    ]);
    expect([...collector.getAffectedKeys(entityEvent('article', 'entity-1'))]).toEqual(['item-1']);
  });

  test('track throws when the object has no id', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    expect(() =>
      collector.createContext((ref, register) => {
        ref.track({ __typename: 'ContelloAsset', id: '' });
        register('item-1');
      }),
    ).toThrow(/no "id" field/);
  });

  test('track throws for an unrecognized __typename', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    expect(() =>
      collector.createContext((ref, register) => {
        ref.track({ __typename: 'SomethingElse', id: 'x' });
        register('item-1');
      }),
    ).toThrow(/unexpected __typename/);
  });
});

describe('DependencyCollector explicit tracking', () => {
  test('trackAsset / trackRoute / trackEntity register deps', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      ref.trackRoute('route-1');
      ref.trackEntity('article', 'entity-1');
      register('item-1');
    });

    expect([...collector.getAffectedKeys(assetEvent('asset-1'))]).toEqual(['item-1']);
    expect([...collector.getAffectedKeys(entityEvent('article', 'entity-1'))]).toEqual(['item-1']);
  });

  test('trackEntity warns when the model is not known to the resolver', () => {
    const collector = new DependencyCollector<string>('post', resolver);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    collector.createContext((ref, register) => {
      ref.trackEntity('nonexistent' as 'article', 'entity-1');
      register('item-1');
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));

    warn.mockRestore();
  });

  test('multiple items depending on one entity are all reported', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    for (const key of ['a', 'b']) {
      collector.createContext((ref, register) => {
        ref.trackEntity('article', 'shared');
        register(key);
      });
    }

    expect([...collector.getAffectedKeys(entityEvent('article', 'shared'))].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('DependencyCollector route-target interest', () => {
  test('a route now pointing at an item of this collection affects that item', () => {
    const collector = new DependencyCollector<string>('article', resolver);

    collector.createContext((_ref, register) => register('item-1'));

    const event: UpdateEvent = {
      id: 'route-x',
      mutation: 'update',
      target: 'route',
      after: entityRouteTarget('article', 'item-1'),
      before: entityRouteTarget('article', 'other'),
    };

    expect([...collector.getAffectedKeys(event)]).toEqual(['item-1']);
  });

  test('the previous route target is also considered on update', () => {
    const collector = new DependencyCollector<string>('article', resolver);

    collector.createContext((_ref, register) => register('item-1'));

    const event: UpdateEvent = {
      id: 'route-x',
      mutation: 'update',
      target: 'route',
      after: entityRouteTarget('article', 'other'),
      before: entityRouteTarget('article', 'item-1'),
    };

    expect([...collector.getAffectedKeys(event)]).toEqual(['item-1']);
  });
});

describe('DependencyCollector index maintenance', () => {
  test('getAffectedKeys returns an empty set for an unrelated event', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      register('item-1');
    });

    expect(collector.getAffectedKeys(assetEvent('other')).size).toBe(0);
  });

  test('re-registering an item replaces its previous deps', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      register('item-1');
    });

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-2');
      register('item-1');
    });

    expect(collector.getAffectedKeys(assetEvent('asset-1')).size).toBe(0);
    expect([...collector.getAffectedKeys(assetEvent('asset-2'))]).toEqual(['item-1']);
  });

  test('removeItem drops all deps for the item', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      register('item-1');
    });

    collector.removeItem('item-1');

    expect(collector.getAffectedKeys(assetEvent('asset-1')).size).toBe(0);
  });

  test('clear wipes the whole index', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      register('item-1');
    });
    collector.createContext((ref, register) => {
      ref.trackAsset('asset-2');
      register('item-2');
    });

    collector.clear();

    expect(collector.getAffectedKeys(assetEvent('asset-1')).size).toBe(0);
    expect(collector.getAffectedKeys(assetEvent('asset-2')).size).toBe(0);
  });

  test('retainOnly prunes items not in the retained set', () => {
    const collector = new DependencyCollector<string>('post', resolver);

    collector.createContext((ref, register) => {
      ref.trackAsset('asset-1');
      register('item-1');
    });
    collector.createContext((ref, register) => {
      ref.trackAsset('asset-2');
      register('item-2');
    });

    collector.retainOnly(new Set(['item-1']));

    expect([...collector.getAffectedKeys(assetEvent('asset-1'))]).toEqual(['item-1']);
    expect(collector.getAffectedKeys(assetEvent('asset-2')).size).toBe(0);
  });
});
