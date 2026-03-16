import { describe, expect, it, mock } from 'bun:test';
import { ComponentMapper, NO_MATCH } from './component-mapper';

type TextComponent = { __typename: 'TextComponent'; _flatId?: string | null; text: string };
type ImageComponent = { __typename: 'ImageComponent'; _flatId?: string | null; url: string };
type SectionComponent = {
  __typename: 'SectionComponent';
  _flatId?: string | null;
  content: { _flatId?: string | null }[];
};

type TestComponent = TextComponent | ImageComponent | SectionComponent;
type Result = { type: 'text'; text: string } | { type: 'image'; url: string } | { type: 'section'; items: Result[] };

const text = (id: string, text: string): TextComponent => ({ __typename: 'TextComponent', _flatId: id, text });
const image = (id: string, url: string): ImageComponent => ({ __typename: 'ImageComponent', _flatId: id, url });
const section = (id: string, ...childIds: string[]): SectionComponent => ({
  __typename: 'SectionComponent',
  _flatId: id,
  content: childIds.map((c) => ({ _flatId: c })),
});

const mapper = new ComponentMapper<TestComponent, Result>({
  TextComponent: (c) => ({ type: 'text', text: c.text }),
  ImageComponent: (c) => ({ type: 'image', url: c.url }),
  SectionComponent: (c, map) => ({ type: 'section', items: map(c.content) }),
});

describe('ComponentMapper', () => {
  describe('map()', () => {
    it('maps known components', () => {
      const flat = [text('1', 'hello'), image('2', 'http://img')];
      const refs = [{ _flatId: '1' }, { _flatId: '2' }];

      expect(mapper.map(flat, refs)).toEqual([
        { type: 'text', text: 'hello' },
        { type: 'image', url: 'http://img' },
      ]);
    });

    it('preserves ref order', () => {
      const flat = [text('1', 'first'), text('2', 'second')];
      const refs = [{ _flatId: '2' }, { _flatId: '1' }];

      expect(mapper.map(flat, refs)).toEqual([
        { type: 'text', text: 'second' },
        { type: 'text', text: 'first' },
      ]);
    });

    it('resolves nested components via map fn', () => {
      const flat = [section('root', 'a', 'b'), text('a', 'A'), text('b', 'B')];
      const refs = [{ _flatId: 'root' }];

      expect(mapper.map(flat, refs)).toEqual([
        {
          type: 'section',
          items: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
        },
      ]);
    });

    it('skips refs with no _flatId', () => {
      const flat = [text('1', 'hello')];
      const refs: { _flatId?: string | null }[] = [{ _flatId: null }, {}, { _flatId: '1' }];

      expect(mapper.map(flat, refs)).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('skips refs not found in flat list', () => {
      const flat = [text('1', 'hello')];
      const refs = [{ _flatId: 'missing' }, { _flatId: '1' }];

      expect(mapper.map(flat, refs)).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('handles null flat', () => {
      expect(mapper.map(null, [{ _flatId: '1' }])).toEqual([]);
    });

    it('handles null refs', () => {
      const flat = [text('1', 'hello')];

      expect(mapper.map(flat, null)).toEqual([]);
    });

    it('handles undefined flat and refs', () => {
      expect(mapper.map(undefined, undefined)).toEqual([]);
    });
  });

  describe('visitor return value filtering', () => {
    it('skips null results', () => {
      const m = new ComponentMapper<TextComponent, Result>({
        TextComponent: () => null,
      });

      expect(m.map([text('1', 'x')], [{ _flatId: '1' }])).toEqual([]);
    });

    it('skips undefined results', () => {
      const m = new ComponentMapper<TextComponent, Result>({
        TextComponent: () => undefined,
      });

      expect(m.map([text('1', 'x')], [{ _flatId: '1' }])).toEqual([]);
    });

    it('skips false results', () => {
      const m = new ComponentMapper<TextComponent, Result>({
        TextComponent: () => false,
      });

      expect(m.map([text('1', 'x')], [{ _flatId: '1' }])).toEqual([]);
    });

    it('skips empty string (supports && shorthand pattern)', () => {
      const m = new ComponentMapper<TextComponent, Result>({
        // simulates: (c) => c.text && { type: 'text', text: c.text } when text is ""
        TextComponent: () => '',
      });

      expect(m.map([text('1', '')], [{ _flatId: '1' }])).toEqual([]);
    });
  });

  describe('NO_MATCH', () => {
    it('calls NO_MATCH for unregistered component types', () => {
      const onNoMatch = mock();
      const m = new ComponentMapper<TestComponent, Result>({
        TextComponent: (c) => ({ type: 'text', text: c.text }),
        [NO_MATCH]: onNoMatch,
      });

      const flat = [text('1', 'hello'), image('2', 'http://img')];
      const refs = [{ _flatId: '1' }, { _flatId: '2' }];
      const result = m.map(flat, refs);

      expect(result).toEqual([{ type: 'text', text: 'hello' }]);
      expect(onNoMatch).toHaveBeenCalledTimes(1); // once per unregistered component in refs
      expect(onNoMatch).toHaveBeenCalledWith(flat[1]);
    });

    it('skips unregistered components even without NO_MATCH', () => {
      const m = new ComponentMapper<TestComponent, Result>({
        TextComponent: (c) => ({ type: 'text', text: c.text }),
      });

      const flat = [text('1', 'hello'), image('2', 'http://img')];
      const refs = [{ _flatId: '1' }, { _flatId: '2' }];

      expect(m.map(flat, refs)).toEqual([{ type: 'text', text: 'hello' }]);
    });
  });
});
