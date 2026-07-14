import { describe, expect, test } from 'vitest';

import type { StoreRouteFragment } from './generated/graphql';
import { ModelResolver } from './model-resolver';
import { mapRoute } from './routes-mapping';

const resolver = new ModelResolver({ article: 'ArticleEntity' });

type RouteOverrides = Partial<{ id: string; path: string; headers: { name: string; value: string }[] }>;

function route(target: unknown, overrides?: RouteOverrides): StoreRouteFragment {
  return {
    id: overrides?.id ?? 'r1',
    path: overrides?.path ?? '/some/path',
    customHeaders: overrides?.headers ?? [],
    target,
  } as unknown as StoreRouteFragment;
}

describe('mapRoute', () => {
  test('maps a redirect target', () => {
    const result = mapRoute(
      route({ __typename: 'ContelloRouteTargetRedirect', location: '/elsewhere', responseCode: 301 }),
      resolver,
    );

    expect(result).toEqual({
      id: 'r1',
      path: '/some/path',
      customHeaders: [],
      type: 'redirect',
      location: '/elsewhere',
      status: 301,
    });
  });

  test('maps a text target', () => {
    const result = mapRoute(
      route({ __typename: 'ContelloRouteTargetText', content: 'hello', mimeType: 'text/plain' }),
      resolver,
    );

    expect(result).toMatchObject({ type: 'text', content: 'hello', mimeType: 'text/plain' });
  });

  test('maps an inline asset target', () => {
    const result = mapRoute(
      route({
        __typename: 'ContelloRouteTargetAsset',
        contentDisposition: 'INLINE',
        asset: { id: 'a1', original: { uid: 'file-1', mimeType: 'image/png' } },
      }),
      resolver,
    );

    expect(result).toMatchObject({
      type: 'asset',
      assetId: 'a1',
      fileId: 'file-1',
      contentDisposition: 'inline',
      mimeType: 'image/png',
    });
  });

  test('maps a non-inline asset target to attachment disposition', () => {
    const result = mapRoute(
      route({
        __typename: 'ContelloRouteTargetAsset',
        contentDisposition: 'ATTACHMENT',
        asset: { id: 'a1', original: { uid: 'file-1', mimeType: 'application/pdf' } },
      }),
      resolver,
    );

    expect(result).toMatchObject({ contentDisposition: 'attachment' });
  });

  test('maps an entity target and resolves the model', () => {
    const result = mapRoute(
      route({ __typename: 'ContelloRouteTargetEntity', entity: { __typename: 'ArticleEntity', id: 'e1' } }),
      resolver,
    );

    expect(result).toMatchObject({
      type: 'entity',
      model: 'article',
      entityType: 'ArticleEntity',
      entityId: 'e1',
    });
  });

  test('returns undefined for an entity target with no entity', () => {
    const result = mapRoute(
      route({ __typename: 'ContelloRouteTargetEntity', entity: null }),
      resolver,
    );

    expect(result).toBeUndefined();
  });

  test('returns undefined for an unknown target type', () => {
    const result = mapRoute(route({ __typename: 'ContelloRouteTargetSomethingNew' }), resolver);

    expect(result).toBeUndefined();
  });

  test('preserves custom headers', () => {
    const result = mapRoute(
      route(
        { __typename: 'ContelloRouteTargetText', content: 'x', mimeType: 'text/plain' },
        { headers: [{ name: 'X-Foo', value: 'bar' }] },
      ),
      resolver,
    );

    expect(result?.customHeaders).toEqual([{ name: 'X-Foo', value: 'bar' }]);
  });
});
