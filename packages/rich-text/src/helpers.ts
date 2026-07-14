import type { DeepReadonly, RichTextDocument, RichTextNode } from './types';

/** Converts a single rich text node to its plain text representation. */
export function richTextNodeToString(node: DeepReadonly<RichTextNode>): string {
  if (node.type === 'text') {
    return node.text;
  }

  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'codeBlock':
    case 'blockquote': {
      return (node.content ?? []).map((node) => richTextNodeToString(node)).join('');
    }
    case 'bulletList':
    case 'orderedList': {
      return (node.content ?? []).map((item) => (item.content ?? []).map((node) => richTextNodeToString(node)).join('')).join('');
    }
    case 'listItem': {
      return (node.content ?? []).map((node) => richTextNodeToString(node)).join('');
    }
    case 'horizontalRule': {
      return '---';
    }
    case 'hardBreak': {
      return '\n';
    }
    case 'table': {
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? []).map((cell) => (cell.content ?? []).map((node) => richTextNodeToString(node)).join('')).join(' | '),
        )
        .join('\n');
    }
    case 'tableRow': {
      return (node.content ?? []).map((cell) => (cell.content ?? []).map((node) => richTextNodeToString(node)).join('')).join(' | ');
    }
    case 'tableCell': {
      return (node.content ?? []).map((node) => richTextNodeToString(node)).join('');
    }
    case 'tableHeader': {
      return (node.content ?? []).map((node) => richTextNodeToString(node)).join('');
    }
  }
}

/** Converts an array of rich text nodes to plain text, joining them with newlines. */
export function richTextNodesToString(nodes: readonly DeepReadonly<RichTextNode>[]): string {
  return nodes.map((node) => richTextNodeToString(node)).join('\n');
}

/** Converts a rich text document to its plain text representation. */
export function richTextDocumentToString(document: DeepReadonly<RichTextDocument>): string {
  return richTextNodesToString(document.content ?? []);
}

/** Returns `true` if the document has no content or only whitespace. */
export function isRichTextDocumentEmpty(document: DeepReadonly<RichTextDocument>): boolean {
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

/**
 * Parses a JSON string into a {@link RichTextDocument}.
 * Returns an empty document if parsing fails or the input is nullish.
 */
export function parseRichTextDocument(text: string | null | undefined): RichTextDocument {
  if (!text) {
    return createEmptyRichTextDocument();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return createEmptyRichTextDocument();
  }

  if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: unknown }).type !== 'doc') {
    return createEmptyRichTextDocument();
  }

  return parsed as RichTextDocument;
}
