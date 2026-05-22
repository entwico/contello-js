import { createContello } from '@contello/astro';
import { Config } from '@/config';
import { schema } from '@/server/_/gql/graphql';

const { url, project, token, i18nMessageCollection: collection } = Config.services.contello;

export const contello = createContello({
  url,
  project,
  token,
  i18n: { collection, languages: ['en'] },
  schema,
});
