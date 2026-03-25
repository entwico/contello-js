import assert from 'assert';

process.loadEnvFile('.env');

const { CONTELLO_URL, CONTELLO_TOKEN, CONTELLO_DEMO_ASTRO_PROJECT } = process.env;

assert(CONTELLO_URL && CONTELLO_DEMO_ASTRO_PROJECT && CONTELLO_TOKEN);

export default {
  projects: {
    demo: {
      schema: {
        [`${CONTELLO_URL}/graphql/projects/${CONTELLO_DEMO_ASTRO_PROJECT}`]: { headers: { token: CONTELLO_TOKEN } },
      },
      documents: ['demo/astro/src/server/graphql/**/*.(graphql|gql)', 'packages/store/fragments/**/*.gql'],
    },
  },
};
