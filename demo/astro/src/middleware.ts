import { createI18nMiddleware } from '@astroscope/i18n';
import { sequence } from 'astro/middleware';
import { contello } from '@/server/contello';

const { createAssetsMiddleware, createRoutingMiddleware } = contello;

export const onRequest = sequence(
  createAssetsMiddleware(),
  createRoutingMiddleware(),
  createI18nMiddleware({ locale: () => 'en' }),
);
