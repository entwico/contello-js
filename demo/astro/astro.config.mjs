import i18n from '@astroscope/i18n';
import node from '@astroscope/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [i18n()],
  devToolbar: {
    enabled: false,
  },
});
