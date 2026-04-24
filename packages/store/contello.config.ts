import assert from 'assert';

import { fragments as mediaFragments } from '@contello/media/fragments';

const { CONTELLO_URL, CONTELLO_STORE_PROJECT, CONTELLO_TOKEN } = process.env;

assert(CONTELLO_URL, 'CONTELLO_URL is required');
assert(CONTELLO_STORE_PROJECT, 'CONTELLO_STORE_PROJECT is required');
assert(CONTELLO_TOKEN, 'CONTELLO_TOKEN is required');

export default {
  projects: [
    {
      url: CONTELLO_URL,
      project: CONTELLO_STORE_PROJECT,
      token: CONTELLO_TOKEN,
      documents: [...mediaFragments, '{fragments,graphql}/**/*.gql'],
      output: 'src/generated/graphql.ts',
    },
  ],
};
