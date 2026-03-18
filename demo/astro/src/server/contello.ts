import { createContello } from '@contello/astro';
import { Config } from '@/config';
import { models, operations } from '@/server/_/gql/graphql';

const { url, project, token, i18nMessageCollection: collection } = Config.services.contello;

export const contello = createContello({
  url,
  project,
  token,
  operations,
  models,
  i18n: { collection, locales: ['en'] },
});
