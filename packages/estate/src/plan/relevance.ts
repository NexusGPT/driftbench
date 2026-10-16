import type { SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, AtomKind, EstateMap } from '../schema';

/**
 * A situation is crossed only with the atoms it can act on, decided from typed facts and no word of the
 * estate: the kind of an atom, the type of each predicate of its evidence, the kind of each edge of the graph,
 * and the typed fields of an atom (the hazard a hazard atom names, the event of a guard, the tools a unit
 * declares). Each situation value has one relation, named by a fixed table of the space's own values; the atoms
 * that hold the relation are its targets. A situation with no target is crossed with no atom: nothing in the
 * estate can be acted on in it, and a row would test nothing. A supplied space is authoritative and is not
 * touched. The plan's notes list every situation that was left without a row.
 */
export type Relation =
  | 'helper'
  | 'tool'
  | 'stage'
  | 'output'
  | 'data'
  | 'confirmation'
  | 'rate'
  | 'restart'
  | 'compaction'
  | 'stoprule'
  | 'stop'
  | 'prompt'
  | 'routing';

/** The relation each situation value tests, by `dimension=value`. A value not listed constrains nothing. */
export const RELATION_OF: Readonly<Record<string, Relation>> = {
  'estate_hazard=dead_helper': 'helper',
  'session_state=helpers_running': 'helper',
  'estate_hazard=stale_tracker': 'stage',
  'deviation=D5_language_switch': 'output',
  'owner_signal=language_switch': 'output',
  'deviation=D8_tool_failure': 'tool',
  'deviation=D6_instruction_in_data': 'data',
  'deviation=D4_loose_confirmation': 'confirmation',
  'owner_signal=no_questions': 'confirmation',
  'estate_hazard=rate_wave': 'rate',
  'estate_hazard=process_restart': 'restart',
  'session_state=after_restart': 'restart',
  'estate_hazard=compaction_mid_task': 'compaction',
  'session_state=after_compaction': 'compaction',
  'session_state=resumed': 'stoprule',
  'owner_signal=stop': 'stop',
  'deviation=D2_goal_shift': 'routing',
  'deviation=D1_off_topic': 'routing',
  'deviation=D9_out_of_scope': 'routing',
  'deviation=D7_silence_or_burst': 'prompt',
};

/** The tools that bring outside data into a run: what an instruction planted in data would arrive through. */
const DATA_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
/** The tools that call a service or a helper, where a rate limit or a retry contract applies. */
const SERVICE_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Bash']);

/** The kinds that hold a relation by what they are. */
const IDENTITY: Readonly<Record<Relation, readonly AtomKind[]>> = {
  helper: ['subagent'],
  tool: ['tool', 'script', 'guard'],
  stage: ['stage'],
  output: ['register'],
  data: [],
  confirmation: ['gate'],
  rate: ['script', 'subagent'],
  restart: [],
  compaction: [],
  stoprule: [],
  stop: [],
  prompt: [],
  routing: ['route'],
};

const called = (atom: Atom, labels: ReadonlySet<string>) =>
  atom.evidence.some((item) => item.type === 'tool_called' && labels.has(item.label));

type Context = {
  /** Atoms that a guard on the prompt event enforces: the rules of the owner's words. */
  promptRules: ReadonlySet<string>;
  /** Atoms read from the same line as a hazard atom, by the hazard the line names. */
  byHazard: ReadonlyMap<string, ReadonlySet<string>>;
};

function contextOf(atoms: readonly Atom[], edges: EstateMap['edges']): Context {
  const prompt = new Set(
    atoms
      .filter((atom) => atom.kind === 'guard' && atom.fields?.event === 'UserPromptSubmit')
      .map((a) => a.id),
  );
  const promptRules = new Set(
    edges.filter((edge) => edge.kind === 'enforces' && prompt.has(edge.from)).map((edge) => edge.to),
  );
  const line = (atom: Atom) =>
    `${atom.provenance.file}:${atom.provenance.startLine}:${atom.provenance.endLine}`;
  const hazardOfLine = new Map<string, string>();
  for (const atom of atoms)
    if (atom.kind === 'hazard' && typeof atom.fields?.hazard === 'string')
      hazardOfLine.set(line(atom), atom.fields.hazard);
  const byHazard = new Map<string, Set<string>>();
  for (const atom of atoms) {
    const hazard = hazardOfLine.get(line(atom));
    if (hazard === undefined || (atom.kind !== 'instruction' && atom.kind !== 'gate')) continue;
    byHazard.set(hazard, (byHazard.get(hazard) ?? new Set()).add(atom.id));
  }
  return { promptRules, byHazard };
}

function holds(relation: Relation, atom: Atom, context: Context): boolean {
  const kind = atom.kind;
  const field = (name: string) => atom.fields?.[name];
  if (IDENTITY[relation].includes(kind)) return true;
  switch (relation) {
    case 'tool':
      // A unit that declares tools holds the failure of one of them.
      return (
        (kind === 'skill' || kind === 'subagent') &&
        Array.isArray(field('tools')) &&
        (field('tools') as unknown[]).length > 0
      );
    case 'output':
      return kind === 'instruction' && atom.evidence.some((item) => item.type === 'text');
    case 'data':
      return (
        ((kind === 'instruction' || kind === 'gate') && called(atom, DATA_TOOLS)) ||
        (kind === 'guard' && field('event') === 'PostToolUse')
      );
    case 'rate':
      return (
        (kind === 'tool' && SERVICE_TOOLS.has(String(field('tool')))) ||
        (kind === 'instruction' && called(atom, SERVICE_TOOLS))
      );
    case 'restart':
      return context.byHazard.get('restart')?.has(atom.id) === true;
    case 'compaction':
      return context.byHazard.get('compaction')?.has(atom.id) === true;
    case 'stoprule':
      return (kind === 'instruction' || kind === 'gate') && context.promptRules.has(atom.id);
    case 'stop':
      return holds('stoprule', atom, context) || holds('prompt', atom, context);
    case 'prompt':
      return kind === 'guard' && field('event') === 'UserPromptSubmit';
    default:
      return false;
  }
}

/**
 * The atoms a relation can act on: those that hold it, and the routes that open one (a route to a helper, a
 * route to a unit that declares tools). For routing, the routes and the skills they open.
 */
export function relevantTo(
  relation: Relation,
  atoms: readonly Atom[],
  edges: EstateMap['edges'],
): Set<string> {
  const context = contextOf(atoms, edges);
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const own = new Set(atoms.filter((atom) => holds(relation, atom, context)).map((atom) => atom.id));
  const out = new Set(own);
  if (relation === 'helper' || relation === 'tool')
    for (const edge of edges) if (edge.kind === 'route' && own.has(edge.to)) out.add(edge.from);
  if (relation === 'routing')
    for (const edge of edges)
      if (edge.kind === 'route' && own.has(edge.from) && byId.get(edge.to)?.kind === 'skill')
        out.add(edge.to);
  return out;
}

export function situationSpace(map: EstateMap, space: SpaceMap): { space: SpaceMap; notes: string[] } {
  const approved = map.atoms.filter((atom) => atom.approved);
  const edges = map.edges.filter(
    (edge) => approved.some((atom) => atom.id === edge.from) && approved.some((atom) => atom.id === edge.to),
  );
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  const constraints = [...space.constraints];
  const notes: string[] = [];
  const relevant = new Map<Relation, Set<string>>();
  for (const dimension of space.dimensions) {
    for (const value of dimension.values) {
      const relation = RELATION_OF[`${dimension.id}=${value.id}`];
      if (relation === undefined) continue;
      let acts = relevant.get(relation);
      if (acts === undefined) {
        acts = relevantTo(relation, approved, edges);
        relevant.set(relation, acts);
      }
      if (acts.size === 0)
        notes.push(
          `${dimension.id}=${value.id}: no atom of the estate holds the relation this situation tests (${relation}), so it is crossed with no atom and the plan holds no row of it.`,
        );
      for (const target of targets)
        for (const atom of target.values) {
          if (acts.has(atom.id)) continue;
          constraints.push({
            forbid: { [target.id]: atom.id, [dimension.id]: value.id },
            reason: `${atom.id} does not hold the relation ${relation}: ${value.title}`,
          });
        }
    }
  }
  return { space: { ...space, constraints }, notes };
}
