import { createContello } from '@contello/astro';
import { Config } from '@/config';
import { type ContelloEntity, getSdk } from '@/server/_/gql/graphql';

const entityTypes = ['StaticPageEntity'] as const satisfies readonly NonNullable<ContelloEntity['__typename']>[];

const { url, project, token, i18nMessageCollection: collection } = Config.services.contello;

export const contello = createContello({
  url,
  project,
  token,
  client: { getSdk },
  entityTypes,
  i18n: { collection, locales: ['en'] },
});
