import type { Atom, AtomKind } from '../schema';

/**
 * The atoms each situation value can act on (design section 4, "under the constraint list"). A pairwise row
 * is one atom in one situation; a situation that cannot touch the atom tests nothing. A dead helper or
 * helpers running acts on helpers and the routes that dispatch them; a stale tracker on stages; a switch of
 * language on output rules and instructions; a tool failure on what runs tools. A value not listed here
 * acts on every atom.
 */
export const ACTS_ON: Readonly<Record<string, Readonly<Record<string, readonly AtomKind[]>>>> = {
  estate_hazard: {
    dead_helper: ['subagent'],
    stale_tracker: ['stage'],
    rate_wave: ['tool', 'script', 'subagent', 'instruction', 'stage'],
    process_restart: ['stage', 'subagent', 'instruction', 'gate'],
    compaction_mid_task: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  },
  session_state: {
    helpers_running: ['subagent'],
    after_compaction: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
    after_restart: ['stage', 'subagent', 'instruction', 'gate'],
    resumed: ['stage', 'instruction', 'gate', 'skill', 'route'],
  },
  owner_signal: {
    language_switch: ['register', 'instruction'],
    stop: ['instruction', 'stage', 'subagent', 'guard'],
    no_questions: ['instruction', 'gate', 'register'],
  },
  deviation: {
    D1_off_topic: ['route', 'skill', 'instruction', 'register', 'stage'],
    D2_goal_shift: ['route', 'skill', 'stage', 'instruction'],
    D4_loose_confirmation: ['instruction', 'gate', 'guard'],
    D5_language_switch: ['register', 'instruction'],
    D6_instruction_in_data: ['instruction', 'gate', 'guard', 'register'],
    D7_silence_or_burst: ['instruction', 'register', 'guard', 'subagent'],
    D8_tool_failure: ['tool', 'script', 'guard', 'subagent', 'skill', 'route'],
    D9_out_of_scope: ['route', 'skill', 'subagent', 'instruction'],
  },
};

/** Values that also act on the routes that dispatch a helper. */
const HELPER_ROUTES: Readonly<Record<string, readonly string[]>> = {
  estate_hazard: ['dead_helper'],
  session_state: ['helpers_running'],
};

/** Whether a situation value can act on an atom. */
export function actsOn(dimension: string, value: string, atom: Pick<Atom, 'kind' | 'fields'>): boolean {
  const kinds = ACTS_ON[dimension]?.[value];
  if (!kinds || kinds.includes(atom.kind)) return true;
  return (
    atom.kind === 'route' &&
    atom.fields?.targetKind === 'subagent' &&
    (HELPER_ROUTES[dimension] ?? []).includes(value)
  );
}
