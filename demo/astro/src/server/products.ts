import { log } from '@astroscope/node/log';
import { schema } from '@/server/_/gql/graphql';
import { contello } from '@/server/contello';

export type Product = {
  id: string;
  name: string;
  path: string | undefined;
  description: string | undefined;
};

export const products = contello.defineLazyCollection(schema.sources.product, {
  map: (item) => ({
    id: item.id,
    name: item.attributes.name ?? '',
    path: item.routes[0]?.path,
    description: item.attributes.description?.markdownData,
  }),
  onRefresh: (ids) => log.info({ ids }, 'products updated'),
});
