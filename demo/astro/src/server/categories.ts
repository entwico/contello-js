import { log } from '@astroscope/pino';
import { sources } from '@/server/_/gql/graphql';
import { contello } from '@/server/contello';

export type Category = {
  id: string;
  name: string;
};

export const categories = contello.defineCollectionSync(sources.category, {
  map: (item) => ({
    id: item.id,
    name: item.attributes.name ?? '',
  }),
  onLoad: (ids) => log.info({ ids }, 'categories loaded'),
  onRefresh: (ids) => log.info({ ids }, 'categories updated'),
});
