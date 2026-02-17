import type { RichTextDocument, RichTextNode } from './types';

/** Converts a single rich text node to its plain text representation. */
export function richTextNodeToString(node: RichTextNode): string {
  if (node.type === 'text') {
    return node.text;
  }

  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'codeBlock':
    case 'blockquote':
      return (node.content ?? []).map(richTextNodeToString).join('');
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? []).map((item) => (item.content ?? []).map(richTextNodeToString).join('')).join('');
    case 'listItem':
      return (node.content ?? []).map(richTextNodeToString).join('');
    case 'horizontalRule':
      return '---';
    case 'hardBreak':
      return '\n';
    case 'table':
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? []).map((cell) => (cell.content ?? []).map(richTextNodeToString).join('')).join(' | '),
        )
        .join('\n');
    case 'tableRow':
      return (node.content ?? []).map((cell) => (cell.content ?? []).map(richTextNodeToString).join('')).join(' | ');
    case 'tableCell':
      return (node.content ?? []).map(richTextNodeToString).join('');
    case 'tableHeader':
      return (node.content ?? []).map(richTextNodeToString).join('');
  }
}

/** Converts an array of rich text nodes to plain text, joining them with newlines. */
export function richTextNodesToString(nodes: RichTextNode[]): string {
  return nodes.map(richTextNodeToString).join('\n');
}

/** Converts a rich text document to its plain text representation. */
export function richTextDocumentToString(document: RichTextDocument): string {
  return richTextNodesToString(document.content ?? []);
}

/** Returns `true` if the document has no content or only whitespace. */
export function isRichTextDocumentEmpty(document: RichTextDocument): boolean {
  return (
    (document.content ?? []).length === 0 ||
    (document.content ?? []).every((node) => richTextNodeToString(node).trim() === '')
  );
}

/** Creates a rich text document containing a single paragraph with the given text. */
export function createRichTextDocumentFromString(text: string | null | undefined): RichTextDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  };
}

function createEmptyRichTextDocument(): RichTextDocument {
  return {
    type: 'doc',
    content: [],
  };
}

/** Parses a JSON string into a {@link RichTextDocument}. Returns an empty document if parsing fails or the input is nullish. */
export function parseRichTextDocument(text: string | null | undefined): RichTextDocument {
  if (!text) {
    return createEmptyRichTextDocument();
  }

  const parsed = JSON.parse(text);

  if (parsed.type !== 'doc') {
    return createEmptyRichTextDocument();
  }

  return parsed;
}
