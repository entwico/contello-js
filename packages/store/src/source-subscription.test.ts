import type { SourceDef } from '@contello/client';
import { describe, expect, test } from 'vitest';

import { createSourceSubscription } from './source-subscription';

function source(overrides: Partial<SourceDef>): SourceDef {
  return {
    document: 'fragment Category on CategoryEntity { id }',
    fragment: 'Category',
    subscription: 'categoriesBatch',
    __model: 'category',
    __cardinality: 'collection',
    ...overrides,
  };
}

describe('createSourceSubscription', () => {
  test('wraps a collection source in `subscription($ids: [ID!]) { source: <field>(request: { filter: { ids: $ids } }) { ...<Frag> } }`', () => {
    const out = createSourceSubscription(source({}));

    expect(out).toContain('fragment Category on CategoryEntity { id }');
    expect(out).toContain('subscription($ids: [ID!])');
    expect(out).toContain('source: categoriesBatch(request: { filter: { ids: $ids } })');
    expect(out).toContain('{ ...Category }');
  });

  test('wraps a singleton source without `$ids` or request arg', () => {
    const out = createSourceSubscription(
      source({
        document: 'fragment Config on ConfigEntity { brandName }',
        fragment: 'Config',
        subscription: 'config',
        __model: 'config',
        __cardinality: 'singleton',
      }),
    );

    expect(out).toContain('fragment Config on ConfigEntity { brandName }');
    expect(out).toContain('subscription { source: config { ...Config } }');
    expect(out).not.toContain('$ids');
    expect(out).not.toContain('request');
  });

  test('spreads the named fragment even when the document bundles transitive deps first', () => {
    const out = createSourceSubscription(
      source({
        document:
          'fragment Component on ContelloComponent { __typename }\nfragment StaticPage on StaticPageEntity { id }',
        fragment: 'StaticPage',
        subscription: 'staticPagesBatch',
        __model: 'staticPage',
      }),
    );

    // the spread must be the entity fragment, NOT the first one in the bundle
    expect(out).toContain('{ ...StaticPage }');
    expect(out).not.toContain('{ ...Component }');
  });

  test('is idempotent for the same source reference', () => {
    const s = source({});

    expect(createSourceSubscription(s)).toBe(createSourceSubscription(s));
  });
});
