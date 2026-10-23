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
  // A footnote reference is a closing mark of the sentence it follows: a full stop before it still ends the sentence
  // after it, never inside it. The parser found the reference; here only its characters are hidden.
  let hidden = text;
  for (const [from, to] of protect)
    hidden = hidden.slice(0, from) + ')'.repeat(Math.max(0, to - from)) + hidden.slice(to);
  return hidden
    .replace(/`+[^`]*`+/g, letters)
    .replace(/\]\([^)]*\)/g, letters)
    .replace(/https?:\/\/\S*[^\s.,;:!?)\]'"”’]/g, letters)
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
  const head = before.trimEnd();
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

/**
 * A GitHub alert is a block quote whose first line is `[!` TYPE `]` alone (`> [!NOTE]`, `> [!WARNING]`): the marker
 * syntax of the GFM alert, which no parser of our stack reads. Returns the type, as written, with brackets, and where
 * the text after the marker line starts; the marker is a mark and is in no unit.
 */
function alertOf(paragraph: Node, text: string, start: number): { type: string; from: number } | undefined {
  const first = paragraph.children?.[0] as (Node & { value?: string }) | undefined;
  if (first?.type !== 'text' || typeof first.value !== 'string') return undefined;
  const line = first.value.split('\n')[0] ?? '';
  const type = /^\[!([A-Z]+)\]$/.exec(line)?.[0];
  if (!type) return undefined;
  const lineEnd = text.indexOf('\n', start);
  if (lineEnd === -1) return { type, from: Number.POSITIVE_INFINITY };
  // The next line starts after its quote marker, which the parser has already removed from the node's value.
  const rest = first.value.slice(line.length + 1).split('\n')[0] ?? '';
  const found = rest === '' ? -1 : text.indexOf(rest, lineEnd + 1);
  return { type, from: found === -1 ? Number.POSITIVE_INFINITY : found };
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
  (data.micromarkExtensions ??= []).push(
    { flow: directive().flow },
    { flow: math({ singleDollarTextMath: false }).flow },
  );
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown(), mathFromMarkdown());
}

const PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml', { type: 'json', fence: { open: '{', close: '}' } }])
  .use(remarkGfm)
  .use(remarkBlockSyntax);

type Context = {
  inList?: boolean;
  inQuote?: boolean;
  /** Names that end the heading path of every unit below: a footnote label, a directive name, an alert type. */
  extra?: string[];
  /** The marker line of an alert is no unit: the first paragraph of the quote starts after it. */
  skipFirstLine?: boolean;
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
  for (const line of source.split(/\r\n|\r|\n/)) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark !== undefined) {
      if (fence === undefined) fence = mark.charAt(0);
      else if (mark.charAt(0) === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const quotes = /^(?:\s{0,3}>)+/.exec(line)?.[0].split('>').length ?? 1;
    if (line.trim() === '') continue;
    const indent = /^( *)(?:[-+*]|\d+[.)])\s/.exec(line)?.[1]?.length;
    const own = /^ */.exec(line)?.[0].length ?? 0;
    // A list is a stack of the indents of its open items: an item closes the items at its indent or deeper, and so
    // does any other line that starts at or left of them. The depth is the stack, whatever the indent per level.
    while (open.length > 0 && (open.at(-1) as number) >= (indent ?? own)) open.pop();
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

  const add = (container: Container, start: number, end: number, path: string[], key?: string) => {
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
      body?: TomlNode[];
      elements?: TomlNode[];
    };
    const keyName = (part: { name?: string; value?: string }) => String(part.name ?? part.value ?? '');
    const quotes: Record<string, number> = { basic: 1, literal: 1, 'multi-basic': 3, 'multi-literal': 3 };
    const arrays = new Map<string, number>();
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
        if (node.type === 'TOMLTable' && node.key) {
          base = `$${node.key.keys.map((part) => `.${keyName(part)}`).join('')}`;
          if (node.kind === 'array') {
            const index = arrays.get(base) ?? 0;
            arrays.set(base, index + 1);
            base = `${base}[${index}]`;
          }
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

  const markdown = (
    text: string,
    offset: number,
    inherited: string[],
    depth: number,
    trail: Array<{ depth: number; title: string }> = [],
    sliced = false,
  ) => {
    const cuts = sliced ? [] : cutsOf(text, options.slabLines ?? SLAB_LINES);
    if (cuts.length > 0) {
      const edges = [0, ...cuts.map((cutAt) => cutAt.at), text.length];
      for (let part = 0; part + 1 < edges.length; part++) {
        const before = units.length;
        markdown(
          text.slice(edges[part], edges[part + 1]),
          offset + (edges[part] as number),
          inherited,
          depth,
          trail,
          true,
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
      return;
    }
    const tree = PROCESSOR.parse(text) as unknown as Node;
    const here = () => [...inherited, ...trail.map((entry) => entry.title)];
    const at = (n: number | undefined) => (n ?? 0) + offset;

    const htmlBlock = (from: number, to: number) => {
      const block = text.slice(from, to);
      if (/^\s*<!--/.test(block)) {
        add('opaque', at(from), at(to), here());
        return;
      }
      // Lines that hold only a tag separate chunks; the markdown between them is cut like any prose.
      let position = from;
      let chunkStart = -1;
      let chunkEnd = -1;
      const flush = () => {
        if (chunkStart >= 0) markdown(text.slice(chunkStart, chunkEnd), at(chunkStart), here(), depth + 1);
        chunkStart = -1;
      };
      for (const line of block.split('\n')) {
        if (TAG_ONLY.test(line)) flush();
        else {
          if (chunkStart < 0) chunkStart = position;
          chunkEnd = position + line.length;
        }
        position += line.length + 1;
      }
      flush();
    };

    const visit = (node: Node, context: Context) => {
      let start = node.position?.start.offset ?? 0;
      let end = node.position?.end.offset ?? 0;
      switch (node.type) {
        case 'yaml':
        case 'toml':
        case 'json':
          if (depth === 0 && offset === 0) frontMatter(start, end, node.type);
          return;
        case 'math':
          // A display math block is opaque, like a fence: its dots and equals signs are not sentences.
          return add('opaque', at(start), at(end), [...here(), ...(context.extra ?? [])]);
        case 'footnoteDefinition':
          // The definition is cut like prose; its label ends the heading path of its units, so a labeler reads which
          // reference it explains. The `[^label]:` marker is in no unit.
          for (const child of node.children ?? [])
            visit(child, { ...context, extra: [...(context.extra ?? []), `[^${node.label ?? ''}]`] });
          return;
        case 'containerDirective':
          // The `:::name` and `:::` lines are in no unit; the name ends the path of the units between them. A label
          // written in brackets after the name sits on the marker line, so it is in no unit either.
          for (const child of node.children ?? []) {
            if ((child as { data?: { directiveLabel?: boolean } }).data?.directiveLabel) continue;
            visit(child, { ...context, extra: [...(context.extra ?? []), node.name ?? ''] });
          }
          return;
        case 'heading': {
          const kids = node.children ?? [];
          const first = kids[0]?.position?.start.offset ?? start;
          const last = kids.at(-1)?.position?.end.offset ?? end;
          const title = text.slice(first, last).trim();
          while (trail.length > 0 && (trail.at(-1)?.depth ?? 0) >= (node.depth ?? 1)) trail.pop();
          add('heading', at(start), at(end), here());
          trail.push({ depth: node.depth ?? 1, title });
          return;
        }
        case 'paragraph': {
          [start, end] = withoutTagLines(text, start, end);
          const path = [...here(), ...(context.extra ?? [])];
          if (context.inList) return add('list_item', at(start), at(end), path);
          if (context.inQuote) {
            const alert = alertOf(node, text, start);
            if (alert) {
              // A GitHub alert: its `[!TYPE]` line is a mark, not prose; the type ends the path of the units.
              if (alert.from >= end) return;
              return add('block_quote', at(alert.from), at(end), [...path, alert.type]);
            }
            return add('block_quote', at(start), at(end), path);
          }
          const references = footnoteReferences(node);
          for (const [blockFrom, blockTo] of options.plain
            ? plainBlocks(text, start, end)
            : ([[start, end]] as Array<[number, number]>))
            for (const [from, to] of sentenceSpans(text, blockFrom, blockTo, references))
              add('sentence', at(from), at(to), path);
          return;
        }
        case 'code':
          // A fence is one opaque unit over all its lines: never shown to a labeler, so no label points at it.
          return add('opaque', at(start), at(end), [...here(), ...(context.extra ?? [])]);
        case 'html': {
          // An html block that holds an html block of its own and does not shrink is cut as opaque, so the parse ends.
          if (depth >= 2) return add('opaque', at(start), at(end), here());
          return htmlBlock(start, end);
        }
        case 'tableCell': {
          const kids = node.children ?? [];
          if (kids.length > 0) {
            const first = kids[0]?.position?.start.offset ?? start;
            const last = kids.at(-1)?.position?.end.offset ?? end;
            add('table_cell', at(first), at(last), here());
          }
          return;
        }
        case 'listItem': {
          for (const child of node.children ?? []) {
            visit(child, { ...context, inList: child.type === 'paragraph' });
          }
          return;
        }
        case 'blockquote': {
          for (const child of node.children ?? []) visit(child, { ...context, inQuote: true });
          return;
        }
        default:
          for (const child of node.children ?? []) visit(child, context);
      }
    };

    for (const child of tree.children ?? []) visit(child, {});
  };

  markdown(source, 0, [], 0);
  return { units, digest: sha(units.map((unit) => `${unit.container}:${unit.fp}`).join('\n')) };
}
