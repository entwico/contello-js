import { log } from '@astroscope/pino';
import { contello } from '@/server/contello';

export type Product = {
  id: string;
  name: string;
  path: string | undefined;
  description: string | undefined;
};

export const products = contello.defineLazyCollection({
  model: 'product',
  fetch: (ids, client) => client.rpc.getProducts({ request: { filter: { ids } } }).then((r) => r.products.entities),
  map: (item) => ({
    id: item.id,
    name: item.attributes.name ?? '',
    path: item.routes[0]?.path,
    description: item.attributes.description?.markdownData,
  }),
  onRefresh: (ids) => log.info({ ids }, 'products updated'),
});
