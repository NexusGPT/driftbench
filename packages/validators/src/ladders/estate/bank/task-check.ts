import type { Observed } from '@agent-nexus/driftbench-core';
import type { Atom } from '@agent-nexus/driftbench-estate';
import {
  ASK_FORMS,
  HAZARD_FRAME,
  OUTSIDE_ASK,
  RESUME_ASK,
  TOOL_ACTS,
  VERBATIM_FORMS,
} from '@agent-nexus/driftbench-generate';
import type { SuiteSpec } from './fixture-suite';
import { type Act, actOfAtom, sameTarget, targetsOf } from './task-act';

/**
 * gen.task, read from ids and structure. An ask is judged by what the spec says about it
 * (`metadata.estate.link`, `act`, `from`) against the map, the approved bank and, for an ask that names its act
 * in an explicit form, the trace of the fake agent. No word of any estate is read:
 *
 * - C1 the link names the unit the plan row tests, with the fingerprint the map holds;
 * - C2 the act is the one this validator derives from that unit (`task-act.ts`);
 * - C3 the ask has a source: an approved phrase of a bank situation that lists the unit, a recorded session
 *   of such a situation, a fixed neutral ask, or a named form of the generator over an atom of the map; and it
 *   does not hold the text of a rule of the estate;
 * - C4 when the ask names its act with a code span, every span names a target of the act, and the trace of the
 *   fake shows the act (a control shows none).
 *
 * Limits, stated:
 * - An ask written from prose by the generator is held to its source and to the tie of its pieces to that
 *   source, not to its derivation. The tie proves provenance, not that the text is a task: a fragment that
 *   the estate holds itself ("Open orders") passes the tie when a generator records it as a piece of an atom
 *   that holds it. Measured on the planted corpus: the best host accepts 4 of 161.
 * - A spec that cites a true source and prints other text is a forged spec; only the trace of an explicit ask
 *   reaches it.
 * - A unit whose act no trace shows (a reply rule) rests on C1 to C3.
 * - A guard act gets no trace requirement: an obedient fake refuses an explicit prohibited command, so a
 *   correct ask leaves no call. Its code spans must still name a span of the rules the guard enforces.
 */

export type BankLike = {
  situations: ReadonlyArray<{
    id: string;
    atoms: readonly string[];
    phrases: ReadonlyArray<{ text: string; approved?: boolean }>;
  }>;
};
export type SessionsLike = {
  sessions: ReadonlyArray<{ name: string; situation: string; ask: string }>;
};
export type AskEnv = {
  atoms: readonly Atom[];
  byId: ReadonlyMap<string, Atom>;
  bank: BankLike;
  sessions: SessionsLike;
  /**
   * The tie of a code-written ask to the text it cites: the share of the character runs (of `gram` characters)
   * of each piece of the ask that the cited atom and the atoms of the row also hold must reach `floor`. Off when
   * absent.
   */
  tie?: { floor: number; gram: number };
};

export function envOf(
  atoms: readonly Atom[],
  bank: BankLike,
  sessions: SessionsLike,
  tie?: { floor: number; gram: number },
): AskEnv {
  return {
    atoms,
    byId: new Map(atoms.map((atom) => [atom.id, atom])),
    bank,
    sessions,
    ...(tie ? { tie } : {}),
  };
}

/** The atoms a bank situation may list for a row: the row's own, what they enforce or are enforced by, and for a tool rule the atoms of its file. */
function relatedIds(env: AskEnv, ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  for (const id of ids) {
    const atom = env.byId.get(id);
    if (!atom) continue;
    const enforced = Array.isArray(atom.fields?.enforces)
      ? (atom.fields.enforces as Array<{ atom?: unknown }>)
      : [];
    for (const link of enforced) if (typeof link.atom === 'string') out.add(link.atom);
    for (const guard of atom.enforcement ?? []) out.add(guard);
    if (atom.kind === 'tool')
      for (const other of env.atoms) if (other.provenance.file === atom.provenance.file) out.add(other.id);
  }
  return out;
}

/** The text of an atom a code-written ask may be made of: its title, situation, passage and string fields. */
function textOf(atom: Atom): string {
  const parts = [atom.title, atom.situation ?? '', atom.provenance.quote];
  for (const value of Object.values(atom.fields ?? {})) if (typeof value === 'string') parts.push(value);
  return flat(parts.join(' . '));
}

/** The share of the runs of `gram` characters of `piece` that `source` also holds (1 when the piece is shorter than a run and sits in the source whole). */
export function containment(piece: string, source: string, gram: number): number {
  const core = ` ${flat(piece)} `;
  const pool = ` ${flat(source)} `;
  if (core.trim() === '') return 1;
  if (core.length <= gram) return pool.includes(core) ? 1 : 0;
  let held = 0;
  let total = 0;
  for (let at = 0; at + gram <= core.length; at += 1) {
    total += 1;
    if (pool.includes(core.slice(at, at + gram))) held += 1;
  }
  return held / total;
}

/** Test types whose ask must not set the unit off. */
export const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'outside_trigger',
  'route_near_miss',
  'guard_negative',
]);
/** Test types that run a guard on a payload: the ask is never read. */
const UNREAD_TYPES: ReadonlySet<string> = new Set(['guard_hostile', 'guard_speed', 'guard_register']);
const RULE_KINDS: ReadonlySet<string> = new Set(['instruction', 'gate', 'register', 'invariant']);
const NEUTRAL: Readonly<Record<string, string>> = { outside: OUTSIDE_ASK, resume: RESUME_ASK };

export type TraceNeed = { act: Act; control: boolean; spans: string[] };
export type AskVerdict = { reasons: string[]; trace?: TraceNeed };

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Letters and digits of a text, lower case, one space between runs: the shape two texts are compared in. */
export const flat = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function firstAskOf(spec: SuiteSpec): string {
  const block = (spec.spec.blocks ?? [])[0] as { when?: { user?: unknown } } | undefined;
  return typeof block?.when?.user === 'string' ? block.when.user : '';
}

const sameAct = (a: Act, b: Act): boolean =>
  a.kind === b.kind && a.name === b.name && a.target === b.target && a.verdict === b.verdict;

export function spansOf(ask: string): string[] {
  return [...ask.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1] ?? '')
    .filter((span) => span.trim() !== '');
}

/** The text of the atoms a piece of a code-written ask may be written from: the cited atom and the row's own. */
function pooledText(env: AskEnv, cited: Atom, atomIds: readonly string[]): string {
  const texts = [textOf(cited)];
  for (const id of atomIds) {
    const atom = env.byId.get(id);
    if (atom && atom.id !== cited.id) texts.push(textOf(atom));
  }
  return texts.join(' . ');
}

/**
 * What a code-written ask owes its source: every piece it names is in the ask, and, when the tie is on, every
 * piece is made of the text of the atoms it came from. A piece set into the fixed phrase of a tool (the act the
 * tool of a guard performs) owes the table of the generator instead.
 */
function pieceReasons(
  from: Record<string, unknown>,
  cited: Atom,
  ask: string,
  atomIds: readonly string[],
  env: AskEnv,
): string[] {
  const reasons: string[] = [];
  const pieces = Array.isArray(from.pieces)
    ? (from.pieces as unknown[]).filter((piece): piece is string => typeof piece === 'string')
    : undefined;
  if (!pieces) return ['the ask names the pieces it is made of: none'];
  if (from.form === 'hazard' && !ask.includes(HAZARD_FRAME))
    reasons.push('a hazard ask without the fixed words of one');
  if (pieces.length === 0 && from.form !== 'hazard')
    return ['a code-written ask holds nothing written from its source'];
  if (VERBATIM_FORMS.includes(String(from.form)) && flat(ask) !== flat(pieces.join(' ')))
    reasons.push('an ask of this form is its source and nothing around it');
  const pool = pooledText(env, cited, atomIds);
  const tools =
    from.form === 'tool' && typeof cited.fields?.matcher === 'string'
      ? cited.fields.matcher
          .split('|')
          .map((tool) => TOOL_ACTS[tool] ?? `use the ${tool} tool on the files here`)
      : [];
  for (const piece of pieces) {
    if (!ask.includes(piece)) {
      reasons.push(`the piece "${piece}" is not in the ask`);
      continue;
    }
    let rest = piece;
    if (from.form === 'tool') {
      const phrase = tools.find((candidate) => piece.startsWith(candidate));
      if (phrase === undefined) {
        reasons.push(`the piece "${piece}" is no act of a tool the guard watches`);
        continue;
      }
      rest = piece.slice(phrase.length);
    }
    if (env.tie && flat(rest) !== '' && containment(rest, pool, env.tie.gram) < env.tie.floor)
      reasons.push(`the piece "${piece}" is not made of the text of ${cited.id}`);
  }
  return reasons;
}

export function checkAsk(spec: SuiteSpec, env: AskEnv): AskVerdict {
  const reasons: string[] = [];
  const meta = record(record(spec.spec.metadata)?.estate);
  const ask = firstAskOf(spec);
  if (!meta) return { reasons: ['the spec carries no estate record'] };

  // C1: the link.
  const link = record(meta.link);
  const atomIds = Array.isArray(meta.atoms)
    ? (meta.atoms as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  const unit = typeof link?.span === 'string' ? env.byId.get(link.span) : undefined;
  if (!link) reasons.push('no link to a rule unit');
  else if (!unit) reasons.push(`the link names ${String(link.span)}, which the map does not hold`);
  else {
    if (link.span !== atomIds[0]) reasons.push(`the link names ${link.span}, the row tests ${atomIds[0]}`);
    if (link.fp !== unit.provenance.hash) reasons.push(`the link fingerprint of ${unit.id} is not the map's`);
    if (link.relation !== 'exercises' || link.createdBy !== 'generator')
      reasons.push('the link is not an exercise written by the generator');
  }
  if (!unit) return { reasons };

  // C2: the act.
  const expected = actOfAtom(unit, env.atoms);
  const written = record(meta.act);
  if (!written) reasons.push('no act');
  else if (
    !sameAct(expected, {
      kind: written.kind,
      name: written.name,
      target: written.target,
      verdict: written.verdict,
    } as Act)
  )
    reasons.push(
      `the act of ${unit.id} is ${JSON.stringify(expected)}, the spec says ${JSON.stringify(written)}`,
    );

  // C3: the source of the ask.
  const from = record(meta.from);
  const listing = (id: string) => env.bank.situations.find((situation) => situation.id === id);
  const related = relatedIds(env, atomIds);
  const rowLists = (atoms: readonly string[]) => atoms.some((id) => related.has(id));
  if (!from) reasons.push('the ask names no source');
  else if (typeof from.bank === 'string') {
    const situation = listing(from.bank);
    const phrase = typeof from.phrase === 'number' ? situation?.phrases[from.phrase] : undefined;
    if (!situation) reasons.push(`the bank holds no situation ${from.bank}`);
    else if (!rowLists(situation.atoms))
      reasons.push(`the situation ${situation.id} lists none of the atoms of the row`);
    else if (!phrase || phrase.approved === false || phrase.text !== ask)
      reasons.push(`the ask is not an approved phrase of ${situation.id}`);
  } else if (typeof from.session === 'string') {
    const session = env.sessions.sessions.find((entry) => entry.name === from.session);
    const situation = session ? listing(session.situation) : undefined;
    if (!session) reasons.push(`no recorded session ${from.session}`);
    else if (session.ask !== ask) reasons.push(`the ask is not the ask of the session ${session.name}`);
    else if (!situation || !rowLists(situation.atoms))
      reasons.push(`the situation of the session ${session.name} lists none of the atoms of the row`);
  } else if (typeof from.neutral === 'string') {
    if (from.neutral === 'guard-event') {
      if (!UNREAD_TYPES.has(spec.testType)) reasons.push('a payload ask in a test that reads its ask');
    } else if (NEUTRAL[from.neutral] !== ask) reasons.push(`the ask is not the fixed ${from.neutral} ask`);
  } else if (typeof from.form === 'string') {
    const [id, label] = String(from.field).split('#', 2);
    const cited = id === undefined ? undefined : env.byId.get(id);
    if (!(ASK_FORMS as readonly string[]).includes(from.form))
      reasons.push(`${from.form} is no form of the generator`);
    else if (!cited) reasons.push(`the ask cites ${String(id)}, which the map does not hold`);
    else if (label === undefined || !label.startsWith(from.form))
      reasons.push(`the field ${String(from.field)} is no field of the form ${from.form}`);
    else if (from.fp !== cited.provenance.hash)
      reasons.push(`the fingerprint of ${cited.id} is not the map's`);
    else reasons.push(...pieceReasons(from, cited, ask, atomIds, env));
  } else reasons.push('the source of the ask is none of bank, session, neutral or form');

  // C3, last part: an ask never holds the text of a rule of the estate.
  const text = flat(ask);
  for (const rule of env.atoms) {
    if (!RULE_KINDS.has(rule.kind)) continue;
    for (const candidate of [rule.title, rule.provenance.quote]) {
      const rule_ = flat(candidate);
      if (rule_.length >= 12 && text.includes(rule_)) {
        reasons.push(`the ask holds the text of the rule ${rule.id}`);
        break;
      }
    }
  }

  // C4: an explicit ask names a target of the act, and the trace shows the act.
  const spans = spansOf(ask);
  let trace: TraceNeed | undefined;
  if (spans.length > 0 && expected.kind !== 'reply') {
    const targets = targetsOf(expected, unit, env.atoms);
    if (targets !== undefined) {
      for (const span of spans)
        if (!targets.some((target) => sameTarget(span, target)))
          reasons.push(`the ask names \`${span}\`, which is no target of the act`);
      if (reasons.length === 0 && spec.mode === 'live' && expected.kind !== 'guard')
        trace = { act: expected, control: CONTROL_TYPES.has(spec.testType), spans };
    }
  }
  return { reasons, ...(trace ? { trace } : {}) };
}

const normalPath = (path: string): string => path.replace(/^\.\//, '').replaceAll('\\', '/');

/** Whether the trace of a run shows the act. */
export function shows(act: Act, observed: Observed): boolean {
  const calls = observed.toolCalls ?? [];
  const runtime = observed.runtime;
  const inputText = (input: unknown): string => JSON.stringify(input ?? {});
  switch (act.kind) {
    case 'call':
      return calls.some(
        (call) =>
          call.label === act.name && (act.target === undefined || inputText(call.input).includes(act.target)),
      );
    case 'read': {
      const target = normalPath(act.target ?? '');
      const reads = [
        ...calls
          .filter((call) => call.label === 'Read')
          .map((call) => String(record(call.input)?.file_path ?? '')),
        ...(runtime?.references ?? []).map((entry) => entry.path),
      ];
      return target !== '' && reads.some((path) => normalPath(path).endsWith(target));
    }
    case 'skill':
    case 'helper':
    case 'owned': {
      const helper = act.kind === 'helper' || (act.kind === 'owned' && act.target === 'helper');
      if (helper)
        return (
          (runtime?.subagents ?? []).some((entry) => entry.name === act.name) ||
          calls.some((call) => call.label === 'Agent' && record(call.input)?.subagent_type === act.name)
        );
      return (
        (runtime?.skills ?? []).some((entry) => entry.name === act.name) ||
        calls.some((call) => call.label === 'Skill' && record(call.input)?.skill === act.name)
      );
    }
    default:
      return false;
  }
}

export function checkTrace(need: TraceNeed, observed: Observed | undefined): string | undefined {
  if (!observed) return 'the fake did not run the ask';
  const shown = shows(need.act, observed);
  if (need.control) return shown ? 'a control shows the act' : undefined;
  return shown ? undefined : `the trace of the fake does not show the act ${JSON.stringify(need.act)}`;
}
