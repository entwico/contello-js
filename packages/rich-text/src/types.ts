// document
export type RichTextDocument = {
  type: 'doc';
  content?: Maybe<RichTextNode[]>;
};

// nodes
export type RichTextNode =
  | RichTextHeading
  | RichTextParagraph
  | RichTextCodeBlock
  | RichTextBlockquote
  | RichTextHorizontalRule
  | RichTextHardBreak
  //
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextListItem
  //
  | RichTextTable
  | RichTextTableRow
  | RichTextTableHeader
  | RichTextTableCell
  //
  | RichTextText;

// blocks
export type RichTextHeading = {
  type: 'heading';
  attrs?: Maybe<{
    textAlign?: Maybe<RichTextTextAlign>;
    level?: Maybe<1 | 2 | 3 | 4 | 5 | 6>;
  }>;
  content?: Maybe<RichTextNode[]>;
};

export type RichTextParagraph = {
  type: 'paragraph';
  attrs?: Maybe<{
    textAlign?: Maybe<RichTextTextAlign>;
  }>;
  content?: Maybe<RichTextNode[]>;
};

export type RichTextCodeBlock = {
  type: 'codeBlock';
  content?: Maybe<RichTextText[]>;
};

export type RichTextBlockquote = {
  type: 'blockquote';
  content?: Maybe<RichTextText[]>;
};

// lists
export type RichTextBulletList = {
  type: 'bulletList';
  content?: Maybe<RichTextListItem[]>;
};

export type RichTextOrderedList = {
  type: 'orderedList';
  attrs?: Maybe<{ start?: Maybe<number> }>;
  content?: Maybe<RichTextListItem[]>;
};

export type RichTextListItem = {
  type: 'listItem';
  content?: Maybe<RichTextNode[]>;
};

// table
export type RichTextTable = {
  type: 'table';
  content?: Maybe<RichTextTableRow[]>;
};

export type RichTextTableRow = {
  type: 'tableRow';
  content?: Maybe<(RichTextTableHeader | RichTextTableCell)[]>;
};

export type RichTextTableHeader = {
  type: 'tableHeader';
  attrs?: Maybe<{
    colspan: Maybe<number>;
    rowspan: Maybe<number>;
    colwidth: Maybe<number[]>;
  }>;
  content?: Maybe<RichTextNode[]>;
};

export type RichTextTableCell = {
  type: 'tableCell';
  attrs?: Maybe<{
    colspan: Maybe<number>;
    rowspan: Maybe<number>;
    colwidth: Maybe<number[]>;
  }>;
  content?: Maybe<RichTextNode[]>;
};

// misc
export type RichTextHorizontalRule = {
  type: 'horizontalRule';
};

export type RichTextHardBreak = {
  type: 'hardBreak';
};

// text
export type RichTextText = {
  type: 'text';
  text: string;
  marks?: Maybe<RichTextMark[]>;
};

// marks
export type RichTextUnderlineMark = {
  type: 'underline';
};

export type RichTextBoldMark = {
  type: 'bold';
};

export type RichTextItalicMark = {
  type: 'italic';
};

export type RichTextCodeMark = {
  type: 'code';
};

export type RichTextStrikeMark = {
  type: 'strike';
};

export type RichTextTextStyleMark = {
  type: 'textStyle';
  attrs?: Maybe<{ color?: Maybe<string> }>;
};

export type RichTextLink<T extends Record<string, any> = Record<string, any>> = {
  type: 'link';
  attrs?: Maybe<{
    data?: Maybe<T>;
  }>;
};

export type RichTextMark =
  | RichTextUnderlineMark
  | RichTextBoldMark
  | RichTextItalicMark
  | RichTextCodeMark
  | RichTextStrikeMark
  | RichTextTextStyleMark
  | RichTextLink;

export type RichTextTextAlign = 'left' | 'center' | 'right';

export type Maybe<T> = T | null | undefined;
