import { createI18nChunkMiddleware, createI18nMiddleware } from '@astroscope/i18n';
import { createRoutingMiddleware } from '@contello/astro';
import { sequence } from 'astro/middleware';
import { contello } from '@/server/contello';

export const onRequest = sequence(
  createI18nChunkMiddleware(),
  createRoutingMiddleware(contello),
  createI18nMiddleware({ locale: () => 'en' }),
);
