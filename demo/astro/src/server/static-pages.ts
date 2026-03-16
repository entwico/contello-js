import { log } from '@astroscope/pino';
import { type Component, componentMapper } from '@/server/components';
import { contello } from '@/server/contello';

export type StaticPage = {
  id: string;
  name: string;
  path: string | undefined;
  content: Component[];
};

export const staticPages = contello.defineLazyCollection({
  model: 'StaticPageEntity',
  fetch: (ids, sdk) => sdk.GetStaticPages({ request: { filter: { ids } } }).then((r) => r.data!.staticPages.entities),
  map: (item) => {
    return {
      id: item.id,
      name: item.attributes.name ?? '',
      path: item.routes[0]?.path,
      content: componentMapper.map(item.attributes._flat_content, item.attributes.content),
    } satisfies StaticPage;
  },
  onRefresh: (ids) => log.info({ ids }, 'static pages updated'),
});
