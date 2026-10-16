import type { Atom, AtomKind, EstateMap } from '@agent-nexus/driftbench-estate';

/**
 * What the validator knows, with no word of the estate read, about which atoms a situation can act on.
 *
 * The planner reads an estate's words to infer relevance (docs/estate.md, "Situation relevance in a proposed plan").
 * An oracle that read the same words would agree with the planner by construction. This one reads only typed data
 * the validator planted or the map states in a typed field: the kind of an atom, the type of each predicate of its
 * evidence, the kind of each edge of the graph, the typed fields of an atom (a hazard id, a permission effect, a guard
 * event) and what the hidden estate planted for a standing rule (the hazard it names, the scope it applies in, its
 * behaviour). No title, quote, situation or description is read.
 *
 * Each situation has one relation. The atoms that hold it are its identified targets. When no atom holds the
 * relation, no atom applies and any crossing of the situation is wrong.
 */

/** What a standing rule of the hidden estate plants, by the id of the scanned atom it was matched to. */
export type Planted = {
  /** The runtime hazard the rule's line names. */
  hazard?: string;
  /** The situation the rule applies in: always, or its own (a stop, a push, a compaction, a restart). */
  scope?: string;
  /** The act of the rule follower that obeys the rule. */
  behaviour?: string;
};

export type Relation =
  | 'helper'
  | 'tool'
  | 'stage'
  | 'output'
  | 'confirmation'
  | 'restart'
  | 'compaction'
  | 'stop'
  | 'prompt'
  | 'routing';

/** The edges a relation follows from an atom to the atoms it reaches, transitively. */
const REACH: Partial<Record<Relation, readonly string[]>> = {
  helper: ['route', 'dispatch'],
  tool: ['route', 'dispatch', 'reference', 'script', 'enforces'],
};

const TOOL_KINDS: readonly AtomKind[] = ['tool', 'script', 'guard'];
const TOOL_EVIDENCE = new Set(['tool_called', 'tool_not_called', 'ordered']);

/** The kinds that hold a relation by what they are, whatever their evidence. */
export const IDENTITY: Record<Relation, readonly AtomKind[]> = {
  helper: ['subagent'],
  tool: TOOL_KINDS,
  stage: ['stage'],
  output: ['register'],
  confirmation: [],
  restart: [],
  compaction: [],
  stop: [],
  prompt: [],
  routing: ['route'],
};

const calls = (atom: Atom, label: string) =>
  atom.evidence.some((item) => item.type === 'tool_called' && item.label === label);

/** Whether the atom holds the relation itself, from its kind, its typed evidence, its typed fields or what was planted. */
function holds(relation: Relation, atom: Atom, planted: Planted | undefined): boolean {
  const field = (name: string) => atom.fields?.[name];
  switch (relation) {
    case 'helper':
      return atom.kind === 'subagent' || calls(atom, 'Agent');
    case 'tool':
      return TOOL_KINDS.includes(atom.kind) || atom.evidence.some((item) => TOOL_EVIDENCE.has(item.type));
    case 'stage':
      return atom.kind === 'stage' || atom.evidence.some((item) => item.type === 'stage_reached');
    case 'output':
      return atom.kind === 'register' || atom.evidence.some((item) => item.type === 'text');
    case 'confirmation':
      return atom.kind === 'tool' && field('effect') === 'ask';
    case 'restart':
    case 'compaction': {
      const hazard = relation === 'restart' ? 'restart' : 'compaction';
      return (
        (atom.kind === 'hazard' && field('hazard') === hazard) ||
        planted?.hazard === hazard ||
        planted?.scope === hazard
      );
    }
    case 'stop':
      return (
        planted?.scope === 'stop' ||
        planted?.behaviour === 'stop_on_word' ||
        (atom.kind === 'guard' && field('event') === 'UserPromptSubmit')
      );
    case 'prompt':
      return atom.kind === 'guard' && field('event') === 'UserPromptSubmit';
    case 'routing':
      return atom.kind === 'route';
  }
}

/**
 * The identified targets of a relation: the atoms that hold it, and for a relation that follows edges (a helper
 * dispatched by a skill, a tool called by a script a skill runs), the atoms that reach one that does.
 */
export function targetsOf(
  relation: Relation,
  map: Pick<EstateMap, 'atoms' | 'edges'>,
  planted: ReadonlyMap<string, Planted> = new Map(),
): Set<string> {
  const own = new Set(
    map.atoms.filter((atom) => holds(relation, atom, planted.get(atom.id))).map((atom) => atom.id),
  );
  const out = new Set(own);
  const follow = REACH[relation];
  if (follow) {
    // Walk the graph backwards from the atoms that hold the relation: whatever points at one reaches it.
    for (let grew = true; grew; ) {
      grew = false;
      for (const edge of map.edges)
        if (follow.includes(edge.kind) && out.has(edge.to) && !out.has(edge.from)) {
          out.add(edge.from);
          grew = true;
        }
    }
  }
  // A route also holds the unit it opens: a turn that leaves the routed task acts on both.
  if (relation === 'routing')
    for (const edge of map.edges) if (edge.kind === 'route' && own.has(edge.from)) out.add(edge.to);
  return out;
}

export type Crossing = { row: string; atom: string };

export type RelevanceVerdict = { pass: boolean; detail: string };

/**
 * The verdict on one situation: `crossings` are the rows of the plan that cross it with an atom. With identified
 * targets, a crossing with any other atom is wrong, and at least one crossing must be with a target. With none, no
 * atom applies and any crossing is wrong: the bank plants the typed fact each situation tests, and an estate that
 * holds none gives the situation nothing to act on.
 */
export function judgeRelevance(
  relation: Relation,
  map: Pick<EstateMap, 'atoms' | 'edges'>,
  crossings: readonly Crossing[],
  planted: ReadonlyMap<string, Planted> = new Map(),
): RelevanceVerdict {
  const known = new Set(map.atoms.map((atom) => atom.id));
  const rows = crossings.filter((crossing) => known.has(crossing.atom));
  const targets = targetsOf(relation, map, planted);
  // No atom holds the relation: no atom applies, so any crossing is wrong. A plan with no row for the situation is not.
  if (targets.size === 0) {
    return rows.length > 0
      ? {
          pass: false,
          detail: `no atom holds the relation, yet ${rows.length} rows cross it: ${rows
            .slice(0, 3)
            .map((crossing) => `${crossing.row} ${crossing.atom}`)
            .join(', ')}`,
        }
      : { pass: true, detail: 'no atom applies and the plan holds no row of this situation' };
  }
  const wrong = rows.filter((crossing) => !targets.has(crossing.atom));
  if (wrong.length > 0) {
    const kind = (id: string) => map.atoms.find((atom) => atom.id === id)?.kind;
    return {
      pass: false,
      detail: `${wrong.length} rows cross it with atoms it cannot act on: ${wrong
        .slice(0, 3)
        .map((crossing) => `${crossing.row} ${crossing.atom} (${kind(crossing.atom)})`)
        .join(', ')}`,
    };
  }
  return rows.length === 0
    ? {
        pass: false,
        detail: `${targets.size} atoms can be acted on and no row crosses the situation with one`,
      }
    : { pass: true, detail: 'holds' };
}
