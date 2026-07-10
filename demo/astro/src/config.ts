import { zc } from '@entwico/zod-conf';

const schema = zc.define({
  services: zc.object({
    contello: zc.object({
      url: zc.env('CONTELLO_URL').string(),
      project: zc.env('CONTELLO_DEMO_ASTRO_PROJECT').string(),
      token: zc.env('CONTELLO_TOKEN').string(),
      i18nMessageCollection: zc.env('CONTELLO_I18N_MESSAGE_COLLECTION').string().default('demo'),
    }),
  }),
});

export const Config = schema.load({ env: process.env });
