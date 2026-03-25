import { log } from '@astroscope/pino';
import { contello } from '@/server/contello';

export type Category = {
  id: string;
  name: string;
};

export const categories = contello.defineCollectionSync({
  model: 'category',
  fetch: (client) => client.rpc.getCategories({}).then((r) => r.categories.entities),
  map: (item) => ({
    id: item.id,
    name: item.attributes.name ?? '',
  }),
  onLoad: (ids) => log.info({ ids }, 'categories loaded'),
  onRefresh: (ids) => log.info({ ids }, 'categories updated'),
});
