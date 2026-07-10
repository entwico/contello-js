import { log } from '@astroscope/node/log';
import { type Component, mapComponents } from '@/server/components';
import { contello } from '@/server/contello';

export type StaticPage = {
  id: string;
  name: string;
  path: string | undefined;
  content: Component[];
};

export const staticPages = contello.defineLazyCollection('staticPage', {
  map: (item) => {
    return {
      id: item.id,
      name: item.attributes.name ?? '',
      path: item.routes[0]?.path,
      content: mapComponents(item.attributes.content),
    } satisfies StaticPage;
  },
  onRefresh: (ids) => log.info({ ids }, 'static pages updated'),
});
