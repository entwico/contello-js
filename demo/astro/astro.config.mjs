import i18n from '@astroscope/i18n';
import node from '@astroscope/node';
import contello from '@contello/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ telemetry: { dev: true, prometheus: false } }),
  integrations: [contello(), i18n()],
  devToolbar: { enabled: false },
});
