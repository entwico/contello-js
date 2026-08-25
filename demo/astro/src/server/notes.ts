import { log } from '@astroscope/node/log';
import { contello } from '@/server/contello';

export type Note = {
  id: string;
  title: string;
  body: string;
  done: boolean;
};

/**
 * A scratch model the demo writes to. `create` / `update` / `delete` are on the collection because
 * the schema defines `createNote` / `updateNote` / `deleteNote` — nothing here opts into them.
 */
export const notes = contello.defineCollectionSync('note', {
  map: (item) => ({
    id: item.id,
    title: item.attributes.title ?? '',
    body: item.attributes.body ?? '',
    done: item.attributes.done ?? false,
  }),
  sort: (a, b) => a.title.localeCompare(b.title),
  onLoad: (ids) => log.info({ ids }, 'notes loaded'),
  onRefresh: (event) => log.info(event, 'notes updated'),
});
