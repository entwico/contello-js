import { describe, expect, test } from 'vitest';

import { ModelResolver } from './model-resolver';

describe('ModelResolver without models', () => {
  const resolver = new ModelResolver(undefined);

  test('hasTypeName accepts any type name', () => {
    expect(resolver.hasTypeName('AnythingEntity')).toBe(true);
    expect(resolver.hasTypeName('ContelloAsset')).toBe(true);
  });

  test('getModel is always undefined', () => {
    expect(resolver.getModel('AnythingEntity')).toBeUndefined();
  });

  test('getTypeName echoes the model back', () => {
    expect(resolver.getTypeName('article')).toBe('article');
  });

  test('hasModel accepts any model', () => {
    expect(resolver.hasModel('article')).toBe(true);
    expect(resolver.hasModel('unknown')).toBe(true);
  });

  test('resolveModel echoes the type name back', () => {
    expect(resolver.resolveModel('ArticleEntity')).toBe('ArticleEntity');
  });
});

describe('ModelResolver with models', () => {
  const resolver = new ModelResolver({ article: 'ArticleEntity', product: 'ProductEntity' });

  test('hasTypeName is restricted to the configured type names', () => {
    expect(resolver.hasTypeName('ArticleEntity')).toBe(true);
    expect(resolver.hasTypeName('ProductEntity')).toBe(true);
    expect(resolver.hasTypeName('UnknownEntity')).toBe(false);
  });

  test('getModel maps a known type name to its model', () => {
    expect(resolver.getModel('ArticleEntity')).toBe('article');
    expect(resolver.getModel('UnknownEntity')).toBeUndefined();
  });

  test('getTypeName maps a known model, falls back to the model name otherwise', () => {
    expect(resolver.getTypeName('product')).toBe('ProductEntity');
    expect(resolver.getTypeName('missing' as 'article')).toBe('missing');
  });

  test('hasModel reflects membership', () => {
    expect(resolver.hasModel('article')).toBe(true);
    expect(resolver.hasModel('unknown')).toBe(false);
  });

  test('resolveModel maps known type names and passes unknown ones through', () => {
    expect(resolver.resolveModel('ProductEntity')).toBe('product');
    expect(resolver.resolveModel('UnknownEntity')).toBe('UnknownEntity');
  });
});
