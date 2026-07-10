import { log } from '@astroscope/node/log';
import { contello } from '@/server/contello';

export type AppConfig = {
  brandName: string;
};

export const config = contello.defineSingletonSync('config', {
  map: (item) => ({
    brandName: item.attributes.brandName ?? '',
  }),
  onLoad: () => log.info('config loaded'),
  onRefresh: () => log.info('config updated'),
});
