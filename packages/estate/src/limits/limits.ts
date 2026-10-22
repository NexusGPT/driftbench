import { cut } from '../pointer';
import type { Atom, EstateMap } from '../schema';

/**
 * The numeric limits of an estate's instructions, asked one instruction at a time. For each instruction or gate atom
 * the producer makes one structured request: the quote of the atom, with its place in the file as context only (the
 * headings above it, the tables of its section, the units that scope it and the unit before and after it). The model
 * answers whether the instruction states, or points at a table that gives, a number it constrains; the answer lands
 * on that atom, so nothing is located and nothing is bound. Code reads no word of any quote or answer: the place is
 * built from the Markdown structure, the answer is JSON checked field by field.
 *
 * The model is a port: a function from a request to the text of the answer. The estate commands record and replay it
 * the way they do the other model steps; a test passes a fake.
 */

export const LIMIT_COMPARISONS = ['lt', 'le', 'gt', 'ge'] as const;
export const LIMIT_ROLES = ['constraint', 'trigger'] as const;

/**
 * A limit an answer states. `comparison` is how the quantity compares with the limit for the condition to hold.
 * `role` is `constraint` when the comparison is the compliant range of the act, `trigger` when it is the range where
 * the rule applies. The variable feed reads `{ limit, comparison, unit? }` only (`limitCondition`).
 */
export type AskedLimit = {
  limit: number;
  comparison: (typeof LIMIT_COMPARISONS)[number];
  role: (typeof LIMIT_ROLES)[number];
  unit?: string;
};

export type LimitRequest = { system: string; user: string };
export type LimitAsk = (request: LimitRequest) => Promise<string>;

export const LIMIT_SYSTEM = [
  'You read one instruction from the prompt of an AI agent. You are also given its place in the file: the headings above it,',
  'the tables of its section, the units that scope it and the unit before and after it. The place is context only, to read what the instruction refers to;',
  'answer about the INSTRUCTION alone, never about another line of the section.',
  'A limit is a number that a rule constrains: a maximum, a minimum, a deadline or a count of an act. A number that only',
  'names something is not a limit: a phone number, a size specification, a count of parts in a description.',
  'Say whether the instruction states, or points at a table that gives, such a limit. Answer with one JSON object and nothing else:',
  '{"limits": [{"limit": <the number as a JSON number>, "comparison": "lt" | "le" | "gt" | "ge", "role": "constraint" | "trigger",',
  '"unit": <what the number counts, a short text, or leave it out>}]}. An empty list when there is none.',
  'comparison is how the quantity compares with the limit for the condition to hold: lt less than, le at most, gt more than, ge at least.',
  'role is constraint when the comparison is the compliant range of the act (what the rule allows), and trigger when the comparison is the',
  'range where the rule applies (when it starts to act).',
  'A number may be written in words, inside a compound word ("a two-week notice") or implied by a singular count: "in a paragraph",',
  '"on one line" and "within the same hour" each limit a count to one, comparison le. A duration or count that must have passed or be',
  'reached is inclusive: use ge or le, and gt or lt only for "more than" or "fewer than".',
  'Prefer role constraint, the range the rule allows; use trigger only for an "if" or "when" condition that selects the cases the rule applies to.',
  'When the instruction points at a table that gives numbers, give one limit for each number of the table that the instruction applies to.',
  'Examples, invented: "Answer a harbour call within two hours" gives limit 2, comparison le, role constraint, unit hours.',
  '"Keep at least three spare keys in the cabinet" gives limit 3, comparison ge, role constraint, unit keys.',
  '"If a parcel is late by more than four days, tell the sender" gives limit 4, comparison gt, role trigger, unit days.',
  '"When fewer than five seats remain, close the booking" gives limit 5, comparison lt, role trigger, unit seats.',
].join(' ');

/**
 * Where an instruction sits, by the structure of its Markdown file (lines `line` to `endLine`, 1-based): the heading
 * path above it, the tables of its section (runs of lines that start with a bar), the units that scope it (`scopes`:
 * the situation the estate map holds for it) and the unit before and after it when they sit in the same section, in
 * the order of the pointer reader's cut.
 */
export function limitPlace(text: string, line: number, endLine: number = line, scopes?: string): string {
  const lines = text.split('\n');
  const stack: string[] = [];
  let sectionStart = 0;
  for (let at = 0; at < Math.min(line, lines.length); at++) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[at] ?? '');
    if (heading?.[1] !== undefined) {
      stack.length = heading[1].length - 1;
      stack[heading[1].length - 1] = (heading[2] ?? '').trim();
      sectionStart = at;
    }
  }
  let sectionEnd = lines.length;
  for (let at = Math.max(line, sectionStart + 1); at < lines.length; at++) {
    if (/^#{1,6}\s+/.test(lines[at] ?? '')) {
      sectionEnd = at;
      break;
    }
  }
  const tables: string[] = [];
  let run: string[] = [];
  for (const row of lines.slice(sectionStart, sectionEnd)) {
    if (row.trimStart().startsWith('|')) run.push(row.trim());
    else if (run.length > 0) {
      tables.push(run.join('\n'));
      run = [];
    }
  }
  if (run.length > 0) tables.push(run.join('\n'));
  const path = stack.filter((heading) => heading !== undefined && heading !== '').join(' > ');

  const offsets: number[] = [];
  let total = 0;
  for (const row of lines) {
    offsets.push(total);
    total += row.length + 1;
  }
  const from = offsets[Math.min(line, lines.length) - 1] ?? 0;
  const to = offsets[Math.min(endLine, lines.length)] ?? text.length;
  const units = cut(text).units;
  const first = units.findIndex((unit) => unit.end > from);
  let last = first;
  while (units[last + 1] !== undefined && (units[last + 1]?.start ?? Number.POSITIVE_INFINITY) < to) last++;
  const sameSection = (index: number) =>
    units[index] !== undefined && first >= 0 && units[index]?.path.join('>') === units[first]?.path.join('>');
  const around = [
    sameSection(first - 1) ? `PREVIOUS UNIT: ${units[first - 1]?.text.trim()}` : '',
    sameSection(last + 1) ? `NEXT UNIT: ${units[last + 1]?.text.trim()}` : '',
  ].filter((row) => row !== '');
  const scoped =
    scopes === undefined || scopes.trim() === ''
      ? ''
      : `\nUNITS THAT SCOPE IT, linked by the map:\n${scopes.trim()}`;
  const neighbours = around.length === 0 ? '' : `\n${around.join('\n')}`;
  return `HEADINGS: ${path === '' ? '(none)' : path}\nTABLES OF THE SECTION:\n${tables.length === 0 ? '(none)' : tables.join('\n\n')}${scoped}${neighbours}`;
}

/** The request for one instruction: its quote and its place. */
export const limitRequest = (quote: string, place: string): LimitRequest => ({
  system: LIMIT_SYSTEM,
  user: `PLACE:\n${place}\n\nINSTRUCTION:\n${quote}`,
});

/** The limits an answer states, or why it cannot be read. One malformed limit makes the whole answer unreadable. */
export function limitsOfAnswer(text: string): { limits: AskedLimit[]; problem?: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return { limits: [], problem: 'no JSON object' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { limits: [], problem: 'the JSON does not parse' };
  }
  const list = (parsed as { limits?: unknown }).limits;
  if (!Array.isArray(list)) return { limits: [], problem: 'no limits list' };
  const limits: AskedLimit[] = [];
  for (const item of list) {
    const { limit, comparison, role, unit } = (item ?? {}) as Record<string, unknown>;
    if (typeof limit !== 'number' || !Number.isFinite(limit))
      return { limits: [], problem: 'a limit is no number' };
    if (!(LIMIT_COMPARISONS as readonly unknown[]).includes(comparison))
      return { limits: [], problem: 'a comparison is unknown' };
    if (!(LIMIT_ROLES as readonly unknown[]).includes(role))
      return { limits: [], problem: 'a role is unknown' };
    const given: AskedLimit = {
      limit,
      comparison: comparison as AskedLimit['comparison'],
      role: role as AskedLimit['role'],
      ...(typeof unit === 'string' && unit.trim() !== '' ? { unit: unit.trim() } : {}),
    };
    // The same limit written twice is one limit.
    if (!limits.some((other) => JSON.stringify(other) === JSON.stringify(given))) limits.push(given);
  }
  return { limits };
}

/** The shape the variable feed reads from `fields.condition`: the role is not part of it. */
export const limitCondition = ({ limit, comparison, unit }: AskedLimit) => ({
  limit,
  comparison,
  ...(unit === undefined ? {} : { unit }),
});

export type ProducedLimits = {
  /** The limits found, by atom id. An atom whose answer states none is absent. */
  limits: Map<string, AskedLimit[]>;
  /** The atoms whose answer could not be read, with the reason. They get no limit. */
  unreadable: Array<{ atom: string; reason: string }>;
  /** How many requests were made. */
  requests: number;
};

export type ProduceOptions = {
  /** The estate files by path, as the map names them in `provenance.file`. */
  texts: ReadonlyMap<string, string>;
  ask: LimitAsk;
  /** The atoms to ask about. Default: every atom of kind instruction or gate. */
  include?: (atom: Atom) => boolean;
  /** Requests in flight at once. Default 4. */
  concurrency?: number;
};

const ASKED_KINDS: ReadonlySet<string> = new Set(['instruction', 'gate']);

/** Asks the model about each instruction atom of the map and returns the limits that land on each. */
export async function produceLimits(map: EstateMap, options: ProduceOptions): Promise<ProducedLimits> {
  const include = options.include ?? ((atom: Atom) => ASKED_KINDS.has(atom.kind));
  const atoms = map.atoms.filter(include);
  const out: ProducedLimits = { limits: new Map(), unreadable: [], requests: 0 };
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const atom = atoms[next++];
      if (atom === undefined) return;
      const place = limitPlace(
        options.texts.get(atom.provenance.file) ?? '',
        atom.provenance.startLine,
        atom.provenance.endLine,
        atom.situation,
      );
      const answer = await options.ask(limitRequest(atom.provenance.quote, place));
      out.requests++;
      const read = limitsOfAnswer(answer);
      if (read.problem !== undefined) out.unreadable.push({ atom: atom.id, reason: read.problem });
      else if (read.limits.length > 0) out.limits.set(atom.id, read.limits);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return out;
}

/**
 * The map with each produced limit written to `fields.condition` of its atom, beside the ids of condition units the
 * pointer reader keeps there. The variable feed reads the limits and passes over the ids.
 */
export function withLimits(map: EstateMap, produced: ReadonlyMap<string, readonly AskedLimit[]>): EstateMap {
  return {
    ...map,
    atoms: map.atoms.map((atom) => {
      const found = produced.get(atom.id);
      if (found === undefined) return atom;
      const kept = Array.isArray(atom.fields?.condition)
        ? atom.fields.condition
        : atom.fields?.condition === undefined
          ? []
          : [atom.fields.condition];
      return { ...atom, fields: { ...atom.fields, condition: [...kept, ...found.map(limitCondition)] } };
    }),
  };
}
