import { type FragmentDefinitionNode, type OperationDefinitionNode, buildSchema, parse, print } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectFragments, collectOperations } from './documents';
import { transformFragment, transformOperation } from './transform-components';

const sdl = `
  type Query {
    staticPages: StaticPagesResponse
  }

  type StaticPagesResponse {
    entities: [StaticPageEntity!]!
  }

  type StaticPageEntity {
    id: ID!
    attributes: StaticPageAttributes
  }

  type StaticPageAttributes {
    name: String
    content: [ContelloComponent]
    _flat_content: [ContelloComponent]
  }

  type TextComponent {
    text: RichText
    _flatId: String
  }

  type SectionComponent {
    headline: String
    content: [ContelloComponent]
    _flat_content: [ContelloComponent]
    _flatId: String
  }

  type ProductListComponent {
    headline: String
    products: [ProductRef]
    _flatId: String
  }

  type ProductRef {
    id: ID!
  }

  type RichText {
    markdownData: String
  }

  type ContelloFlatComponent {
    __typename: String
    _flatId: String
  }

  union ContelloComponent = TextComponent | SectionComponent | ProductListComponent | ContelloFlatComponent

  interface ContelloEntityBase {
    id: ID!
  }
`;

const schema = buildSchema(sdl);

function parseOp(gql: string): { op: OperationDefinitionNode; fragments: Map<string, FragmentDefinitionNode> } {
  const doc = parse(gql);
  const ops = collectOperations([doc]);
  const fragments = collectFragments([doc]);

  return { op: ops[0]!, fragments };
}

function transformAndPrint(gql: string): string {
  const { op, fragments } = parseOp(gql);
  const transformedFragments = new Map(
    [...fragments].map(([name, frag]) => [name, transformFragment(schema, frag, fragments)]),
  );
  const transformedOp = transformOperation(schema, op, transformedFragments);

  return print(transformedOp);
}

function transformFragmentAndPrint(gql: string, fragmentName: string): string {
  const doc = parse(gql);
  const fragments = collectFragments([doc]);
  const fragment = fragments.get(fragmentName)!;
  const transformed = transformFragment(schema, fragment, fragments);

  return print(transformed);
}

describe('transformOperation', () => {
  test('rewrites content field to flat refs and adds _flat_content sibling', () => {
    const result = transformAndPrint(`
      query GetPages {
        staticPages {
          entities {
            attributes {
              content {
                ... on TextComponent { text { markdownData } }
              }
            }
          }
        }
      }
    `);

    expect(result).toContain('_flat_content');
    expect(result).toContain('_flatId');
    expect(result).toContain('__typename');

    // content should only have flat refs
    const contentMatch = result.match(/content \{([^}]+)\}/);

    expect(contentMatch).toBeTruthy();
    expect(contentMatch![1]).toContain('__typename');
    expect(contentMatch![1]).toContain('_flatId');
    expect(contentMatch![1]).not.toContain('TextComponent');
  });

  test('preserves non-component fields unchanged', () => {
    const result = transformAndPrint(`
      query GetPages {
        staticPages {
          entities {
            id
            attributes {
              name
            }
          }
        }
      }
    `);

    expect(result).toContain('id');
    expect(result).toContain('name');
    expect(result).not.toContain('_flat_');
  });

  test('does not transform when no component fields exist', () => {
    const { op, fragments } = parseOp(`
      query GetPages {
        staticPages {
          entities {
            id
          }
        }
      }
    `);

    const transformed = transformOperation(schema, op, fragments);

    expect(transformed).toBe(op);
  });

  test('_flat_content contains original user selections', () => {
    const result = transformAndPrint(`
      query GetPages {
        staticPages {
          entities {
            attributes {
              content {
                ... on TextComponent { text { markdownData } }
                ... on ProductListComponent { headline }
              }
            }
          }
        }
      }
    `);

    expect(result).toContain('_flat_content');
    expect(result).toContain('TextComponent');
    expect(result).toContain('markdownData');
    expect(result).toContain('ProductListComponent');
  });
});

describe('transformFragment', () => {
  test('adds flat ref selections to ContelloComponent fragment', () => {
    const result = transformFragmentAndPrint(
      `fragment Component on ContelloComponent {
        ... on TextComponent { text { markdownData } }
      }`,
      'Component',
    );

    expect(result).toContain('__typename');
    expect(result).toContain('_flatId');
    expect(result).toContain('ContelloFlatComponent');
  });

  test('rewrites nested content fields in fragment to refs only (no _flat_ sibling)', () => {
    const result = transformFragmentAndPrint(
      `fragment Component on ContelloComponent {
        ... on SectionComponent {
          headline
          content {
            ... on TextComponent { text { markdownData } }
          }
        }
      }`,
      'Component',
    );

    // content inside SectionComponent should be flat refs only
    expect(result).toContain('content {');
    expect(result).not.toContain('_flat_content');
  });

  test('does not modify fragments on non-component types', () => {
    const gql = `fragment PageFields on StaticPageEntity { id }`;
    const doc = parse(gql);
    const fragments = collectFragments([doc]);
    const fragment = fragments.get('PageFields')!;
    const transformed = transformFragment(schema, fragment, fragments);

    expect(transformed).toBe(fragment);
  });
});

describe('transformOperation with fragment spreads', () => {
  test('handles fragment spread in content field', () => {
    const result = transformAndPrint(`
      fragment Component on ContelloComponent {
        ... on TextComponent { text { markdownData } }
      }
      query GetPages {
        staticPages {
          entities {
            attributes {
              content { ...Component }
            }
          }
        }
      }
    `);

    expect(result).toContain('_flat_content');
    // ...Component should be in _flat_content, not in content
    expect(result).toContain('...Component');

    // content should be flat refs only
    const contentMatch = result.match(/content \{([^}]+)\}/);

    expect(contentMatch![1]).toContain('_flatId');
    expect(contentMatch![1]).not.toContain('...Component');
  });

  test('self-referencing fragment does not cause circular _flat_ injection', () => {
    const gql = `
      fragment Component on ContelloComponent {
        ... on TextComponent { text { markdownData } }
        ... on SectionComponent {
          headline
          content { ...Component }
        }
      }
      query GetPages {
        staticPages {
          entities {
            attributes {
              content { ...Component }
            }
          }
        }
      }
    `;

    const { op, fragments } = parseOp(gql);
    const transformedFragments = new Map(
      [...fragments].map(([name, frag]) => [name, transformFragment(schema, frag, fragments)]),
    );
    const transformedOp = transformOperation(schema, op, transformedFragments);
    const printed = print(transformedOp);

    // operation level should have _flat_content
    expect(printed).toContain('_flat_content');

    // the fragment should NOT produce _flat_content (refs only inside fragments)
    const fragResult = print(transformedFragments.get('Component')!);

    expect(fragResult).not.toContain('_flat_content');
  });
});
