import { cp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapHash } from '../map/build';
import { quoteDrift } from '../map/file';
import { provenanceHash, quoteAtSpan } from '../scan/text';
import type { Atom, EstateMap } from '../schema';

/**
 * Estate mutants, for adequacy: one atom deleted or inverted in a COPY of the estate, found by its
 * provenance (the file, the span, the quote). The tests derived from that atom must go red on the mutant;
 * a test that stays green does not test its atom.
 *
 * - delete: the quoted span is removed from its file. A line left holding only a list marker or a bold
 *   label goes with it, and so does a comma left dangling in a JSON file.
 * - invert: the quote is replaced by its negation, by a fixed table of forms (below). A quote that is not
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
 * Copies the estate's own files, and every file an atom of the map quotes, from `root` into `to`. Modes are
 * kept, so guard scripts stay runnable.
 */
export async function copyEstate(
  root: string,
  to: string,
  map: EstateMap,
  names: readonly string[] = ESTATE_COPY_FILES,
): Promise<string[]> {
  const copied: string[] = [];
  const wanted = [...names, ...map.atoms.map((atom) => atom.provenance.file)];
  for (const name of [...new Set(wanted)]) {
    if (copied.some((done) => name === done || name.startsWith(`${done}/`))) continue;
    const source = join(root, name);
    if ((await stat(source).catch(() => undefined)) === undefined) continue;
    await cp(source, join(to, name), { recursive: true, verbatimSymlinks: true });
    copied.push(name);
  }
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
  const { file, startLine, endLine, quote } = atom.provenance;
  const path = join(copy.root, file);
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
    const inverted = invertText(text.slice(from, to));
    if (inverted === undefined) {
      throw new MutantError(
        `${id}: the quote is not a prose obligation the table can invert; delete it instead`,
      );
    }
    replacement = inverted;
    next = text.slice(0, from) + replacement + text.slice(to);
  } else {
    next = tidy(text.slice(0, from) + text.slice(to), startLine, file);
  }
  await writeFile(path, next);

  const before = lines.slice(startLine - 1, endLine).join('\n');
  const nextLines = next.split('\n');
  const removed = lines.length - nextLines.length;
  const after =
    kind === 'invert'
      ? nextLines.slice(startLine - 1, endLine).join('\n')
      : nextLines.slice(startLine - 1, Math.max(startLine - 1, endLine - removed)).join('\n');

  const atoms: Atom[] = [];
  for (const other of copy.map.atoms) {
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
  const edges =
    kind === 'delete' ? copy.map.edges.filter((edge) => edge.from !== id && edge.to !== id) : copy.map.edges;
  const hash = mapHash(atoms, edges);
  const map: EstateMap = { ...copy.map, atoms, edges, hash };
  const texts = new Map<string, string>([[file, next]]);
  const collateral = quoteDrift(
    atoms.filter((other) => other.provenance.file === file && other.id !== id),
    texts,
  ).map((issue) => issue.message.split(':')[0] ?? issue.message);
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
  };
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
 * The fixed table of forms an obligation inverts by. The first form that applies wins; a markdown prefix
 * (a list marker, a bold label) is kept as it is.
 *
 * | Form | Inverted |
 * |---|---|
 * | Never X | Always X |
 * | Always X | Never X |
 * | Do not X, Don't X | X |
 * | ... must not ... | ... must ... |
 * | ... must ... | ... must not ... |
 * | When, If, Once, After, Before, Whenever C, X (or C: X) | the same C, then X inverted |
 * | X, an imperative sentence | Do not x |
 *
 * Undefined when the text is not prose: it starts with no letter, holds a single word, or is a `key: value` line.
 */
export function invertText(text: string): string | undefined {
  const prefix = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*[^*]*\*\*\s*)?)/.exec(text)?.[1] ?? '';
  const body = text.slice(prefix.length);
  // Prose starts with a letter, holds more than one word and is no `key: value` line of a settings file.
  if (!/^[A-Za-z]/.test(body) || !/\s/.test(body.trim()) || /^[\w-]+:\s/.test(body)) return undefined;
  const inverted = invertClause(body, true);
  return inverted === undefined ? undefined : prefix + inverted;
}

function invertClause(clause: string, sentence: boolean): string | undefined {
  const cap = (value: string) => (sentence ? value.charAt(0).toUpperCase() + value.slice(1) : value);
  let match = /^never\s+(.+)$/is.exec(clause);
  if (match) return `${cap('always')} ${match[1]}`;
  match = /^always\s+(.+)$/is.exec(clause);
  if (match) return `${cap('never')} ${match[1]}`;
  match = /^(?:do not|don't)\s+(.+)$/is.exec(clause);
  if (match) return cap(match[1] ?? '');
  if (/\bmust not\b/.test(clause)) return clause.replace(/\bmust not\b/, 'must');
  if (/\bmust\b/.test(clause)) return clause.replace(/\bmust\b/, 'must not');
  match = /^(when|if|once|after|before|whenever)\b([^,:]*)([,:])\s*(.+)$/is.exec(clause);
  if (match) {
    const rest = invertClause(match[4] ?? '', false);
    return rest === undefined ? undefined : `${match[1]}${match[2]}${match[3]} ${rest}`;
  }
  if (!/^[A-Za-z]/.test(clause)) return undefined;
  const lowered = clause.charAt(0).toLowerCase() + clause.slice(1);
  return `${cap('do not')} ${lowered}`;
}
