# @contello/rich-text

TypeScript types and helpers for working with Contello CMS rich text documents (TipTap/ProseMirror JSON format).

## Installation

```bash
npm install @contello/rich-text
```

## Usage

### Parsing a rich text document

```ts
import { parseRichTextDocument } from '@contello/rich-text';

const doc = parseRichTextDocument(jsonString);
```

### Converting to plain text

```ts
import { richTextDocumentToString } from '@contello/rich-text';

const text = richTextDocumentToString(doc);
```

### Checking if a document is empty

```ts
import { isRichTextDocumentEmpty } from '@contello/rich-text';

if (isRichTextDocumentEmpty(doc)) {
  // no content
}
```

### Creating a document from a string

```ts
import { createRichTextDocumentFromString } from '@contello/rich-text';

const doc = createRichTextDocumentFromString('Hello world');
```

## API

### Types

- `RichTextDocument` — root document node (`type: 'doc'`)
- `RichTextNode` — union of all block and inline node types
- `RichTextMark` — union of all mark types (bold, italic, link, etc.)
- `Maybe<T>` — `T | null | undefined`

### Helpers

| Function | Description |
|----------|-------------|
| `parseRichTextDocument(text)` | Parse a JSON string into a `RichTextDocument`, returns empty doc on failure |
| `richTextDocumentToString(doc)` | Convert a document to plain text |
| `richTextNodesToString(nodes)` | Convert an array of nodes to plain text |
| `richTextNodeToString(node)` | Convert a single node to plain text |
| `isRichTextDocumentEmpty(doc)` | Check if a document has no meaningful content |
| `createRichTextDocumentFromString(text)` | Create a document with a single paragraph from a string |

## License

MIT
