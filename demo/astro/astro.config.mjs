import node from '@astrojs/node';
import boot from '@astroscope/boot';
import health from '@astroscope/health';
import i18n from '@astroscope/i18n';
import opentelemetry from '@astroscope/opentelemetry';
import pino from '@astroscope/pino';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [opentelemetry(), i18n(), boot({ hmr: true }), health({ dev: true }), pino()],
  devToolbar: {
    enabled: false,
  },
});
