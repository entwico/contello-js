import { Source, buildSchema, parse } from 'graphql';
import { describe, expect, test } from 'vitest';

import {
  collectFragments,
  collectOperations,
  fragmentBundleExpression,
  generateDocumentString,
  generateFragmentSchemas,
  operationDocumentExpression,
  validateDocuments,
} from './documents';

describe('collectFragments', () => {
  test('collects named fragments from documents', () => {
    const doc = parse(`
      fragment UserFields on User {
        id
        name
      }
      fragment PostFields on Post {
        id
        title
      }
    `);

    const fragments = collectFragments([doc]);

    expect(fragments.size).toBe(2);
    expect(fragments.has('UserFields')).toBe(true);
    expect(fragments.has('PostFields')).toBe(true);
  });

  test('returns empty map for no fragments', () => {
    const doc = parse(`query GetUser { user { id } }`);
    const fragments = collectFragments([doc]);

    expect(fragments.size).toBe(0);
  });

  test('collects from multiple documents', () => {
    const doc1 = parse(`fragment A on User { id }`);
    const doc2 = parse(`fragment B on Post { id }`);
    const fragments = collectFragments([doc1, doc2]);

    expect(fragments.size).toBe(2);
  });
});

describe('collectOperations', () => {
  test('collects named operations', () => {
    const doc = parse(`
      query GetUser { user { id } }
      mutation UpdateUser($id: ID!) { updateUser(id: $id) { id } }
    `);

    const operations = collectOperations([doc]);

    expect(operations.length).toBe(2);
    expect(operations[0]!.name!.value).toBe('GetUser');
    expect(operations[1]!.name!.value).toBe('UpdateUser');
  });

  test('throws on duplicate operation names', () => {
    const doc1 = parse(`query GetUser { user { id } }`);
    const doc2 = parse(`query GetUser { user { name } }`);

    expect(() => collectOperations([doc1, doc2])).toThrow('duplicate operation name: "GetUser"');
  });

  test('throws on unnamed operations', () => {
    const doc = parse(`query { user { id } }`);

    expect(() => collectOperations([doc])).toThrow('unnamed operations are not supported');
  });

  test('collects from multiple documents', () => {
    const doc1 = parse(`query A { user { id } }`);
    const doc2 = parse(`query B { post { id } }`);
    const operations = collectOperations([doc1, doc2]);

    expect(operations.length).toBe(2);
  });
});

describe('generateDocumentString', () => {
  test('generates document without fragments', () => {
    const doc = parse(`query GetUser { user { id name } }`);
    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);

    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('query GetUser');
    expect(result).toContain('id');
    expect(result).toContain('name');
  });

  test('includes used fragments', () => {
    const doc = parse(`
      fragment UserFields on User { id name }
      query GetUser { user { ...UserFields } }
    `);

    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment UserFields on User');
    expect(result).toContain('query GetUser');
  });

  test('excludes unused fragments', () => {
    const doc1 = parse(`fragment UserFields on User { id name }`);
    const doc2 = parse(`fragment PostFields on Post { id title }`);
    const doc3 = parse(`query GetUser { user { ...UserFields } }`);

    const fragments = collectFragments([doc1, doc2, doc3]);
    const operations = collectOperations([doc3]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment UserFields');
    expect(result).not.toContain('fragment PostFields');
  });

  test('includes transitively used fragments', () => {
    const doc = parse(`
      fragment BaseFields on User { id }
      fragment UserFields on User { ...BaseFields name }
      query GetUser { user { ...UserFields } }
    `);

    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    expect(result).toContain('fragment BaseFields');
    expect(result).toContain('fragment UserFields');
    expect(result).toContain('query GetUser');
  });

  test('orders dependent fragments before dependents', () => {
    const doc = parse(`
      fragment BaseFields on User { id }
      fragment UserFields on User { ...BaseFields name }
      query GetUser { user { ...UserFields } }
    `);

    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);
    const result = generateDocumentString(operations[0]!, fragments);

    const baseIndex = result.indexOf('fragment BaseFields');
    const userIndex = result.indexOf('fragment UserFields');
    const queryIndex = result.indexOf('query GetUser');

    expect(baseIndex).toBeLessThan(userIndex);
    expect(userIndex).toBeLessThan(queryIndex);
  });

  test('throws on unknown fragment spread', () => {
    const doc = parse(`query GetUser { user { ...UnknownFragment } }`);
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => generateDocumentString(operations[0]!, fragments)).toThrow('unknown fragment: "UnknownFragment"');
  });
});

describe('validateDocuments', () => {
  const schema = buildSchema(`
    type Query {
      testimonials: TestimonialsResponse
      tourSearch: TourSearchResponse
    }

    type TestimonialsResponse {
      variant: TestimonialsVariant
    }

    type TourSearchResponse {
      variant: TourSearchVariant
    }

    type TestimonialsVariant {
      id: ID!
      label: String
    }

    type TourSearchVariant {
      id: ID!
      kind: String
    }
  `);

  test('passes for valid documents', () => {
    const doc = parse(`query Q { testimonials { variant { id } } }`);
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => validateDocuments(schema, fragments, operations)).not.toThrow();
  });

  test('throws on conflicting fields with the same alias', () => {
    const doc = parse(
      new Source(
        `query Q {
            variant: testimonials { id }
            variant: tourSearch { id }
          }`,
        'queries/q.gql',
      ),
    );
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => validateDocuments(schema, fragments, operations)).toThrow(/graphql validation failed/);
    expect(() => validateDocuments(schema, fragments, operations)).toThrow(/Fields "variant" conflict/);
    expect(() => validateDocuments(schema, fragments, operations)).toThrow(/queries\/q\.gql:\d+:\d+/);
  });

  test('throws on unknown field', () => {
    const doc = parse(new Source(`query Q { testimonials { nonExistent } }`, 'queries/q.gql'));
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => validateDocuments(schema, fragments, operations)).toThrow(/Cannot query field "nonExistent"/);
  });

  test('does not flag unused fragments', () => {
    const doc = parse(`
      fragment Unused on TestimonialsVariant { id }
      query Q { testimonials { variant { id } } }
    `);
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => validateDocuments(schema, fragments, operations)).not.toThrow();
  });

  test('does not flag fragment cycles', () => {
    const cycleSchema = buildSchema(`
      type Query { node: Node }
      type Node { id: ID! child: Node }
    `);
    const doc = parse(`
      fragment NodeFields on Node {
        id
        child { ...NodeFields }
      }
      query Q { node { ...NodeFields } }
    `);
    const fragments = collectFragments([doc]);
    const operations = collectOperations([doc]);

    expect(() => validateDocuments(cycleSchema, fragments, operations)).not.toThrow();
  });
});

describe('generateFragmentSchemas', () => {
  test('emits one `const <Name>FragmentSchema` per fragment', () => {
    const doc = parse(`
      fragment UserFields on User { id name }
      fragment PostFields on Post { id title }
    `);
    const fragments = collectFragments([doc]);
    const out = generateFragmentSchemas(fragments);

    expect(out).toContain('const UserFieldsFragmentSchema = `fragment UserFields on User');
    expect(out).toContain('const PostFieldsFragmentSchema = `fragment PostFields on Post');
  });

  test('emits in alphabetical order by fragment name', () => {
    const doc = parse(`
      fragment Z on User { id }
      fragment A on User { id }
      fragment M on User { id }
    `);
    const fragments = collectFragments([doc]);
    const out = generateFragmentSchemas(fragments);

    const aIdx = out.indexOf('const AFragmentSchema');
    const mIdx = out.indexOf('const MFragmentSchema');
    const zIdx = out.indexOf('const ZFragmentSchema');

    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });

  test('returns empty string when no fragments', () => {
    const fragments = collectFragments([parse(`query Q { user { id } }`)]);

    expect(generateFragmentSchemas(fragments)).toBe('');
  });
});

describe('fragmentBundleExpression', () => {
  test('returns the bare const identifier when fragment has no deps', () => {
    const doc = parse(`fragment Category on CategoryEntity { id }`);
    const fragments = collectFragments([doc]);

    expect(fragmentBundleExpression(fragments.get('Category')!, fragments)).toBe('CategoryFragmentSchema');
  });

  test('returns a template literal interpolating deps + self when transitive deps exist', () => {
    const doc = parse(`
      fragment Component on ContelloComponent { __typename }
      fragment StaticPage on StaticPageEntity { id ...Component }
    `);
    const fragments = collectFragments([doc]);

    const expr = fragmentBundleExpression(fragments.get('StaticPage')!, fragments);

    expect(expr).toContain('${ComponentFragmentSchema}');
    expect(expr).toContain('${StaticPageFragmentSchema}');
    expect(expr.indexOf('Component')).toBeLessThan(expr.indexOf('StaticPage'));
    expect(expr.startsWith('`')).toBe(true);
    expect(expr.endsWith('`')).toBe(true);
  });
});

describe('operationDocumentExpression', () => {
  test('wraps the result in a template literal', () => {
    const doc = parse(`query GetUser { user { id } }`);
    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);

    const expr = operationDocumentExpression(operations[0]!, fragments);

    expect(expr.startsWith('`')).toBe(true);
    expect(expr.endsWith('`')).toBe(true);
    expect(expr).toContain('query GetUser');
  });

  test('interpolates fragment schema refs (not inlined fragment text)', () => {
    const doc = parse(`
      fragment UserFields on User { id name }
      query GetUser { user { ...UserFields } }
    `);
    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);

    const expr = operationDocumentExpression(operations[0]!, fragments);

    expect(expr).toContain('${UserFieldsFragmentSchema}');
    expect(expr).not.toContain('fragment UserFields on User');
  });

  test('orders transitive deps before dependents in the interpolation', () => {
    const doc = parse(`
      fragment BaseFields on User { id }
      fragment UserFields on User { ...BaseFields name }
      query GetUser { user { ...UserFields } }
    `);
    const operations = collectOperations([doc]);
    const fragments = collectFragments([doc]);

    const expr = operationDocumentExpression(operations[0]!, fragments);

    const baseIdx = expr.indexOf('${BaseFieldsFragmentSchema}');
    const userIdx = expr.indexOf('${UserFieldsFragmentSchema}');
    const queryIdx = expr.indexOf('query GetUser');

    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(queryIdx);
  });
});
