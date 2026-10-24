import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { bodyLines } from './code';
import type { EstateFile, ProseChunk } from './reader';
import { linesOf } from './text';

/**
 * A document read as CommonMark reads it, once, for the readers that must not mistake a construct for text.
 * The line readers of the scan see one line at a time, so a code span that runs over two lines, an indented code
 * block, a definition and an image description look like prose to them. The view answers by the parse:
 *
 * - `lines`: the lines a path reader looks at: every line of a code block is blank, fenced (whatever opens it: the
 *   start of a line, a list item, a quote) or indented; so is every HTML comment; and a code span over several lines
 *   is one span on its first line (its other lines are blank). The line numbers stay. A path in a code block is an
 *   example, not a path. The document is taken as it stands, frontmatter apart: the parse decides where a block
 *   begins and ends, so no line pattern can mistake a closing fence for an opening one.
 * - `texts`: the runs of text a person reads: text outside code, a definition, an image description and HTML. A link
 *   label is read; its destination is not text. An import (`@path`) is looked for here and nowhere else.
 */

export type TextRun = { value: string; line: number };

export type ImportMention = { written: string; line: number };

export type MarkdownView = {
  lines: string[];
  texts: TextRun[];
  /** The imports written with this prefix, with their lines, in document order. */
  imports(prefix: string): ImportMention[];
};

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { line: number; column: number }; end: { line: number; column: number } };
};

const MARKDOWN = unified().use(remarkParse);

/** The constructs whose content is not text a person reads: their words are code, a destination or a picture. */
const NOT_TEXT = new Set(['inlineCode', 'code', 'definition', 'image', 'imageReference', 'html', 'yaml']);

/** The longest run of backticks in a text. */
function longestRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Blanks the HTML comments of an HTML node, with spaces, line numbers kept. A comment runs from `<!--` to the next
 * `-->`, or to the end of the node when it never closes. The node's value has lost the prefixes of its containers (a
 * quote's marker, a list item's indent), so each comment is found again in the line it stands on.
 */
function blankComments(lines: string[], value: string, start: { line: number; column: number }): void {
  let open = false;
  const count = value.split('\n').length;
  for (let index = 0; index < count; index += 1) {
    const at = start.line - 1 + index;
    let line = lines[at];
    if (line === undefined) break;
    let cursor = index === 0 ? start.column - 1 : 0;
    for (;;) {
      let from = cursor;
      if (!open) {
        const opener = line.indexOf('<!--', cursor);
        if (opener < 0) break;
        open = true;
        from = opener;
        cursor = opener + 4;
      }
      const closer: number = line.indexOf('-->', cursor);
      const stop: number = closer < 0 ? line.length : closer + 3;
      line = line.slice(0, from) + ' '.repeat(stop - from) + line.slice(stop);
      // An unclosed comment goes on in the next line of the node.
      if (closer < 0) break;
      open = false;
      cursor = stop;
    }
    lines[at] = line;
  }
}

export function markdownView(text: string): MarkdownView {
  const lines = text.split('\n');
  const texts: TextRun[] = [];
  const visit = (node: Node): void => {
    const start = node.position?.start;
    const end = node.position?.end;
    if (node.type === 'code' && start && end) {
      for (let at = start.line; at <= end.line; at += 1) lines[at - 1] = '';
      return;
    }
    if (node.type === 'html' && start && end && node.value) {
      blankComments(lines, node.value, start);
      return;
    }
    if (node.type === 'inlineCode' && start && end) {
      if (start.line === end.line) return;
      const first = lines[start.line - 1] ?? '';
      const last = lines[end.line - 1] ?? '';
      const content = (node.value ?? '').replace(/\s+/g, ' ');
      const ticks = '`'.repeat(longestRun(content) + 1);
      const pad = ticks.length > 1 ? ' ' : '';
      lines[start.line - 1] = `${first.slice(0, start.column - 1)}${ticks}${pad}${content}${pad}${ticks}`;
      for (let at = start.line + 1; at < end.line; at += 1) lines[at - 1] = '';
      lines[end.line - 1] = ' '.repeat(end.column - 1) + last.slice(end.column - 1);
      return;
    }
    if (node.type === 'text' && start && node.value !== undefined) {
      texts.push({ value: node.value, line: start.line });
      return;
    }
    if (NOT_TEXT.has(node.type)) return;
    for (const child of node.children ?? []) visit(child);
  };
  visit(MARKDOWN.parse(text) as unknown as Node);
  const memo = new Map<string, ImportMention[]>();
  return {
    lines,
    texts,
    imports(prefix) {
      let found = memo.get(prefix);
      if (!found) {
        found = texts.flatMap((run) =>
          scanImports(run.value, prefix).map((entry) => ({
            written: entry.written,
            line: run.line + (run.value.slice(0, entry.at).match(/\n/g)?.length ?? 0),
          })),
        );
        memo.set(prefix, found);
      }
      return found;
    },
  };
}

/** A path ends here: sentence punctuation after it is not part of its name. */
const TRAILING = /[.,;:!?]+$/;

/**
 * The imports a run of text writes with a prefix: the prefix at the start of the run or after a space, then a path
 * that ends at the first space unless each space in it has a backslash. A quoted path is not an import. Where a run
 * of text ends, a path ends: a link label, an emphasis and a code span are other runs.
 */
export function scanImports(value: string, prefix: string): Array<{ written: string; at: number }> {
  const found: Array<{ written: string; at: number }> = [];
  let from = 0;
  for (;;) {
    const at = value.indexOf(prefix, from);
    if (at < 0) break;
    from = at + prefix.length;
    if (at > 0 && !/\s/.test(value[at - 1] ?? '')) continue;
    let end = from;
    while (end < value.length) {
      if (value[end] === '\\' && value[end + 1] === ' ') {
        end += 2;
        continue;
      }
      if (/\s/.test(value[end] ?? '')) break;
      end += 1;
    }
    const raw = value.slice(from, end);
    if (raw === '' || /^["'`]/.test(raw)) continue;
    const written = raw.replace(/\\ /g, ' ').replace(TRAILING, '');
    if (written === '') continue;
    found.push({ written, at });
    from = end;
  }
  return found;
}

const FILE_VIEWS = new WeakMap<EstateFile, MarkdownView>();
const CHUNK_VIEWS = new WeakMap<ProseChunk, MarkdownView>();

/** The view of a file as the scan reads it: its frontmatter blanked, the rest as it stands. */
export function fileView(source: EstateFile): MarkdownView {
  let view = FILE_VIEWS.get(source);
  if (!view) {
    view = markdownView(bodyLines(source).join('\n'));
    FILE_VIEWS.set(source, view);
  }
  return view;
}

function chunkView(chunk: ProseChunk): MarkdownView {
  let view = CHUNK_VIEWS.get(chunk);
  if (!view) {
    view = markdownView(chunk.text);
    CHUNK_VIEWS.set(chunk, view);
  }
  return view;
}

/**
 * The non-blank lines of a chunk as a path reader looks at them: those of `chunkLines`, with the code of the
 * document taken out as CommonMark takes it out. The quote is the line as written in the file.
 */
export function referenceLines(
  chunk: ProseChunk,
  source?: EstateFile,
): Array<{ line: number; text: string; quote: string }> {
  const lines = source
    ? fileView(source).lines.slice(chunk.startLine - 1, chunk.endLine)
    : chunkView(chunk).lines;
  const original = source
    ? source.text.split('\n').slice(chunk.startLine - 1, chunk.endLine)
    : chunk.text.split('\n');
  return linesOf(lines.join('\n'))
    .filter((line) => line.text !== '')
    .map((line) => ({
      line: chunk.startLine + line.line - 1,
      text: line.text,
      quote: original[line.line - 1]?.trim() ?? line.text,
    }));
}
