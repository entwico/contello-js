import { Kind, buildSchema, parse, print } from 'graphql';
import { describe, expect, test } from 'vitest';

import { collectFragments, collectOperations } from './documents';
import { transformScalarFragment, transformScalarOperation } from './transform-scalars';

const sdl = `
  scalar LocalDateTime
  scalar LocalDate

  type Query {
    event: EventEntity
  }

  type EventEntity {
    id: ID!
    attributes: EventAttributes
  }

  type EventAttributes {
    name: String
    startDate: LocalDateTime
    endDate: LocalDateTime
    releaseDay: LocalDate
    extraDates: [LocalDateTime!]
    venue: VenueRef
  }

  type VenueRef {
    id: ID!
    openedOn: LocalDate
  }
`;

const schema = buildSchema(sdl);

function transformOpAndPrint(gql: string): string {
  const ops = collectOperations([parse(gql)]);

  return print(transformScalarOperation(schema, ops[0]!));
}

function transformFragmentAndPrint(gql: string, name: string): string {
  const fragments = collectFragments([parse(gql)]);

  return print(transformScalarFragment(schema, fragments.get(name)!));
}

describe('transformScalarOperation', () => {
  test('aliases LocalDateTime scalar fields with _ldt_ prefix', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          id
          attributes {
            name
            startDate
            endDate
          }
        }
      }
    `);

    expect(out).toContain('_ldt_startDate: startDate');
    expect(out).toContain('_ldt_endDate: endDate');
    expect(out).toContain('name');
    expect(out).toContain('id');
  });

  test('aliases LocalDate scalar fields with _ld_ prefix', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          attributes {
            releaseDay
          }
        }
      }
    `);

    expect(out).toContain('_ld_releaseDay: releaseDay');
  });

  test('aliases lists of managed scalars', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          attributes {
            extraDates
          }
        }
      }
    `);

    expect(out).toContain('_ldt_extraDates: extraDates');
  });

  test('preserves user-chosen aliases by prefixing them', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          attributes {
            myStart: startDate
          }
        }
      }
    `);

    expect(out).toContain('_ldt_myStart: startDate');
  });

  test('does not double-alias when prefix already present', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          attributes {
            _ldt_startDate: startDate
          }
        }
      }
    `);

    expect(out).toMatch(/_ldt_startDate: startDate/);
    expect(out).not.toMatch(/_ldt__ldt_/);
  });

  test('recurses into nested object selections', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          attributes {
            venue {
              id
              openedOn
            }
          }
        }
      }
    `);

    expect(out).toContain('_ld_openedOn: openedOn');
  });

  test('aliases managed scalars inside inline fragments', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          ... on EventEntity {
            attributes {
              startDate
            }
          }
        }
      }
    `);

    expect(out).toContain('_ldt_startDate: startDate');
  });

  test('leaves meta fields absent from the schema untouched', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          __typename
          attributes {
            startDate
          }
        }
      }
    `);

    expect(out).toContain('__typename');
    expect(out).toContain('_ldt_startDate: startDate');
  });

  test('returns the operation unchanged when the root type is absent', () => {
    const ops = collectOperations([
      parse(`subscription Watch { event { attributes { startDate } } }`),
    ]);
    const op = ops[0]!;

    expect(transformScalarOperation(schema, op)).toBe(op);
  });

  test('leaves operations without managed scalars untouched', () => {
    const out = transformOpAndPrint(`
      query GetEvent {
        event {
          id
          attributes {
            name
          }
        }
      }
    `);

    expect(out).not.toContain('_ldt_');
    expect(out).not.toContain('_ld_');
  });
});

describe('transformScalarFragment edge cases', () => {
  test('returns the fragment unchanged when its type is not composite', () => {
    const fragments = collectFragments([parse(`fragment X on LocalDateTime { __typename }`)]);
    const fragment = fragments.get('X')!;

    expect(transformScalarFragment(schema, fragment)).toBe(fragment);
  });

  test('returns the fragment unchanged when it has no managed scalars', () => {
    const fragments = collectFragments([parse(`fragment X on EventAttributes { name }`)]);
    const fragment = fragments.get('X')!;

    expect(transformScalarFragment(schema, fragment)).toBe(fragment);
  });

  test('reuses the definition kind for parsed fragments', () => {
    const fragments = collectFragments([parse(`fragment X on EventAttributes { name }`)]);

    expect(fragments.get('X')!.kind).toBe(Kind.FRAGMENT_DEFINITION);
  });
});

describe('transformScalarFragment', () => {
  test('aliases managed scalar fields inside fragments', () => {
    const out = transformFragmentAndPrint(
      `
      fragment EventAttrs on EventAttributes {
        name
        startDate
        releaseDay
      }
    `,
      'EventAttrs',
    );

    expect(out).toContain('_ldt_startDate: startDate');
    expect(out).toContain('_ld_releaseDay: releaseDay');
    expect(out).toContain('name');
  });
});
