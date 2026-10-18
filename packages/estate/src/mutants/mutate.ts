import { constants, existsSync } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { mapHash } from '../map/build';
import { quoteDrift } from '../map/file';
import { readerFor } from '../scan/index';
import { provenanceHash, quoteAtSpan } from '../scan/text';
import type { Atom, EstateMap } from '../schema';

/**
 * Estate mutants, for adequacy: one atom deleted or inverted in a COPY of the estate, found by its
 * provenance (the file, the span, the quote). The tests derived from that atom must go red on the mutant;
 * a test that stays green does not test its atom.
 *
 * - delete: the quoted span is removed from its file. A line left holding only a list marker or a bold
 *   label goes with it, and so does a comma left dangling in a JSON file.
 * - invert: a fixed sentence keyed by the atom's polarity is set before the whole quote (below). A quote that is not
 *   a prose obligation (a JSON value, a name, a single word) is refused: delete it instead.
 *
 * The mutant's map is the original with the atom removed (delete) or its quote replaced (invert); the spans
 * of the atoms after it in the same file move with the lines, every provenance hash is recomputed, and the
 * map hash with them. Atoms whose quote the mutation took with it are listed as collateral.
 */

export type MutationOp = { delete: string } | { invert: string };

export type MutantResult = {
  atom: string;
  op: 'delete' | 'invert';
  file: string;
  /** The span as it read before and after the mutation. */
  before: string;
  after: string;
  originalMapHash: string;
  mapHash: string;
  map: EstateMap;
  /** Other atoms whose quote is no longer at its span in the mutant. */
  collateral: string[];
  /** Files the mutation removed: a deleted script atom takes its script file with its mention. */
  removed: string[];
};

export class MutantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutantError';
  }
}

/** The estate's own files a copy holds by default: what the runtime reads, nothing the test harness wrote. */
export const ESTATE_COPY_FILES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'] as const;

/**
 * Copies the estate's own files, and every file an atom of the map quotes, from `root` into `to`. The files
 * are the ones the map's runtime reader lists (ignored folders such as node_modules and test runs left out,
 * the map's own ignore list applied); a runtime with no listing copies `names` whole. Each file is a
 * copy-on-write clone where the file system supports one, else a plain copy; never a hard link, which
 * would let a write in the copy edit the real file. Symbolic links are followed: the copy holds real files
 * and never a link, so a mutant can never write through one into the estate it was copied from. A link left
 * in the copy refuses the copy. Modes are kept, so guard scripts stay runnable.
 */
export async function copyEstate(
  root: string,
  to: string,
  map: EstateMap,
  names: readonly string[] = ESTATE_COPY_FILES,
): Promise<string[]> {
  const reader = readerFor(map.runtime, { ignore: map.ignore ?? [] });
  const listed = reader?.listFiles ? await reader.listFiles(root) : undefined;
  const copied: string[] = [];
  if (listed) {
    const files = [...new Set([...listed, ...map.atoms.map((atom) => atom.provenance.file)])].sort();
    // Sixteen copies at a time: an estate of thousands of small files is bound by the file system's latency.
    await eachLimited(files, 16, async (file) => {
      const source = join(root, file);
      if (!(await stat(source).catch(() => undefined))?.isFile()) return;
      await mkdir(dirname(join(to, file)), { recursive: true });
      await copyFile(source, join(to, file), constants.COPYFILE_FICLONE);
      copied.push(file);
    });
    copied.sort();
  } else {
    const wanted = [...names, ...map.atoms.map((atom) => atom.provenance.file)];
    for (const name of [...new Set(wanted)]) {
      if (copied.some((done) => name === done || name.startsWith(`${done}/`))) continue;
      const source = join(root, name);
      if ((await stat(source).catch(() => undefined)) === undefined) continue;
      await cp(source, join(to, name), {
        recursive: true,
        dereference: true,
        mode: constants.COPYFILE_FICLONE,
      });
      copied.push(name);
    }
  }
  const left = await linksUnder(to);
  if (left.length > 0) throw new MutantError(`the estate copy holds symbolic links: ${left.join(', ')}`);
  return copied;
}

/** Mutates the estate copy at `root` in place and returns the mutant's map. */
export async function mutateEstate(
  copy: { root: string; map: EstateMap },
  op: MutationOp,
): Promise<MutantResult> {
  const kind = 'delete' in op ? 'delete' : 'invert';
  const id = 'delete' in op ? op.delete : op.invert;
  const atom = copy.map.atoms.find((candidate) => candidate.id === id);
  if (!atom) throw new MutantError(`atom ${id} is not in the map`);
  if (kind === 'delete' && isEquivalentDelete(atom)) {
    throw new MutantError(
      `${id} is an equivalent mutant: its name line repeats the skill's folder, and the runtime names a skill by its folder, so deleting the line changes nothing; no mutant is written`,
    );
  }
  const { file, startLine, endLine, quote } = atom.provenance;
  const path = await insideCopy(copy.root, file);
  const text = await readFile(path, 'utf8').catch(() => {
    throw new MutantError(`${file} is not in the estate copy`);
  });
  if (!quoteAtSpan(text, atom.provenance)) {
    throw new MutantError(`${id}: the quote is no longer at ${file} lines ${startLine} to ${endLine}`);
  }
  const lines = text.split('\n');
  const spanStart = offsetOfLine(lines, startLine);
  const spanEnd = offsetOfLine(lines, endLine + 1) - (endLine < lines.length ? 1 : 0);
  const found = findQuote(text.slice(spanStart, spanEnd), quote);
  if (!found) throw new MutantError(`${id}: the quote cannot be cut out of ${file} at its span`);
  const from = spanStart + found.start;
  const to = spanStart + found.end;

  let next: string;
  let replacement = '';
  if (kind === 'invert') {
    const inverted = invertText(text.slice(from, to), atom.fields?.polarity as string | undefined);
    if (inverted === undefined) {
      throw new MutantError(`${id}: the quote is not prose that can be inverted; delete it instead`);
    }
    replacement = inverted;
    next = text.slice(0, from) + replacement + text.slice(to);
  } else if (file.endsWith('.json')) {
    next = cutJson(text, from, to, startLine, file);
  } else {
    next = tidy(text.slice(0, from) + text.slice(to), startLine, file);
  }
  await writeFile(path, next);

  // A deleted script goes with its mention: the mutant must not keep a script the estate no longer names.
  const removedFiles: string[] = [];
  const scriptPath = atom.kind === 'script' && kind === 'delete' ? atom.fields?.path : undefined;
  if (typeof scriptPath === 'string' && scriptPath !== '') {
    const target = await insideCopy(copy.root, scriptPath);
    if (existsSync(target)) {
      await rm(target, { force: true });
      removedFiles.push(scriptPath);
    }
  }
  const gone = new Set(removedFiles);

  const before = lines.slice(startLine - 1, endLine).join('\n');
  const nextLines = next.split('\n');
  const removed = lines.length - nextLines.length;
  const after =
    kind === 'invert'
      ? nextLines.slice(startLine - 1, endLine).join('\n')
      : nextLines.slice(startLine - 1, Math.max(startLine - 1, endLine - removed)).join('\n');

  const atoms: Atom[] = [];
  const lost: string[] = [];
  for (const other of copy.map.atoms) {
    if (gone.has(other.provenance.file) && other.id !== id) {
      lost.push(other.id);
      continue;
    }
    if (other.id === id) {
      if (kind === 'invert') atoms.push(withProvenance(other, { quote: replacement }));
      continue;
    }
    if (other.provenance.file === file && other.provenance.startLine > endLine && removed > 0) {
      atoms.push(
        withProvenance(other, {
          startLine: other.provenance.startLine - removed,
          endLine: other.provenance.endLine - removed,
        }),
      );
    } else atoms.push(other);
  }
  const dropped = new Set([id, ...lost]);
  const edges =
    kind === 'delete'
      ? copy.map.edges.filter((edge) => !dropped.has(edge.from) && !dropped.has(edge.to))
      : copy.map.edges;
  const hash = mapHash(atoms, edges);
  const map: EstateMap = { ...copy.map, atoms, edges, hash };
  const texts = new Map<string, string>([[file, next]]);
  const collateral = quoteDrift(
    atoms.filter((other) => other.provenance.file === file && other.id !== id && !gone.has(file)),
    texts,
  )
    .map((issue) => issue.message.split(':')[0] ?? issue.message)
    .concat(lost);
  return {
    atom: id,
    op: kind,
    file,
    before,
    after,
    originalMapHash: copy.map.hash,
    mapHash: hash,
    map,
    collateral,
    removed: removedFiles,
  };
}

/**
 * A skill's `name:` line whose value is the skill's folder name. The runtime names a skill by its folder, so
 * deleting the line changes nothing the agent sees: the mutant is equivalent, and it is not made.
 */
function isEquivalentDelete(atom: Atom): boolean {
  if (atom.kind !== 'skill') return false;
  const folder = atom.fields?.folder;
  const value = /^name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(atom.provenance.quote)?.[1];
  return typeof folder === 'string' && value !== undefined && value === basename(folder);
}

function withProvenance(atom: Atom, change: Partial<Atom['provenance']>): Atom {
  const provenance = { ...atom.provenance, ...change };
  return { ...atom, provenance: { ...provenance, hash: provenanceHash(provenance) } };
}

/** The offset of the start of a 1-based line; past the last line, the text's length. */
function offsetOfLine(lines: readonly string[], line: number): number {
  let offset = 0;
  for (let index = 0; index < line - 1 && index < lines.length; index += 1)
    offset += (lines[index]?.length ?? 0) + 1;
  return offset;
}

/** Where the quote sits in the span: exactly, else with white space and quote marks folded. */
function findQuote(span: string, quote: string): { start: number; end: number } | undefined {
  const exact = span.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const words = quote.trim().split(/\s+/).map(escapeWord);
  if (words.length === 0) return undefined;
  const match = new RegExp(words.join('\\s+')).exec(span);
  return match ? { start: match.index, end: match.index + match[0].length } : undefined;
}

function escapeWord(word: string): string {
  return word
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['‘’‛′]/g, "['‘’‛′]")
    .replace(/["“”‟″]/g, '["“”‟″]');
}

/** A line left with only a list marker or a bold label goes; in JSON, a dangling comma goes too. */
function tidy(text: string, line: number, file: string): string {
  const lines = text.split('\n');
  const left = lines[line - 1] ?? '';
  // The line held the quote, so a line now blank or holding only a marker or a label was the quote's own.
  if (/^\s*(?:[-*+]|\d+[.)])?\s*(?:\*\*[^*]*\*\*)?\s*$/.test(left)) lines.splice(line - 1, 1);
  let out = lines.join('\n');
  if (file.endsWith('.json')) {
    out = out
      .replace(/,(\s*),/g, ',$1')
      .replace(/\[(\s*),/g, '[$1')
      .replace(/,(\s*)\]/g, '$1]')
      .replace(/,(\s*)\}/g, '$1}');
    try {
      JSON.parse(out);
    } catch (cause) {
      throw new MutantError(
        `${file} is no longer JSON once the quote is cut: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  return out;
}

/**
 * A delete in a JSON file. The quote is cut as text first (an array item, a value with its comma); when the
 * file is no longer JSON after that, the delete is structural: the innermost array item or object member
 * that holds the quote goes, with its comma, and lines it leaves blank go too. A quote that only the whole
 * document holds (a file's first line, `{`) empties the document to `{}` or `[]`.
 */
function cutJson(text: string, from: number, to: number, line: number, file: string): string {
  try {
    return tidy(text.slice(0, from) + text.slice(to), line, file);
  } catch (cause) {
    if (!(cause instanceof MutantError)) throw cause;
  }
  const root = parseJsonRanges(text);
  if (!root) throw new MutantError(`${file} is not JSON, so the quote cannot be cut out of it structurally`);
  const holder = holderToCut(root, from, to);
  if (!holder) {
    const empty = root.kind === 'array' ? '[]' : '{}';
    return `${text.slice(0, root.start)}${empty}${text.slice(root.end)}`;
  }
  const { start, end } = holder;
  // Take the comma after the element, else the one before it, so the container stays valid.
  const afterComma = /^\s*,/.exec(text.slice(end));
  let cutStart = start;
  let cutEnd = end;
  if (afterComma) cutEnd = end + afterComma[0].length;
  else {
    const before = /,\s*$/.exec(text.slice(0, start));
    if (before) cutStart = start - before[0].length;
  }
  let out = text.slice(0, cutStart) + text.slice(cutEnd);
  // A line the element held alone is now blank: it goes.
  const lineStart = out.lastIndexOf('\n', cutStart - 1) + 1;
  const lineEnd = out.indexOf('\n', cutStart);
  if (lineEnd >= 0 && out.slice(lineStart, lineEnd).trim() === '')
    out = out.slice(0, lineStart) + out.slice(lineEnd + 1);
  try {
    JSON.parse(out);
  } catch (cause) {
    throw new MutantError(
      `${file} is no longer JSON once the element holding the quote is cut: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return out;
}

/** A JSON value with its offsets; a container lists its elements (an object member spans key to value). */
type JsonRange = { kind: 'object' | 'array' | 'value'; start: number; end: number; elements: JsonRange[] };

/** The offsets of every value of a JSON text, or undefined when it is not JSON. */
export function parseJsonRanges(text: string): JsonRange | undefined {
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at] ?? '')) at++;
  };
  const string = (): void => {
    at++;
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    if (at >= text.length) throw new Error('unterminated string');
    at++;
  };
  const value = (): JsonRange => {
    space();
    const start = at;
    const char = text[at];
    if (char === '{' || char === '[') {
      const kind = char === '{' ? 'object' : 'array';
      const close = char === '{' ? '}' : ']';
      at++;
      const elements: JsonRange[] = [];
      space();
      if (text[at] === close) {
        at++;
        return { kind, start, end: at, elements };
      }
      for (;;) {
        space();
        const elementStart = at;
        if (kind === 'object') {
          if (text[at] !== '"') throw new Error('a key is not a string');
          string();
          space();
          if (text[at] !== ':') throw new Error('no colon after a key');
          at++;
        }
        const inner = value();
        elements.push(kind === 'object' ? { ...inner, start: elementStart } : inner);
        space();
        if (text[at] === ',') {
          at++;
          continue;
        }
        if (text[at] === close) {
          at++;
          return { kind, start, end: at, elements };
        }
        throw new Error('a container is not closed');
      }
    }
    if (char === '"') {
      string();
      return { kind: 'value', start, end: at, elements: [] };
    }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!literal) throw new Error(`unexpected ${char ?? 'end'}`);
    at += literal[0].length;
    return { kind: 'value', start, end: at, elements: [] };
  };
  try {
    const root = value();
    space();
    return at === text.length ? root : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The element to cut for a quote at `from` to `to`: the innermost array item or object member that holds
 * it, except that a member of an object which is itself an array item takes that whole item with it (a
 * guard entry loses its entry, not its `command` key, which would leave an entry the runtime refuses).
 */
function holderToCut(root: JsonRange, from: number, to: number): JsonRange | undefined {
  const chain: Array<{ element: JsonRange; parent: JsonRange }> = [];
  let node = root;
  for (;;) {
    const element = node.elements.find((candidate) => candidate.start <= from && to <= candidate.end);
    if (!element) break;
    chain.push({ element, parent: node });
    node = element;
  }
  const inner = chain.at(-1);
  if (!inner) return undefined;
  const outer = chain.at(-2);
  if (inner.parent.kind === 'object' && outer && outer.parent.kind === 'array') return outer.element;
  return inner.element;
}

/**
 * The two fixed sentences an atom inverts by, keyed by its declared polarity and nothing else: the words of the
 * quote are never read. The quote stays whole after the sentence; a markdown prefix (a list marker, a bold label)
 * stays in front of it. An atom with no declared polarity is an obligation.
 *
 * | Polarity | Inverted |
 * |---|---|
 * | obligation | Do not follow this rule: <quote> |
 * | prohibition | This prohibition is lifted: <quote> |
 *
 * Undefined when the text is not prose: it starts with no letter, holds a single word, or is a `key: value` line.
 */
export function invertText(text: string, polarity?: string): string | undefined {
  const prefix = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*[^*]*\*\*\s*)?)/.exec(text)?.[1] ?? '';
  const body = text.slice(prefix.length);
  // Prose starts with a letter, holds more than one word and is no `key: value` line of a settings file.
  if (!/^\p{L}/u.test(body) || !/\s/.test(body.trim()) || /^[\w-]+:\s/.test(body)) return undefined;
  return `${prefix}${polarity === 'prohibition' ? 'This prohibition is lifted: ' : 'Do not follow this rule: '}${body}`;
}

/** Runs `work` on every item, at most `limit` at a time. */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

/** The symbolic links under a folder, relative to it. */
async function linksUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if ((await lstat(full)).isSymbolicLink()) out.push(relative(dir, full));
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out.sort();
}

/**
 * The path of `file` in the copy, once its real path is known to stay inside the copy root: a link on the
 * way (the file, or a folder above it) that leads out of the copy refuses the write, naming where it leads.
 */
export async function insideCopy(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const path = join(root, file);
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    // A file not there yet: its folder must stay inside.
    real = join(await realpath(dirname(path)).catch(() => base), file.split('/').at(-1) ?? '');
  }
  if (real !== base && !real.startsWith(`${base}${sep}`)) {
    throw new MutantError(`${file} resolves to ${real}, outside the copy ${base}; refused`);
  }
  return path;
}
