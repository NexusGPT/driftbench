import { createHash } from 'node:crypto';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { mathFromMarkdown } from 'mdast-util-math';
import { parse, preprocess } from 'micromark';
import { directive } from 'micromark-extension-directive';
import { math } from 'micromark-extension-math';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { parseTOML } from 'toml-eslint-parser';
import { type Processor, unified } from 'unified';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Layer A of the pointer reader: cut a prose file into units by its structure. No word list, phrase pattern
 * or grammar tagger is used: a unit is a sentence, a list item, a table cell, a block quote paragraph, a
 * heading or a front matter value, and every unit is `source.slice(start, end)` of the file it came from.
 */

export type Container =
  | 'heading'
  | 'sentence'
  | 'list_item'
  | 'table_cell'
  | 'block_quote'
  | 'front_matter_value'
  | 'opaque';

export type Unit = {
  container: Container;
  /** UTF-16 offsets into the original file, byte-order mark included. */
  start: number;
  end: number;
  text: string;
  /** Fingerprint of the text: the unit's identity for change detection. */
  fp: string;
  /** The headings above the unit, outermost first. */
  path: string[];
  /** For a front matter value: its YAML path, such as `$.description`. */
  key?: string;
  /**
   * For a table cell: the text of the first cell of its row (its row key, empty in the header row), the text of the
   * header cell above it (its column header), and the place of the table in the file. The ledger follows a short or
   * repeated cell by its row key and column header.
   */
  cell?: { row: string; column: string; table: number; header?: true };
};

export type Cut = { units: Unit[]; digest: string };

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** NFC, white space collapsed, container markers stripped; case and emphasis are kept (prompts use them for force). */
export function fingerprint(text: string): string {
  const body = text
    .normalize('NFC')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|/gm, '')
    .replace(/\|\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sha(body).slice(0, 16);
}

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' });

/** A same-length mask of the spans that must not be cut: inline code, URLs, link destinations, emphasis marks. */
function mask(text: string, protect: ReadonlyArray<[number, number]> = []): string {
  const letters = (match: string) => 'x'.repeat(match.length);
  const spaces = (match: string) => ' '.repeat(match.length);
  // An email address is one word: the dots inside it are no stops (tried only where a run of its characters starts,
  // so a long run without an @ is read once). An ellipsis in square brackets marks an omission.
  // An ellipsis that opens a sentence after a stop reads as the capital of that sentence. Any other three dots,
  // spaced or not, or the ellipsis character, never end a sentence: a fourth dot after them is the full stop.
  // A footnote reference is a closing mark of the sentence it follows: a full stop before it still ends the sentence
  // after it, never inside it. The parser found the reference; here only its characters are hidden.
  let hidden = text;
  for (const [from, to] of protect)
    hidden = hidden.slice(0, from) + ')'.repeat(Math.max(0, to - from)) + hidden.slice(to);
  return hidden
    .replace(/`+[^`]*`+/g, letters)
    .replace(/\]\([^)]*\)/g, letters)
    .replace(/https?:\/\/\S*[^\s.,;:!?)\]'"”’]/g, letters)
    .replace(/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, letters)
    .replace(/\[(?:\.\.\.|…)\]/g, letters)
    .replace(
      /([.!?]['"”’)\]]*\s+)(\.\.\.|…)(?=\p{L})/gu,
      (_match, lead: string, dots: string) => lead + 'X'.repeat(dots.length),
    )
    .replace(/\.(?: ?\.){2}|…/g, letters)
    .replace(/\*+/g, spaces)
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, spaces)
    .replace(/[\r\n]/g, ' ')
    .replace(/([.!?]['"”’)\]]*\s+)(\p{Ll}[^\s]*)/gu, (match, stop: string, word: string) => {
      // The segmenter never breaks before a lower-case letter. A word that starts lower case and holds a capital
      // inside (iOS, eBay) is a name, and a sentence may start with it: raise its first letter so the segmenter
      // reports the boundary. An all lower-case word continues the sentence, and the segmenter's own decision stands.
      const first = word.slice(0, 1);
      const raised = first.toUpperCase();
      const named = /\p{Lu}/u.test(word.slice(1));
      return named && raised.length === first.length ? stop + raised + word.slice(1) : match;
    });
}

/** Whether a segment break is a likely false split, decided by the shape of the text around it only. */
function shouldMerge(before: string, after: string): boolean {
  // Directional and other format marks (U+202A around a stop in right-to-left text) are not part of the shape.
  const head = before.replace(/\p{Cf}/gu, '').trimEnd();
  // A short capitalised word or a single-letter abbreviation before the stop: "Dr.", "e.g.", "A."
  if (/(?:^|[\s(])(\p{Lu}\p{Ll}{0,2}|\p{L}|\p{L}\.\p{L})\.$/u.test(head)) return true;
  if (/\d\.$/.test(head) && /^\d/.test(after.trimStart())) return true;
  // A clear boundary stays when the next sentence starts in lower case; a digit or a closing mark is unsure.
  if (/^\s*\d/.test(after)) return true;
  if (/^\s*[)\]"'”’]/.test(after)) return true;
  return false;
}

/** Whether a file is plain text: its line breaks are all the structure it has, where markdown has soft wraps. */
export function isPlainTextPath(path: string): boolean {
  return /\.txt$/i.test(path);
}

/** A title line is at most this share of the typical length of the other lines of its paragraph and of the line after it. */
export const TITLE_SHARE = 0.4;

/**
 * The blocks of a plain text paragraph: the paragraph, cut after each title line. A title line
 * - opens a sentence: it is the first line, or the line before it ends with a full stop, a question mark or an
 *   exclamation mark (a wrapped sentence has no title in its middle),
 * - does not start in lower case, and has no sign that the sentence goes on (a comma, a colon, a dash) at its end,
 * - is far shorter than the typical line of the others (their median, so one very long line moves nothing) and
 *   than the line after it, which does not start in lower case.
 * A hard wrapped line is as long as its neighbours, so a wrapped sentence stays whole; a table of rows has no short
 * line. By shape only, and when unsure the lines stay together.
 */
function plainBlocks(source: string, from: number, to: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let at = from;
  for (const line of source.slice(from, to).split('\n')) {
    lines.push([at, at + line.length]);
    at += line.length + 1;
  }
  const texts = lines.map(([start, end]) => source.slice(start, end).trim());
  const order = texts
    .map((_, index) => index)
    .sort((a, b) => (texts[a]?.length ?? 0) - (texts[b]?.length ?? 0));
  const rank = new Map(order.map((line, place) => [line, place]));
  // The upper median of the lengths of all lines but one, read from the order of all lines.
  const typical = (line: number): number => {
    const middle = Math.floor((order.length - 1) / 2);
    const place = rank.get(line) ?? 0;
    return texts[order[place <= middle ? middle + 1 : middle] ?? line]?.length ?? 0;
  };
  const blocks: Array<[number, number]> = [];
  let start = from;
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    if (!next) return;
    const text = texts[index] ?? '';
    const after = texts[index + 1] ?? '';
    const opens = index === 0 || /[.!?]$/.test(texts[index - 1] ?? '');
    const title =
      opens &&
      text.length > 0 &&
      !/^[\p{Ll}\d)\]"'\u201d\u2019]/u.test(text) &&
      !/[,;:\u2013\u2014-]$/.test(text) &&
      after.length > 0 &&
      !/^[\p{Ll}\d)\]"'\u201d\u2019]/u.test(after) &&
      text.length <= typical(index) * TITLE_SHARE &&
      text.length <= after.length * TITLE_SHARE;
    if (!title) return;
    blocks.push([start, line[1]]);
    start = next[0];
  });
  blocks.push([start, to]);
  return blocks;
}

/** The offsets of the footnote references in a paragraph, by the parser's own nodes. */
/**
 * Where JSON front matter ends: a file that opens with `{` and whose first complete JSON object, read by a JSON
 * parser, ends a line. A string with braces, an escaped quote or a nested object does not end it early. Undefined when
 * the file does not open with such an object.
 */
export function jsonFrontMatterEnd(source: string): number | undefined {
  if (!source.startsWith('{')) return undefined;
  let depth = 0;
  let inString = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (inString) {
      if (char === '\\') at++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        const lineEnd = source.indexOf('\n', at);
        const rest = source.slice(at + 1, lineEnd === -1 ? source.length : lineEnd);
        if (rest.trim() !== '') return undefined;
        try {
          const value: unknown = JSON.parse(source.slice(0, at + 1));
          return value !== null && typeof value === 'object' && !Array.isArray(value) ? at + 1 : undefined;
        } catch {
          return undefined;
        }
      }
      if (depth < 0) return undefined;
    }
  }
  return undefined;
}

/** The offsets of the footnote references in a paragraph, by the parser's own nodes. */
function footnoteReferences(paragraph: Node): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const walk = (node: Node) => {
    if (node.type === 'footnoteReference' && node.position)
      found.push([node.position.start.offset ?? 0, node.position.end.offset ?? 0]);
    for (const child of node.children ?? []) walk(child);
  };
  walk(paragraph);
  return found;
}

/** The five types of a GitHub alert, as the marker line writes them. Any other `[!X]` is an ordinary quote. */
const ALERT_TYPES: ReadonlySet<string> = new Set(
  ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((type) => `[!${type}]`),
);

/**
 * A GitHub alert is a block quote whose first line is one of the five markers alone (`> [!NOTE]`, `> [!WARNING]`): the
 * marker syntax of the GFM alert, which no parser of our stack reads. Returns the type, as written, with brackets, and where
 * the text after the marker line starts; the marker is a mark and is in no unit.
 */
function alertOf(quote: Node, text: string): { type: string; from: number; paragraph: Node } | undefined {
  const paragraph = quote.children?.[0];
  if (paragraph?.type !== 'paragraph') return undefined;
  const start = paragraph.position?.start.offset ?? 0;
  const end = paragraph.position?.end.offset ?? start;
  // A marker later in the quote (even after an opening blank line) is ordinary quoted text.
  if (text.lastIndexOf('\n', start) !== text.lastIndexOf('\n', quote.position?.start.offset ?? 0))
    return undefined;
  const lineEnd = text.indexOf('\n', start);
  const type = text.slice(start, lineEnd === -1 ? end : Math.min(lineEnd, end)).trimEnd();
  if (!ALERT_TYPES.has(type)) return undefined;
  if (lineEnd === -1 || lineEnd >= end) return { type, from: end, paragraph };
  // Parse the continuation line for its content offset. Its first inline node may be emphasis, code, a link, etc.;
  // neither a text child's value nor a search for its prose can locate that content reliably.
  const nextEnd = text.indexOf('\n', lineEnd + 1);
  const line = text.slice(lineEnd + 1, nextEnd === -1 ? end : Math.min(nextEnd, end));
  let content = PROCESSOR.parse(line) as unknown as Node;
  while (content.children?.[0] && (content.type === 'root' || content.type === 'blockquote'))
    content = content.children[0];
  return { type, from: lineEnd + 1 + (content.position?.start.offset ?? 0), paragraph };
}

/** A paragraph that opens or closes with a line holding only a tag does not own that line. */
function withoutTagLines(source: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  for (;;) {
    const open = source.indexOf('\n', start);
    if (open !== -1 && open < end && TAG_ONLY.test(source.slice(start, open))) start = open + 1;
    else break;
  }
  for (;;) {
    const close = source.lastIndexOf('\n', end - 1);
    if (close >= start && TAG_ONLY.test(source.slice(close + 1, end))) end = close;
    else break;
  }
  return [start, end];
}

function trimSpan(source: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  while (end > start && /\s/.test(source[end - 1] ?? '')) end--;
  return [start, end];
}

/** The sentence spans of `source[from, to)`, merged when unsure: a wrong merge costs granularity, a wrong split a wrong quote. */
export function sentenceSpans(
  source: string,
  from: number,
  to: number,
  protect: ReadonlyArray<[number, number]> = [],
): Array<[number, number]> {
  const masked = mask(
    source.slice(from, to),
    protect.map(([start, end]) => [start - from, end - from] as [number, number]),
  );
  const spans: Array<[number, number]> = [];
  let current: [number, number] | undefined;
  for (const segment of SEGMENTER.segment(masked)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (masked.slice(start, end).trim() === '') continue;
    if (current && shouldMerge(masked.slice(current[0], current[1]), masked.slice(start, end))) {
      current[1] = end;
    } else {
      if (current) spans.push(current);
      current = [start, end];
    }
  }
  if (current) spans.push(current);
  return spans.map(([start, end]) => trimSpan(source, from + start, from + end));
}

type Node = {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  depth?: number;
  /** A footnote definition's label, as written; a directive's name; the value of a front matter or math node. */
  label?: string;
  name?: string;
  value?: string;
};

/**
 * The block syntaxes of the cutter beyond GFM, each from its maintained extension: container directives (`:::name`)
 * and display math (`$$` lines). Only their block parts are used: the inline forms (a text directive, `$x$`) would
 * read prose such as a price or a time as syntax.
 */
function remarkBlockSyntax(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>;
  const syntax = data.micromarkExtensions ?? [];
  const fromMarkdown = data.fromMarkdownExtensions ?? [];
  syntax.push({ flow: directive().flow }, { flow: math({ singleDollarTextMath: false }).flow });
  fromMarkdown.push(directiveFromMarkdown(), mathFromMarkdown());
  data.micromarkExtensions = syntax;
  data.fromMarkdownExtensions = fromMarkdown;
}

const PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkGfm)
  .use(remarkBlockSyntax);

type Context = {
  /** The nearest list item or quote owns prose, including prose reparsed from HTML. */
  prose?: 'list_item' | 'block_quote';
  /** Names that end the heading path of every unit below: a footnote label, a directive name, an alert type. */
  extra?: string[];
  /** Only this parser paragraph owns the alert marker line; all descendants inherit the type. */
  alert?: { paragraph: Node; from: number };
  /** The row key, column header and table of the cell being cut. */
  cell?: Unit['cell'];
};

const TAG_ONLY = /^\s*<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>\s*$/;

/** How deep lists and block quotes may nest in a file. The parser takes time that grows faster than the file does. */
export const MAX_NESTING = 100;

/** A file the cutter refuses, with the reason. */
export class CutError extends Error {
  constructor(
    message: string,
    /** The reason as a code a caller reads: `nesting` is a file nested deeper than `MAX_NESTING`. */
    readonly code: 'nesting' = 'nesting',
    /** The file, when a caller that knows it names it. */
    readonly path?: string,
    /** The depth found. */
    readonly depth?: number,
  ) {
    super(message);
    this.name = 'CutError';
  }

  /** The same refusal with the file it concerns. */
  at(path: string): CutError {
    return new CutError(`${path}: ${this.message}`, this.code, path, this.depth);
  }
}

/** The deepest nesting of list items and block quotes by their markers, outside fences, in one pass. */
export function nestingOf(source: string): number {
  let deepest = 0;
  let fence: string | undefined;
  const open: number[] = [];
  let blank = true;
  for (const line of source.split(/\r\n|\r|\n/)) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined) {
      if (fence === undefined) fence = mark.charAt(0);
      else if (mark.charAt(0) === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const quotes = /^(?:\s{0,3}>)+/.exec(line)?.[0].split('>').length ?? 1;
    if (line.trim() === '') {
      blank = true;
      continue;
    }
    const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
    // A tab advances to the next multiple of four columns, as a list item reads it.
    let own = 0;
    for (const char of lead) own = char === '\t' ? own + 4 - (own % 4) : own + 1;
    const item = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]/.test(line);
    const indent = item ? own : undefined;
    // A list is a stack of the indents of its open items: an item closes the items at its indent or deeper. Any
    // other line closes the items at or right of its own indent, except a paragraph line straight after a line of
    // text (not a heading or a quote), which continues the paragraph of the last item whatever its indent (a lazy line).
    if (indent !== undefined || blank || /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|>)/.test(line)) {
      while (open.length > 0 && (open.at(-1) as number) >= (indent ?? own)) open.pop();
    }
    blank = false;
    if (indent !== undefined) open.push(indent);
    deepest = Math.max(deepest, quotes - 1, open.length);
  }
  return deepest;
}

/** The most lines of one paragraph the markdown parser reads in one call. */
export const SLAB_LINES = 5_000;

const linesIn = (text: string): number => {
  let count = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++;
  return count;
};

/**
 * Whether two lines, read as the start of a file, are one paragraph of the kind: the parser decides, not a rule here.
 * A cut between them cuts one paragraph, and each part is that paragraph again. `quote` is a block quote of one
 * paragraph (a lazy line, a blank quote line, a nested quote or a fence inside it is not).
 */
const continues = (before: string, line: string, quote: boolean): boolean => {
  const parsed = (text: string): Node[] => (PROCESSOR.parse(text) as unknown as Node).children ?? [];
  const one = (nodes: Node[]): boolean =>
    quote
      ? nodes.length === 1 &&
        nodes[0]?.type === 'blockquote' &&
        nodes[0].children?.length === 1 &&
        nodes[0].children[0]?.type === 'paragraph'
      : nodes.length === 1 && nodes[0]?.type === 'paragraph';
  return one(parsed(before)) && one(parsed(`${before}\n${line}`)) && one(parsed(line));
};

/**
 * The offsets at which a text is read in parts. The markdown parser's cost grows much faster than the lines of one
 * paragraph (150,000 lines take a minute, in parts of 5,000 about a second), so a paragraph over `slab` lines is
 * read in parts. The block structure comes from the parser's own block passes, which do not read the text of a
 * paragraph and are linear: the flow pass finds the paragraphs outside any container, the document pass the top
 * level block quotes. A cut falls only between two lines that the parser reads as one paragraph (one paragraph of a
 * quote), never inside a fence, a heading, a table, a list, a front matter or a lazy continuation of a quote. A
 * sentence over a cut is two units; the parts of a quote are joined back into the one unit it is (`join`).
 */
function cutsOf(text: string, slab: number): Array<{ at: number; join: boolean }> {
  if (linesIn(text) <= slab) return [];
  PROCESSOR.freeze();
  const extensions = (PROCESSOR.data('micromarkExtensions') as never[] | undefined) ?? [];
  const chunks = preprocess()(text, undefined, true);
  const cuts: Array<{ at: number; join: boolean }> = [];
  const along = (from: number, to: number, quote: boolean) => {
    let lines = 0;
    let at = text.lastIndexOf('\n', from) + 1;
    let before = '';
    while (at < to) {
      const end = text.indexOf('\n', at);
      const next = end === -1 ? text.length : end + 1;
      const line = text.slice(at, end === -1 ? undefined : end);
      if (lines >= slab && lines > 0 && next <= to && continues(before, line, quote)) {
        cuts.push({ at, join: quote });
        lines = 0;
      }
      lines++;
      before = line;
      at = next;
    }
  };
  // The containers of the document: a paragraph inside one is read with it, not by the flow pass.
  const inside: Array<[number, number]> = [];
  for (const [kind, token] of parse({ extensions }).document().write(chunks)) {
    if (
      kind !== 'enter' ||
      (token.type !== 'blockQuote' &&
        token.type !== 'listItemPrefix' &&
        token.type !== 'listOrdered' &&
        token.type !== 'listUnordered')
    )
      continue;
    const range: [number, number] = [token.start.offset, token.end.offset];
    if (inside.some(([a, b]) => range[0] >= a && range[0] < b)) continue;
    inside.push(range);
    if (
      token.type === 'blockQuote' &&
      token.start.column === 1 &&
      token.end.line - token.start.line + 1 > slab
    )
      along(token.start.offset, token.end.offset, true);
  }
  for (const [kind, token] of parse({ extensions }).flow().write(chunks)) {
    if (kind !== 'enter' || token.type !== 'paragraph') continue;
    if (token.end.line - token.start.line + 1 <= slab) continue;
    if (inside.some(([a, b]) => token.start.offset >= a && token.start.offset < b)) continue;
    along(token.start.offset, token.end.offset, false);
  }
  return cuts.sort((x, y) => x.at - y.at);
}

export type CutOptions = {
  /** The file is plain text (`isPlainTextPath`): a title line ends at its line break. */
  plain?: boolean;
  /** The most lines of one paragraph the parser reads at once (`SLAB_LINES`); a test sets a small value. */
  slabLines?: number;
};

/** Cuts a file into units, and hashes the ordered list of unit fingerprints into the cut digest. */
export function cut(rawSource: string, options: CutOptions = {}): Cut {
  const nesting = nestingOf(rawSource);
  if (nesting > MAX_NESTING) {
    throw new CutError(
      `the file nests lists or quotes ${nesting} levels deep, over the limit of ${MAX_NESTING}: it cannot be cut`,
      'nesting',
      undefined,
      nesting,
    );
  }
  const base = rawSource.charCodeAt(0) === 0xfeff ? 1 : 0;
  const source = rawSource.slice(base);
  const units: Unit[] = [];

  const add = (
    container: Container,
    start: number,
    end: number,
    path: string[],
    key?: string,
    cell?: Unit['cell'],
  ) => {
    const [from, to] = trimSpan(source, start, end);
    if (to <= from) return;
    const text = source.slice(from, to);
    units.push({
      container,
      start: from + base,
      end: to + base,
      text,
      fp: fingerprint(text),
      path: [...path],
      ...(key ? { key } : {}),
      ...(cell ? { cell } : {}),
    });
  };

  /** A string value of front matter is a unit keyed by its path (`$.title`, `$.tags[1]`); `from`/`to` are in the file. */
  const value = (from: number, to: number, key: string) => add('front_matter_value', from, to, [], key);

  const frontMatter = (start: number, end: number, kind: 'yaml' | 'toml' | 'json') => {
    const block = source.slice(start, end);
    try {
      if (kind === 'toml') return tomlFrontMatter(block, start);
      // JSON is YAML's flow style: the same walk reads it. Its fences are part of the object, its strings are quoted.
      const opening = kind === 'json' ? '' : (/^---\r?\n/.exec(block)?.[0] ?? '');
      const body = kind === 'json' ? block : block.slice(opening.length).replace(/\r?\n---\s*$/, '');
      const document = parseDocument(body);
      const walk = (node: unknown, key: string) => {
        if (isScalar(node) && typeof node.value === 'string' && node.range) {
          let [from, to] = node.range;
          // A block scalar's range opens at its `>` or `|` header; the value starts on the next line.
          const folded = node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL';
          const newline = folded ? body.indexOf('\n', from) : -1;
          if (folded && newline !== -1 && newline < to) from = newline + 1;
          // The value of a JSON string is the text between its quotes.
          if (kind === 'json' && node.type === 'QUOTE_DOUBLE') [from, to] = [from + 1, to - 1];
          value(start + opening.length + from, start + opening.length + to, key);
        } else if (isMap(node)) {
          for (const pair of node.items) {
            walk(pair.value, `${key}.${String((pair.key as { value?: unknown } | null)?.value)}`);
          }
        } else if (isSeq(node)) {
          node.items.forEach((item, index) => {
            walk(item, `${key}[${index}]`);
          });
        }
      };
      walk(document.contents, '$');
    } catch {
      add('opaque', start, end, []);
    }
  };

  /** TOML front matter between `+++` lines: a real TOML parser gives the tree and the range of each string. */
  const tomlFrontMatter = (block: string, start: number) => {
    const opening = /^\+\+\+\r?\n/.exec(block)?.[0] ?? '';
    const body = block.slice(opening.length).replace(/\r?\n\+\+\+\s*$/, '');
    type TomlNode = {
      type: string;
      kind?: string;
      style?: string;
      value?: unknown;
      range: [number, number];
      keys?: Array<{ name?: string; value?: string }>;
      key?: { keys: Array<{ name?: string; value?: string }> };
      resolvedKey?: Array<string | number>;
      body?: TomlNode[];
      elements?: TomlNode[];
    };
    const keyName = (part: { name?: string; value?: string }) => String(part.name ?? part.value ?? '');
    const quotes: Record<string, number> = { basic: 1, literal: 1, 'multi-basic': 3, 'multi-literal': 3 };
    const walk = (node: TomlNode, key: string) => {
      if (node.type === 'TOMLValue' && node.kind === 'string') {
        let [from, to] = node.range;
        const fence = quotes[node.style ?? 'basic'] ?? 1;
        [from, to] = [from + fence, to - fence];
        // A multi-line string drops the line break that follows its opening fence.
        if (fence === 3 && /^\r?\n/.test(body.slice(from)))
          from += body.slice(from).startsWith('\r\n') ? 2 : 1;
        value(start + opening.length + from, start + opening.length + to, key);
      } else if (node.type === 'TOMLArray') {
        (node.elements ?? []).forEach((element, index) => {
          walk(element, `${key}[${index}]`);
        });
      } else if (
        node.type === 'TOMLInlineTable' ||
        node.type === 'TOMLTable' ||
        node.type === 'TOMLTopLevelTable'
      ) {
        let base = key;
        if (node.type === 'TOMLTable') {
          // The parser resolves both this table's array index and every active array-table ancestor.
          base = `$${(node.resolvedKey ?? [])
            .map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))
            .join('')}`;
        }
        for (const child of node.body ?? []) walk(child, base);
      } else if (node.type === 'TOMLKeyValue' && node.key) {
        const inner = (node as unknown as { value: TomlNode }).value;
        walk(inner, `${key}${node.key.keys.map((part) => `.${keyName(part)}`).join('')}`);
      }
    };
    const program = parseTOML(body) as unknown as { body: TomlNode[] };
    for (const top of program.body) walk(top, '$');
  };

  let tables = 0;

  const markdown = (
    text: string,
    locate: (position: number) => number,
    inherited: string[],
    depth: number,
    context: Context = {},
    trail: Array<{ depth: number; title: string }> = [],
    sliced = false,
    continuation?: Context,
  ): Context | undefined => {
    const at = (n: number | undefined) => locate(n ?? 0);
    const cuts = sliced ? [] : cutsOf(text, options.slabLines ?? SLAB_LINES);
    if (cuts.length > 0) {
      const edges = [0, ...cuts.map((cutAt) => cutAt.at), text.length];
      let quoteContext: Context | undefined;
      for (let part = 0; part + 1 < edges.length; part++) {
        const before = units.length;
        const edge = edges[part] as number;
        quoteContext = markdown(
          text.slice(edge, edges[part + 1]),
          (position) => at(edge + position),
          inherited,
          depth,
          context,
          trail,
          true,
          part > 0 && cuts[part - 1]?.join ? quoteContext : undefined,
        );
        // The parts of one block quote are one unit: the first unit of this part joins the last of the one before.
        if (part > 0 && cuts[part - 1]?.join && units.length > before && before > 0) {
          const joined = units[before - 1] as Unit;
          const next = units[before] as Unit;
          if (joined.container === 'block_quote' && next.container === 'block_quote') {
            const text = source.slice(joined.start - base, next.end - base);
            units.splice(before - 1, 2, { ...joined, end: next.end, text, fp: fingerprint(text) });
          }
        }
      }
      return quoteContext;
    }
    const tree = PROCESSOR.parse(text) as unknown as Node;
    let quoteContext: Context | undefined;
    const here = () => [...inherited, ...trail.map((entry) => entry.title)];
    // Every leaf, including the opaque/HTML branches, uses the same path construction.
    const emit = (kind: Container, from: number, to: number, context: Context) =>
      add(
        kind,
        at(from),
        at(to),
        [...here(), ...(context.extra ?? [])],
        undefined,
        kind === 'table_cell' ? context.cell : undefined,
      );

    const htmlBlock = (node: Node, context: Context) => {
      const from = node.position?.start.offset ?? 0;
      const to = node.position?.end.offset ?? from;
      if (/^\s*<!--/.test(node.value ?? '')) return emit('opaque', from, to, context);

      // The HTML node's value is container-relative: the parser has removed quote prefixes and footnote/list
      // indentation. Reparse that view, mapping its positions back to the original source, never emitting its value.
      const rawLines = text.slice(from, to).split(/(\r\n|\r|\n)/);
      const lines = (node.value ?? text.slice(from, to)).split(/\r\n|\r|\n/);
      let rawAt = from;
      let viewAt = 0;
      const positions = lines.map((line, index) => {
        const raw = rawLines[index * 2] ?? '';
        const position = { viewAt, rawAt: rawAt + raw.length - line.length };
        rawAt += raw.length + (rawLines[index * 2 + 1]?.length ?? 0);
        viewAt += line.length + 1;
        return position;
      });
      const block = lines.join('\n');
      // Container prefixes change only line starts. A line map avoids allocating one entry per character of HTML.
      const original = (position: number) => {
        let low = 0;
        let high = positions.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if ((positions[middle]?.viewAt ?? 0) <= position) low = middle;
          else high = middle - 1;
        }
        const line = positions[low];
        return line ? at(line.rawAt + position - line.viewAt) : at(to);
      };
      // Lines holding only a tag separate chunks; their contents retain the enclosing context and interpretation.
      let position = 0;
      let chunkStart = -1;
      let chunkEnd = -1;
      const flush = () => {
        if (chunkStart >= 0) {
          const start = chunkStart;
          markdown(
            block.slice(start, chunkEnd),
            (position) => original(start + position),
            here(),
            depth + 1,
            context,
          );
        }
        chunkStart = -1;
      };
      for (const line of lines) {
        if (TAG_ONLY.test(line)) flush();
        else {
          if (chunkStart < 0) chunkStart = position;
          chunkEnd = position + line.length;
        }
        position += line.length + 1;
      }
      flush();
    };

    // The sole context boundary. All parser nodes (containers and leaves alike) enter here; block handlers only
    // consume the resulting context. Reparsed HTML enters through the same root descent with that context intact.
    const descend = (node: Node, parent: Context) => {
      if ((node as { data?: { directiveLabel?: boolean } }).data?.directiveLabel) return;
      let context = parent;
      switch (node.type) {
        case 'footnoteDefinition':
          context = { ...parent, extra: [...(parent.extra ?? []), `[^${node.label ?? ''}]`] };
          break;
        case 'containerDirective':
          context = { ...parent, extra: [...(parent.extra ?? []), node.name ?? ''] };
          break;
        case 'listItem':
          context = { ...parent, prose: 'list_item' };
          break;
        case 'blockquote': {
          // A parser slab can begin in the middle of the same quote. Reuse its frame; a marker on this later line
          // cannot turn an ordinary quote into an alert, and an existing alert keeps its type on later paragraphs.
          const alert = continuation && node === tree.children?.[0] ? undefined : alertOf(node, text);
          context =
            continuation && node === tree.children?.[0]
              ? continuation
              : {
                  ...parent,
                  prose: 'block_quote',
                  extra: alert ? [...(parent.extra ?? []), alert.type] : parent.extra,
                  alert: alert ?? parent.alert,
                };
          if (node === tree.children?.at(-1)) quoteContext = context;
          break;
        }
      }
      visit(node, context);
    };

    const visit = (node: Node, context: Context) => {
      let start = node.position?.start.offset ?? 0;
      let end = node.position?.end.offset ?? 0;
      switch (node.type) {
        case 'yaml':
        case 'toml':
          if (depth === 0 && at(0) === 0) frontMatter(at(start), at(end), node.type);
          return;
        case 'math':
        case 'code':
          // A display math block or fence is opaque: its contents are never read as prose.
          return emit('opaque', start, end, context);
        case 'heading': {
          const kids = node.children ?? [];
          const first = kids[0]?.position?.start.offset ?? start;
          const last = kids.at(-1)?.position?.end.offset ?? end;
          const title = text.slice(first, last).trim();
          while (trail.length > 0 && (trail.at(-1)?.depth ?? 0) >= (node.depth ?? 1)) trail.pop();
          emit('heading', start, end, context);
          trail.push({ depth: node.depth ?? 1, title });
          return;
        }
        case 'paragraph': {
          [start, end] = withoutTagLines(text, start, end);
          if (context.alert?.paragraph === node) start = Math.max(start, context.alert.from);
          if (start >= end) return;
          if (context.prose) return emit(context.prose, start, end, context);
          const references = footnoteReferences(node);
          for (const [blockFrom, blockTo] of options.plain
            ? plainBlocks(text, start, end)
            : ([[start, end]] as Array<[number, number]>))
            for (const [from, to] of sentenceSpans(text, blockFrom, blockTo, references))
              emit('sentence', from, to, context);
          return;
        }
        case 'html':
          // A nested HTML block that does not shrink is opaque, so reparsing terminates.
          if (depth >= 2) return emit('opaque', start, end, context);
          return htmlBlock(node, context);
        case 'table': {
          // Each cell carries its row key (the first cell of its row; none in the header row) and its column header.
          const cellText = (cell: Node): string => {
            const kids = cell.children ?? [];
            const from = kids[0]?.position?.start.offset;
            const to = kids.at(-1)?.position?.end.offset;
            return from === undefined || to === undefined
              ? ''
              : text.slice(from, to).replace(/\s+/g, ' ').trim();
          };
          const rows = node.children ?? [];
          const header = (rows[0]?.children ?? []).map(cellText);
          tables += 1;
          rows.forEach((row, rowAt) => {
            const cells = row.children ?? [];
            const rowKey = rowAt === 0 ? '' : cellText(cells[0] as Node);
            cells.forEach((cell, column) => {
              descend(cell, {
                ...context,
                cell: {
                  row: rowKey,
                  column: header[column] ?? '',
                  table: tables,
                  ...(rowAt === 0 ? { header: true as const } : {}),
                },
              });
            });
          });
          return;
        }
        case 'tableCell': {
          const kids = node.children ?? [];
          if (kids.length > 0) {
            const first = kids[0]?.position?.start.offset ?? start;
            const last = kids.at(-1)?.position?.end.offset ?? end;
            emit('table_cell', first, last, context);
          }
          return;
        }
        default:
          for (const child of node.children ?? []) descend(child, context);
      }
    };

    descend(tree, context);
    return quoteContext;
  };

  const jsonEnd = jsonFrontMatterEnd(source);
  if (jsonEnd === undefined) markdown(source, (position) => position, [], 0);
  else {
    frontMatter(0, jsonEnd, 'json');
    markdown(source.slice(jsonEnd), (position) => jsonEnd + position, [], 0);
  }
  return { units, digest: sha(units.map((unit) => `${unit.container}:${unit.fp}`).join('\n')) };
}
