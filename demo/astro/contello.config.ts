import assert from 'node:assert';

const { CONTELLO_URL, CONTELLO_DEMO_ASTRO_PROJECT, CONTELLO_TOKEN } = process.env;

assert(CONTELLO_URL, 'CONTELLO_URL is required');
assert(CONTELLO_DEMO_ASTRO_PROJECT, 'CONTELLO_DEMO_ASTRO_PROJECT is required');
assert(CONTELLO_TOKEN, 'CONTELLO_TOKEN is required');

export default {
  projects: [
    {
      url: CONTELLO_URL,
      project: CONTELLO_DEMO_ASTRO_PROJECT,
      token: CONTELLO_TOKEN,
      documents: ['src/server/graphql/**/*.gql', '../../packages/store/fragments/**/*.gql'],
      output: 'src/server/_/gql/graphql.ts',
    },
  ],
};
