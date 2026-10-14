import { log } from '@astroscope/node/log';
import { categories } from '@/server/categories';
import { config } from '@/server/config';
import { contello } from '@/server/contello';
import { notes } from '@/server/notes';

export async function onStartup() {
  await contello.init({
    routes: 'lazy',
    i18n: { locales: ['en'], locale: () => 'en' },
    load: [categories, config, notes],
  });

  log.info('contello initialized');
}

export async function onShutdown() {
  await contello.destroy();
}
