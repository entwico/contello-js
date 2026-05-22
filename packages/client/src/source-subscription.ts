import type { SourceDef } from './types';

const cache = new WeakMap<SourceDef, string>();

function createSelection(source: SourceDef): string {
  const spread = `{ ...${source.fragment} }`;

  switch (source.__cardinality) {
    case 'singleton':
      return `subscription { source: ${source.subscription} ${spread} }`;
    case 'entity':
      return `subscription($ids: [ID!]) { source: ${source.subscription}(request: { filter: { ids: $ids } }) ${spread} }`;
    case 'route':
    case 'asset':
      return `subscription { source: ${source.subscription} ${spread} }`;
    case 'i18nMessage':
      return `subscription($collection: String!) { source: ${source.subscription}(collectionReferenceName: $collection) ${spread} }`;
  }
}

export function createSourceSubscription(source: SourceDef): string {
  const cached = cache.get(source);

  if (cached !== undefined) {
    return cached;
  }

  const doc = `${source.document}\n${createSelection(source)}`;

  cache.set(source, doc);

  return doc;
}
