import type { SourceDef } from '@contello/client';

const cache = new WeakMap<SourceDef, string>();

/**
 * Generates the subscription document that feeds the store, derived from a SourceDef.
 * Singleton: `subscription { source: <sub> { ...<Frag> } }`.
 * Collection: `subscription($ids: [ID!]) { source: <sub>(request: { filter: { ids: $ids } }) { ...<Frag> } }`.
 * Memoized per SourceDef reference.
 */
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
