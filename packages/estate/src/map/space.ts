import { DeviationClass } from '@agent-nexus/driftbench-core';
import { DEVIATION_TITLES, NONE, type SpaceDimension, type SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, AtomKind, EstateMap } from '../schema';

/**
 * The situation axes of an estate, as a space map the space commands read (design section 3). The fixed
 * axes are the same for every estate: the class and the shape of the ask, the session state, the owner's
 * signal, the harness deviation classes, and the estate's own hazards. The space map holds one deviation
 * dimension whose values are deviation classes, so the estate-only hazards (compaction mid-task, a process
 * restart, a rate wave, a stale tracker, a dead helper) are a dimension of their own. Then one dimension per
 * atom kind lists the atoms a block can target: the axis atoms, approved ones only unless asked otherwise.
 * Value ids are unique across dimensions of one kind, as the space map requires.
 */

type Axis = {
  id: string;
  title: string;
  kind: SpaceDimension['kind'];
  values: Array<{ id: string; title: string }>;
};

export const ESTATE_AXES: readonly Axis[] = [
  {
    id: 'ask_class',
    title: 'What the owner asks for',
    kind: 'task',
    values: [
      { id: 'build', title: 'Build something new' },
      { id: 'operate', title: 'Run an operation on something that exists' },
      { id: 'debug', title: 'Find why something misbehaves' },
      { id: 'research', title: 'Look into a question' },
      { id: 'compose', title: 'Write a text or give advice' },
      { id: 'change_estate', title: 'Change the estate itself' },
      { id: 'chat', title: 'Talk, with no act asked' },
    ],
  },
  {
    id: 'ask_shape',
    title: 'How the ask is put',
    kind: 'persona',
    values: [
      { id: 'concrete', title: 'Names its resources and inputs' },
      { id: 'ambiguous', title: 'Open to more than one reading' },
      { id: 'prescribed', title: 'Spells out the exact change' },
      { id: 'problem', title: 'States a problem, not a change' },
      { id: 'multi_part', title: 'Holds several asks' },
      { id: 'correction', title: 'Corrects an earlier turn' },
    ],
  },
  {
    id: 'session_state',
    title: 'The state of the session when the ask arrives',
    kind: 'data',
    values: [
      { id: 'fresh', title: 'A new session' },
      { id: 'resumed', title: 'Resumed with an open tracker' },
      { id: 'after_compaction', title: 'After a compaction' },
      { id: 'after_restart', title: 'After a restart' },
      { id: 'long', title: 'A long session' },
      { id: 'helpers_running', title: 'Helpers running in the background' },
    ],
  },
  {
    id: 'owner_signal',
    title: 'What the owner signals besides the ask',
    kind: 'persona',
    values: [
      { id: 'go', title: 'An explicit go' },
      { id: 'hold', title: 'A hold' },
      { id: 'no_questions', title: 'No questions' },
      { id: 'keep_going', title: 'Keep going' },
      { id: 'stop', title: 'Stop' },
      { id: 'language_switch', title: 'A switch of language' },
      { id: 'frustration', title: 'Frustration' },
      { id: 'limit_word', title: 'A limit word in the ask' },
    ],
  },
  {
    id: 'deviation',
    title: 'A deviation in the turn',
    kind: 'deviation',
    values: [
      { id: NONE, title: 'No deviation' },
      ...DeviationClass.options.map((id) => ({ id, title: DEVIATION_TITLES[id] })),
    ],
  },
  {
    id: 'estate_hazard',
    title: 'A hazard of the runtime during the task',
    kind: 'data',
    values: [
      { id: 'no_hazard', title: 'No hazard' },
      { id: 'compaction_mid_task', title: 'A compaction in the middle of the task' },
      { id: 'process_restart', title: 'The process restarts' },
      { id: 'rate_wave', title: 'A wave of rate limits' },
      { id: 'stale_tracker', title: 'The tracker is stale' },
      { id: 'dead_helper', title: 'A helper died' },
    ],
  },
];

/** Combinations no session can hold. */
export const ESTATE_CONSTRAINTS: SpaceMap['constraints'] = [
  {
    forbid: { session_state: 'fresh', estate_hazard: 'compaction_mid_task' },
    reason: 'a compaction needs a long session',
  },
  {
    forbid: { session_state: 'fresh', estate_hazard: 'dead_helper' },
    reason: 'a dead helper needs helpers that were running',
  },
  {
    forbid: { session_state: 'fresh', estate_hazard: 'stale_tracker' },
    reason: 'a stale tracker needs a tracker opened earlier',
  },
];

/**
 * The atoms a situation value can act on (design section 4, "Relevance"). A pairwise row crosses a value only
 * with a target it can change: a dead helper with a helper or a route to one, a stale tracker with a stage, a
 * switch of language with an output rule or an instruction. A value this list does not name (and every first
 * value of an axis: a fresh session, an explicit go, no deviation, no hazard) acts on every atom.
 */
export const SITUATION_RELEVANCE: ReadonlyArray<{
  dimension: string;
  value: string;
  kinds: readonly AtomKind[];
  /** Routes whose target is a helper count as helper atoms. */
  helperRoutes?: boolean;
  reason: string;
}> = [
  { dimension: 'session_state', value: 'resumed', kinds: ['stage', 'instruction', 'gate', 'skill', 'route'], reason: 'a resumed session picks up open work: its steps, its rules and the skill it was in' },
  { dimension: 'session_state', value: 'after_compaction', kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'], reason: 'a compaction loses what the context held: rules, reads, the step, the loaded skill' },
  { dimension: 'session_state', value: 'after_restart', kinds: ['stage', 'subagent', 'instruction', 'gate'], reason: 'a restart loses running helpers and the place in the steps' },
  { dimension: 'session_state', value: 'helpers_running', kinds: ['subagent'], helperRoutes: true, reason: 'running helpers matter only to helpers and the routes to them' },
  { dimension: 'owner_signal', value: 'no_questions', kinds: ['instruction', 'gate', 'register'], reason: 'no questions bears on rules about asking and on what a reply holds' },
  { dimension: 'owner_signal', value: 'stop', kinds: ['instruction', 'stage', 'subagent', 'guard'], reason: 'a stop ends acts: rules, steps, helpers and the guards that watch them' },
  { dimension: 'owner_signal', value: 'language_switch', kinds: ['register', 'instruction'], reason: 'a language changes what a reply says, not which tool runs' },
  { dimension: 'deviation', value: 'D1_off_topic', kinds: ['route', 'skill', 'instruction', 'register', 'stage'], reason: 'an off-topic turn tests routing, scope rules, the reply and the place in the steps' },
  { dimension: 'deviation', value: 'D2_goal_shift', kinds: ['route', 'skill', 'stage', 'instruction'], reason: 'a goal shift tests routing and the steps under way' },
  { dimension: 'deviation', value: 'D4_loose_confirmation', kinds: ['instruction', 'gate', 'guard'], reason: 'a loose confirmation tests rules and gates that need a clear go, and the guards behind them' },
  { dimension: 'deviation', value: 'D5_language_switch', kinds: ['register', 'instruction'], reason: 'a language changes what a reply says, not which tool runs' },
  { dimension: 'deviation', value: 'D6_instruction_in_data', kinds: ['instruction', 'gate', 'guard', 'register'], reason: 'an instruction in the data tests the rules it tries to override and the guards behind them' },
  { dimension: 'deviation', value: 'D7_silence_or_burst', kinds: ['instruction', 'register', 'guard', 'subagent'], reason: 'silence or a burst of messages tests turn rules, the reply, per-turn guards and helpers in flight' },
  { dimension: 'deviation', value: 'D8_tool_failure', kinds: ['tool', 'script', 'guard', 'subagent', 'skill', 'route'], reason: 'a failing tool matters to what calls tools: tools, scripts, guards, helpers, skills' },
  { dimension: 'deviation', value: 'D9_out_of_scope', kinds: ['route', 'skill', 'subagent', 'instruction'], reason: 'an out-of-scope ask tests routing and the scope of skills and helpers' },
  { dimension: 'estate_hazard', value: 'compaction_mid_task', kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'], reason: 'a compaction loses what the context held: rules, reads, the step, the loaded skill' },
  { dimension: 'estate_hazard', value: 'process_restart', kinds: ['stage', 'subagent', 'instruction', 'gate'], reason: 'a restart loses running helpers and the place in the steps' },
  { dimension: 'estate_hazard', value: 'rate_wave', kinds: ['tool', 'script', 'subagent', 'instruction', 'stage'], reason: 'rate limits slow calls: tools, scripts, helpers, and the rules and steps that wait on them' },
  { dimension: 'estate_hazard', value: 'stale_tracker', kinds: ['stage'], reason: 'a stale tracker misplaces the steps' },
  { dimension: 'estate_hazard', value: 'dead_helper', kinds: ['subagent'], helperRoutes: true, reason: 'a dead helper matters only to helpers and the routes to them' },
];

/** Whether a situation value can act on an atom (`SITUATION_RELEVANCE`); a value it does not name acts on all. */
export function actsOn(dimension: string, value: string, atom: Pick<Atom, 'kind' | 'fields'>): boolean {
  const rule = SITUATION_RELEVANCE.find((entry) => entry.dimension === dimension && entry.value === value);
  if (!rule) return true;
  if (rule.kinds.includes(atom.kind)) return true;
  return rule.helperRoutes === true && atom.kind === 'route' && atom.fields?.targetKind === 'subagent';
}

/** The atom kinds whose atoms a block targets, in the order the space map lists their dimensions. */
const TARGET_KINDS: readonly AtomKind[] = [
  'instruction',
  'gate',
  'route',
  'skill',
  'subagent',
  'guard',
  'stage',
  'register',
  'reference',
  'script',
  'tool',
  'setting',
  'hazard',
  'invariant',
];

export type EstateSpaceOptions = {
  /** Keep only approved atoms. Default true. */
  approvedOnly?: boolean;
  /** The agent the space map describes. Default `estate`. */
  agent?: string;
};

export function toEstateSpaceMap(map: EstateMap, options: EstateSpaceOptions = {}): SpaceMap {
  const approvedOnly = options.approvedOnly ?? true;
  const dimensions: SpaceDimension[] = ESTATE_AXES.map((axis) => ({
    ...axis,
    values: axis.values.map((v) => ({ ...v })),
  }));
  for (const kind of TARGET_KINDS) {
    const values = map.atoms
      .filter((atom) => atom.kind === kind && atom.role === 'axis' && (!approvedOnly || atom.approved))
      .map((atom) => ({ id: atom.id, title: atom.title }));
    if (values.length > 0)
      dimensions.push({ id: `atoms.${kind}`, title: `Target ${kind} atoms`, kind: 'behaviour', values });
  }
  return {
    version: map.hash.slice(0, 12),
    agent: options.agent ?? 'estate',
    dimensions,
    constraints: ESTATE_CONSTRAINTS.map((constraint) => ({
      forbid: { ...constraint.forbid },
      reason: constraint.reason,
    })),
    prior: { kind: 'declared' },
  };
}
