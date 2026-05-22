import type { SourceDef } from './types';

const cache = new WeakMap<SourceDef, string>();

export function createSourceSubscription(source: SourceDef): string {
  const cached = cache.get(source);

  if (cached !== undefined) {
    return cached;
  }

  const spread = `{ ...${source.fragment} }`;
  const selection =
    source.__cardinality === 'singleton'
      ? `subscription { source: ${source.subscription} ${spread} }`
      : `subscription($ids: [ID!]) { source: ${source.subscription}(request: { filter: { ids: $ids } }) ${spread} }`;
  const doc = `${source.document}\n${selection}`;

  cache.set(source, doc);

  return doc;
}
