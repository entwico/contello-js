import { registerHealthCheck } from '@astroscope/node/health';
import { log } from '@astroscope/node/log';
import { categories } from '@/server/categories';
import { config } from '@/server/config';
import { contello } from '@/server/contello';
import { notes } from '@/server/notes';

export async function onStartup() {
  registerHealthCheck({ name: 'contello', check: () => contello.ping() });

  await contello.init({ load: [categories, config, notes] });

  log.info('contello initialized');
}

export async function onShutdown() {
  await contello.destroy();
}
