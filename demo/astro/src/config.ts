import { zc } from 'zod-conf';

const schema = zc.define({
  services: zc.object({
    contello: zc.object({
      url: zc.env('CONTELLO_URL').string(),
      project: zc.env('CONTELLO_DEMO_ASTRO_PROJECT').string(),
      token: zc.env('CONTELLO_TOKEN').string(),
      i18nMessageCollection: zc.env('CONTELLO_I18N_MESSAGE_COLLECTION').string().default('demo'),
    }),
  }),
  logger: zc.object({
    level: zc.env('LOG_LEVEL').string().default('debug'),
    withTimestamp: zc.env('LOG_TIMESTAMP').boolean().default(false),
    withDefaultBindings: zc.env('LOG_DEFAULT_BINDINGS').boolean().default(false),
  }),
});

export const Config = schema.load({ env: process.env });
