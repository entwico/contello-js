import { type GraphQLSchema, buildClientSchema, getIntrospectionQuery } from 'graphql';

export async function introspectSchema(url: string, project: string, token: string): Promise<GraphQLSchema> {
  const endpoint = `${url}/graphql/projects/${project}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });

  if (!response.ok) {
    throw new Error(`introspection failed: ${response.status} ${response.statusText} (${endpoint})`);
  }

  const json = (await response.json()) as { data?: any; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`introspection errors: ${json.errors.map((e) => e.message).join(', ')}`);
  }

  if (!json.data) {
    throw new Error(`introspection returned no data (${endpoint})`);
  }

  return buildClientSchema(json.data);
}
