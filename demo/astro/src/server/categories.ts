import { log } from '@astroscope/pino';
import { map } from 'rxjs';
import { contello } from '@/server/contello';

export type Category = {
  id: string;
  name: string;
};

export const categories = contello.defineCollectionSync({
  model: 'category',
  fetch: (client) => client.rpc.getAllCategories().pipe(map((r) => r.categoriesBatch)),
  map: (item) => ({
    id: item.id,
    name: item.attributes.name ?? '',
  }),
  onLoad: (ids) => log.info({ ids }, 'categories loaded'),
  onRefresh: (ids) => log.info({ ids }, 'categories updated'),
});
