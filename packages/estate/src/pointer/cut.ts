import { createHash } from 'node:crypto';
import { parse, preprocess } from 'micromark';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
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
function mask(text: string): string {
  const letters = (match: string) => 'x'.repeat(match.length);
  const spaces = (match: string) => ' '.repeat(match.length);
  return text
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
export function sentenceSpans(source: string, from: number, to: number): Array<[number, number]> {
  const masked = mask(source.slice(from, to));
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
};

const PROCESSOR = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);

type Context = { inList?: boolean; inQuote?: boolean };

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

/** Whether a line, read as the start of a file, is a paragraph on its own: the parser decides, not a rule here. */
const startsParagraph = (line: string): boolean => {
  const children = (PROCESSOR.parse(line) as unknown as Node).children ?? [];
  return children.length === 1 && children[0]?.type === 'paragraph';
};

/** Whether a line, read as the start of a file, is a block quote of one paragraph: the parser decides. */
const startsQuote = (line: string): boolean => {
  const children = (PROCESSOR.parse(line) as unknown as Node).children ?? [];
  return children.length === 1 && children[0]?.type === 'blockquote';
};

/**
 * The offsets at which a text is read in parts. The markdown parser's cost grows much faster than the lines of one
 * paragraph (150,000 lines take a minute, in parts of 5,000 about a second), so a paragraph over `SLAB_LINES` lines
 * is read in parts. The block structure comes from the parser's own block pass, which does not read the text of
 * a paragraph and is linear: only a paragraph it finds is cut, at the start of a line that the parser also reads as
 * a paragraph alone, so no fence, heading, table or front matter is cut. A sentence over a cut is two units.
 */
function cutsOf(text: string): Array<{ at: number; join: boolean }> {
  if (linesIn(text) <= SLAB_LINES) return [];
  PROCESSOR.freeze();
  const extensions = (PROCESSOR.data('micromarkExtensions') as never[] | undefined) ?? [];
  const chunks = preprocess()(text, undefined, true);
  const cuts: Array<{ at: number; join: boolean }> = [];
  const along = (from: number, to: number, ok: (line: string) => boolean, join: boolean) => {
    let lines = 0;
    let at = text.lastIndexOf('\n', from) + 1;
    while (at < to) {
      const end = text.indexOf('\n', at);
      const next = end === -1 ? text.length : end + 1;
      if (lines >= SLAB_LINES && next <= to && ok(text.slice(at, end === -1 ? undefined : end))) {
        cuts.push({ at, join });
        lines = 0;
      }
      lines++;
      at = next;
    }
  };
  for (const [kind, token] of parse({ extensions }).flow().write(chunks)) {
    if (kind === 'enter' && token.type === 'paragraph' && token.end.line - token.start.line + 1 > SLAB_LINES)
      along(token.start.offset, token.end.offset, startsParagraph, false);
  }
  // A block quote holds its paragraph one container deep, where the flow pass does not look: its lines are
  // cut at a line that the parser reads as a quote alone, and the parts are joined back into one unit.
  let until = -1;
  for (const [kind, token] of parse({ extensions }).document().write(chunks)) {
    if (kind !== 'enter' || token.type !== 'blockQuote' || token.start.offset < until) continue;
    until = token.end.offset;
    if (token.start.column === 1 && token.end.line - token.start.line + 1 > SLAB_LINES)
      along(token.start.offset, token.end.offset, startsQuote, true);
  }
  return cuts.sort((x, y) => x.at - y.at);
}

export type CutOptions = {
  /** The file is plain text (`isPlainTextPath`): a title line ends at its line break. */
  plain?: boolean;
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

  const frontMatter = (start: number, end: number) => {
    const block = source.slice(start, end);
    const opening = /^---\r?\n/.exec(block)?.[0] ?? '';
    const body = block.slice(opening.length).replace(/\r?\n---\s*$/, '');
    try {
      const document = parseDocument(body);
      const walk = (node: unknown, key: string) => {
        if (isScalar(node) && typeof node.value === 'string' && node.range) {
          const [indicator, to] = node.range;
          // A block scalar's range opens at its `>` or `|` header; the value starts on the next line.
          const block = node.type === 'BLOCK_FOLDED' || node.type === 'BLOCK_LITERAL';
          const newline = block ? body.indexOf('\n', indicator) : -1;
          const from = block && newline !== -1 && newline < to ? newline + 1 : indicator;
          add('front_matter_value', start + opening.length + from, start + opening.length + to, [], key);
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

  const markdown = (
    text: string,
    offset: number,
    inherited: string[],
    depth: number,
    trail: Array<{ depth: number; title: string }> = [],
    sliced = false,
  ) => {
    const cuts = sliced ? [] : cutsOf(text);
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
          if (depth === 0 && offset === 0) frontMatter(start, end);
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
          if (context.inList) return add('list_item', at(start), at(end), here());
          if (context.inQuote) return add('block_quote', at(start), at(end), here());
          for (const [blockFrom, blockTo] of options.plain
            ? plainBlocks(text, start, end)
            : ([[start, end]] as Array<[number, number]>))
            for (const [from, to] of sentenceSpans(text, blockFrom, blockTo))
              add('sentence', at(from), at(to), here());
          return;
        }
        case 'code':
          // A fence is one opaque unit over all its lines: never shown to a labeler, so no label points at it.
          return add('opaque', at(start), at(end), here());
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
