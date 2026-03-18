import { describe, expect, test } from 'bun:test';

import { transformResponse } from './transform-response';

describe('transformResponse', () => {
  describe('__model injection', () => {
    test('injects __model for Entity types', () => {
      const data = { __typename: 'StaticPageEntity', id: '1' };

      transformResponse(data);

      expect((data as any).__model).toBe('staticPage');
    });

    test('injects __model for Component types', () => {
      const data = { __typename: 'TextComponent', text: 'hello' };

      transformResponse(data);

      expect((data as any).__model).toBe('text');
    });

    test('does not inject __model for non-model types', () => {
      const data = { __typename: 'ContelloRoute', id: '1' };

      transformResponse(data);

      expect((data as any).__model).toBeUndefined();
    });

    test('injects __model recursively in nested objects', () => {
      const data = {
        staticPages: {
          entities: [{ __typename: 'StaticPageEntity', id: '1' }],
        },
      };

      transformResponse(data);

      expect((data.staticPages.entities[0] as any).__model).toBe('staticPage');
    });
  });

  describe('unflatten', () => {
    test('resolves _flat_content refs into content', () => {
      const data = {
        attributes: {
          content: [{ _flatId: 'a' }, { _flatId: 'b' }],
          _flat_content: [
            { _flatId: 'a', __typename: 'TextComponent', text: 'hello' },
            { _flatId: 'b', __typename: 'TextComponent', text: 'world' },
          ],
        },
      };

      transformResponse(data);

      expect(data.attributes.content).toHaveLength(2);
      expect((data.attributes.content[0] as any).text).toBe('hello');
      expect((data.attributes.content[1] as any).text).toBe('world');
      expect((data.attributes as any)._flat_content).toBeUndefined();
    });

    test('resolves nested content refs using top-level flat map', () => {
      const data = {
        attributes: {
          content: [{ _flatId: 'section1' }],
          _flat_content: [
            {
              _flatId: 'section1',
              __typename: 'SectionComponent',
              headline: 'Section',
              content: [{ _flatId: 'text1' }],
            },
            { _flatId: 'text1', __typename: 'TextComponent', text: 'nested' },
          ],
        },
      };

      transformResponse(data);

      const section = data.attributes.content[0] as any;

      expect(section.__typename).toBe('SectionComponent');
      expect(section.content).toHaveLength(1);
      expect(section.content[0].text).toBe('nested');
    });

    test('skips refs with no matching _flatId', () => {
      const data = {
        attributes: {
          content: [{ _flatId: 'a' }, { _flatId: 'missing' }],
          _flat_content: [{ _flatId: 'a', __typename: 'TextComponent', text: 'hello' }],
        },
      };

      transformResponse(data);

      expect(data.attributes.content).toHaveLength(1);
    });

    test('handles empty arrays', () => {
      const data = {
        attributes: {
          content: [],
          _flat_content: [],
        },
      };

      transformResponse(data);

      expect(data.attributes.content).toEqual([]);
      expect((data.attributes as any)._flat_content).toBeUndefined();
    });

    test('does not modify objects without _flat_ pattern', () => {
      const data = { id: '1', name: 'test', tags: ['a', 'b'] };
      const original = { ...data };

      transformResponse(data);

      expect(data).toEqual(original);
    });
  });

  describe('combined', () => {
    test('injects __model on unflattened components', () => {
      const data = {
        attributes: {
          content: [{ _flatId: 'a' }],
          _flat_content: [{ _flatId: 'a', __typename: 'TextComponent', text: 'hello' }],
        },
      };

      transformResponse(data);

      expect((data.attributes.content[0] as any).__model).toBe('text');
    });
  });

  describe('primitives and nulls', () => {
    test('returns null as-is', () => {
      expect(transformResponse(null)).toBeNull();
    });

    test('returns undefined as-is', () => {
      expect(transformResponse(undefined)).toBeUndefined();
    });

    test('returns strings as-is', () => {
      expect(transformResponse('hello')).toBe('hello');
    });

    test('returns numbers as-is', () => {
      expect(transformResponse(42)).toBe(42);
    });
  });
});
