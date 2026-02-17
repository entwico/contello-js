import { describe, expect, test } from 'bun:test';
import type { RichTextDocument, RichTextNode } from './types';
import {
  createRichTextDocumentFromString,
  isRichTextDocumentEmpty,
  parseRichTextDocument,
  richTextDocumentToString,
  richTextNodeToString,
  richTextNodesToString,
} from './helpers';

describe('richTextNodeToString', () => {
  test('text node', () => {
    expect(richTextNodeToString({ type: 'text', text: 'hello' })).toBe('hello');
  });

  test('paragraph with text', () => {
    const node: RichTextNode = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello world' }],
    };

    expect(richTextNodeToString(node)).toBe('hello world');
  });

  test('heading with text', () => {
    const node: RichTextNode = {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'title' }],
    };

    expect(richTextNodeToString(node)).toBe('title');
  });

  test('paragraph with no content', () => {
    expect(richTextNodeToString({ type: 'paragraph' })).toBe('');
  });

  test('bullet list', () => {
    const node: RichTextNode = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
      ],
    };

    expect(richTextNodeToString(node)).toBe('ab');
  });

  test('ordered list', () => {
    const node: RichTextNode = {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    };

    expect(richTextNodeToString(node)).toBe('firstsecond');
  });

  test('horizontal rule', () => {
    expect(richTextNodeToString({ type: 'horizontalRule' })).toBe('---');
  });

  test('hard break', () => {
    expect(richTextNodeToString({ type: 'hardBreak' })).toBe('\n');
  });

  test('code block', () => {
    const node: RichTextNode = {
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const x = 1;' }],
    };

    expect(richTextNodeToString(node)).toBe('const x = 1;');
  });

  test('blockquote', () => {
    const node: RichTextNode = {
      type: 'blockquote',
      content: [{ type: 'text', text: 'quoted' }],
    };

    expect(richTextNodeToString(node)).toBe('quoted');
  });

  test('table', () => {
    const node: RichTextNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'text', text: 'A' }] },
            { type: 'tableHeader', content: [{ type: 'text', text: 'B' }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'text', text: '1' }] },
            { type: 'tableCell', content: [{ type: 'text', text: '2' }] },
          ],
        },
      ],
    };

    expect(richTextNodeToString(node)).toBe('A | B\n1 | 2');
  });
});

describe('richTextNodesToString', () => {
  test('joins nodes with newlines', () => {
    const nodes: RichTextNode[] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'line 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'line 2' }] },
    ];

    expect(richTextNodesToString(nodes)).toBe('line 1\nline 2');
  });

  test('empty array', () => {
    expect(richTextNodesToString([])).toBe('');
  });
});

describe('richTextDocumentToString', () => {
  test('converts document to string', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    };

    expect(richTextDocumentToString(doc)).toBe('Title\nBody text');
  });

  test('empty document', () => {
    expect(richTextDocumentToString({ type: 'doc' })).toBe('');
  });
});

describe('isRichTextDocumentEmpty', () => {
  test('empty content array', () => {
    expect(isRichTextDocumentEmpty({ type: 'doc', content: [] })).toBe(true);
  });

  test('no content property', () => {
    expect(isRichTextDocumentEmpty({ type: 'doc' })).toBe(true);
  });

  test('only whitespace', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
    };

    expect(isRichTextDocumentEmpty(doc)).toBe(true);
  });

  test('empty paragraph', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };

    expect(isRichTextDocumentEmpty(doc)).toBe(true);
  });

  test('non-empty document', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    };

    expect(isRichTextDocumentEmpty(doc)).toBe(false);
  });
});

describe('createRichTextDocumentFromString', () => {
  test('creates document with text', () => {
    const doc = createRichTextDocumentFromString('hello');

    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
  });

  test('null input creates empty paragraph', () => {
    const doc = createRichTextDocumentFromString(null);

    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    });
  });

  test('undefined input creates empty paragraph', () => {
    const doc = createRichTextDocumentFromString(undefined);

    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    });
  });

  test('empty string creates empty paragraph', () => {
    const doc = createRichTextDocumentFromString('');

    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    });
  });
});

describe('parseRichTextDocument', () => {
  test('parses valid document JSON', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });

    const doc = parseRichTextDocument(json);

    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(1);
  });

  test('returns empty doc for null', () => {
    expect(parseRichTextDocument(null)).toEqual({ type: 'doc', content: [] });
  });

  test('returns empty doc for undefined', () => {
    expect(parseRichTextDocument(undefined)).toEqual({ type: 'doc', content: [] });
  });

  test('returns empty doc for empty string', () => {
    expect(parseRichTextDocument('')).toEqual({ type: 'doc', content: [] });
  });

  test('returns empty doc for non-doc JSON', () => {
    expect(parseRichTextDocument(JSON.stringify({ type: 'other' }))).toEqual({ type: 'doc', content: [] });
  });
});
