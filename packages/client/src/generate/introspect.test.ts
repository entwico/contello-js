import { buildSchema, getIntrospectionQuery, graphqlSync } from 'graphql';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { introspectSchema } from './introspect';

const introspection = graphqlSync({
  schema: buildSchema('type Query { greeting: String } type Article { id: ID! }'),
  source: getIntrospectionQuery(),
}).data;

function stubFetch(response: Response) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => response);

  vi.stubGlobal('fetch', fetch);

  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('introspectSchema', () => {
  test('posts the introspection query to the project endpoint with the token', async () => {
    const fetch = stubFetch(Response.json({ data: introspection }));

    await introspectSchema('https://contello.example.com', 'project-1', 'token-1');

    const [url, init] = fetch.mock.calls[0]!;

    expect(url).toBe('https://contello.example.com/graphql/projects/project-1');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', token: 'token-1' });
    expect(JSON.parse(init.body as string)).toEqual({ query: getIntrospectionQuery() });
  });

  test('answers with the schema the server describes', async () => {
    stubFetch(Response.json({ data: introspection }));

    const schema = await introspectSchema('https://contello.example.com', 'project-1', 'token-1');

    expect(schema.getQueryType()!.getFields()).toHaveProperty('greeting');
    expect(schema.getType('Article')).toBeDefined();
  });

  test('fails with the status of a refused request', async () => {
    stubFetch(new Response('nope', { status: 401, statusText: 'Unauthorized' }));

    await expect(introspectSchema('https://contello.example.com', 'project-1', 'bad')).rejects.toThrow(
      'introspection failed: 401 Unauthorized (https://contello.example.com/graphql/projects/project-1)',
    );
  });

  test('fails with the errors of the server', async () => {
    stubFetch(Response.json({ errors: [{ message: 'no access' }, { message: 'try later' }] }));

    await expect(introspectSchema('https://contello.example.com', 'project-1', 'token-1')).rejects.toThrow(
      'introspection errors: no access, try later',
    );
  });

  test('fails on an answer without data', async () => {
    stubFetch(Response.json({}));

    await expect(introspectSchema('https://contello.example.com', 'project-1', 'token-1')).rejects.toThrow(
      'introspection returned no data',
    );
  });
});
