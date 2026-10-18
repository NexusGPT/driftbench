import type { Atom } from '@agent-nexus/driftbench-estate';

/**
 * Whether a piece of a code-written ask is taken from the text it says it came from. The check reads the shape
 * of the text (word and punctuation tokens, the boundaries between clauses, recorded offsets), never the
 * meaning of a word. Two things are accepted:
 *
 * - a whole clause of a field: the piece's tokens are those of a run of the field's tokens, case folded, with
 *   one allowance (the first word may be another form of the source word: they share their first three
 *   letters, "audits" gives "audit"). The run starts where a clause starts and ends where one ends: at the
 *   edge of the field, a sentence end or a semicolon. A word dropped before the run, a cut in the middle of a
 *   clause, a run in another order and words added are none of these;
 * - a slice of a labelled clause: the spec records the offsets the piece was taken at in the quote of an atom
 *   (`from.offsets`), the tokens of that slice are the piece, and the slice lies inside a span the pointer
 *   reader labelled `act`, `governed-action`, `prerequisite` or `ask` on that atom (`fields.labelSpans`).
 *   Which words the generator dropped does not matter: the label says the clause acts, the offsets say what
 *   was taken.
 *
 * A piece the generator cut with a list of English words (the clause a description asks for, the work after a
 * read-before, a clause after "never") has no offsets until the generator takes pieces from spans, and is
 * refused.
 */

const TOKEN = /(?:\.{1,2}\/|\.(?=[\p{L}\p{N}]))?[\p{L}\p{N}]+(?:['’_/.-][\p{L}\p{N}]+)*\/?|[^\s\p{L}\p{N}]/gu;
const isWord = (token: string): boolean => /[\p{L}\p{N}]/u.test(token);
const isBoundary = (token: string | undefined): boolean => token === undefined || /^[.!?;]$/.test(token);
/** The tokens of a text, lower case, with markdown links and emphasis removed. */
export function tokensOf(text: string): string[] {
  return (
    text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, ' ')
      .toLowerCase()
      .match(TOKEN) ?? []
  );
}

const sameWord = (piece: string, source: string, first: boolean): boolean =>
  piece === source || (first && isWord(piece) && isWord(source) && sharedPrefix(piece, source) >= 3);

function sharedPrefix(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

const RULE_KINDS: ReadonlySet<string> = new Set(['instruction', 'gate', 'register', 'invariant']);

/** A field of an atom as tokens. `rule` marks the title and the passage of a rule and the documented rule of a guard, which a piece never copies from the start. */
export type Field = { tokens: readonly string[]; rule: boolean };

/** The fields of an atom a piece may be taken from, and the acts the generator derives from them. */
export function fieldsOf(atom: Atom): Field[] {
  const own = RULE_KINDS.has(atom.kind) ? [atom.title, atom.provenance.quote] : [];
  const texts = [atom.title, atom.situation ?? '', atom.provenance.quote];
  for (const [name, value] of Object.entries(atom.fields ?? {})) {
    if (typeof value !== 'string') continue;
    texts.push(value);
    // The documented rule of a guard is the rule it enforces.
    if (name === 'ruleText') own.push(value);
  }
  // A stage's title is a labelled value, not a clause cut from its JSON provenance.
  const derived =
    atom.kind === 'stage' && atom.title.includes(': ')
      ? [atom.title.slice(atom.title.indexOf(': ') + 2)]
      : [];
  return [...texts, ...derived]
    .map((text) => ({ tokens: tokensOf(text), rule: own.includes(text) }))
    .filter((field) => field.tokens.length > 0);
}

/**
 * Whether the piece is a whole clause of one of the fields. A clause of the title or the passage of a rule is the
 * rule itself, not an ask to do the work it governs, and is not accepted: such a piece needs offsets (`isSliceOfSpan`).
 */
export function isClauseOf(piece: string, fields: readonly Field[]): boolean {
  const wanted = tokensOf(piece);
  if (wanted.length === 0 || !isWord(wanted[0] as string) || !isWord(wanted[wanted.length - 1] as string))
    return false;
  for (const { tokens: field, rule } of fields) {
    for (let at = 0; at + wanted.length <= field.length; at += 1) {
      if (!wanted.every((token, index) => sameWord(token, field[at + index] as string, index === 0)))
        continue;
      const next = field[at + wanted.length];
      if (!isBoundary(next)) continue;
      // The run starts a clause: the token before it ends one. A comma in a list or before a dependent clause
      // starts no new clause either, and a word dropped before the run is a cut.
      if (!isBoundary(field[at - 1])) continue;
      // A rule copied whole from its start is the rule itself, not the work it governs: only a labelled slice
      // of a rule is accepted.
      if (!rule) return true;
    }
  }
  return false;
}

/** The share of the words of `rule` that `ask` holds, in the same order (the longest common subsequence). */
export function orderedShare(rule: string, ask: string): number {
  const a = tokensOf(rule).filter(isWord);
  const b = tokensOf(ask).filter(isWord);
  if (a.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1)
      row[j] =
        left === b[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, row[j - 1] as number);
    previous = row;
  }
  return (previous[b.length] as number) / a.length;
}

/** A span the pointer reader labelled on an atom, as offsets into the atom's quote. */
export type LabelledSpan = { kind: string; from: number; to: number };

/** The kinds of span that say what a rule asks of the reader: a piece taken inside one is an act, not a mention. */
const ACTING_SPAN_KINDS: ReadonlySet<string> = new Set(['act', 'governed-action', 'prerequisite', 'ask']);

/** The labelled spans of an atom (`fields.labelSpans`) that are well formed and of an acting kind. */
export function actingSpansOf(atom: Atom): LabelledSpan[] {
  const raw = atom.fields?.labelSpans;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LabelledSpan[] => {
    const entry = item as Partial<LabelledSpan> | null;
    return entry !== null &&
      typeof entry === 'object' &&
      typeof entry.kind === 'string' &&
      ACTING_SPAN_KINDS.has(entry.kind) &&
      Number.isInteger(entry.from) &&
      Number.isInteger(entry.to) &&
      (entry.from as number) >= 0 &&
      (entry.to as number) > (entry.from as number)
      ? [entry as LabelledSpan]
      : [];
  });
}

/**
 * Whether the piece is the slice `[from, to)` of the quote of the atom, and that slice lies inside a span the
 * pointer reader labelled as acting on that atom. The tokens of the slice must be the tokens of the piece, so
 * the offsets cannot name one clause and the ask carry another.
 */
export function isSliceOfSpan(piece: string, offsets: { from: number; to: number }, atom: Atom): boolean {
  const quote = atom.provenance.quote;
  if (!Number.isInteger(offsets.from) || !Number.isInteger(offsets.to)) return false;
  if (offsets.from < 0 || offsets.to <= offsets.from || offsets.to > quote.length) return false;
  const wanted = tokensOf(piece);
  const taken = tokensOf(quote.slice(offsets.from, offsets.to));
  if (wanted.length === 0 || wanted.length !== taken.length) return false;
  if (!wanted.every((token, index) => token === taken[index])) return false;
  return actingSpansOf(atom).some((span) => span.from <= offsets.from && offsets.to <= span.to);
}
