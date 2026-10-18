import type { SpaceMap } from '@agent-nexus/driftbench-space';
import type { Atom, EstateMap } from '../schema';

/**
 * Which atoms a situation value can act on. The default plan crosses an event value (a value of the axes
 * `session_state`, `owner_signal`, `deviation` and `estate_hazard` other than the first of its axis) only with
 * the atoms it can act on, and says which: the kinds of the atoms, and for a helper event the routes the map
 * links to a helper. No word of an atom, an id or a path is read. The table is keyed by dimension and value id,
 * the ids of the axes of `estate map` (map/space.ts); a value it does not name is unresolved: all its
 * combinations stay in the plan, with a note. A space the user wrote is authoritative and infers nothing: its
 * own constraints say what its values cannot meet.
 */
type Concern = { kinds: readonly Atom['kind'][]; helperRoutes?: true };

const CONCERNS: Readonly<Record<string, Concern>> = {
  'estate_hazard=dead_helper': { kinds: ['subagent'], helperRoutes: true },
  'session_state=helpers_running': { kinds: ['subagent'], helperRoutes: true },
  'estate_hazard=stale_tracker': { kinds: ['stage'] },
  'deviation=D5_language_switch': { kinds: ['register', 'instruction'] },
  'owner_signal=language_switch': { kinds: ['register', 'instruction'] },
  'deviation=D8_tool_failure': { kinds: ['tool', 'script', 'guard', 'subagent', 'skill', 'route'] },
  'deviation=D6_instruction_in_data': { kinds: ['instruction', 'gate', 'guard', 'register'] },
  'deviation=D4_loose_confirmation': { kinds: ['instruction', 'gate', 'guard'] },
  'estate_hazard=rate_wave': { kinds: ['tool', 'script', 'subagent', 'instruction', 'stage'] },
  'estate_hazard=process_restart': { kinds: ['stage', 'subagent', 'instruction', 'gate'] },
  'estate_hazard=compaction_mid_task': {
    kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  },
  'session_state=after_compaction': {
    kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  },
  'session_state=after_restart': { kinds: ['stage', 'subagent', 'instruction', 'gate'] },
  'session_state=resumed': { kinds: ['stage', 'instruction', 'gate', 'skill', 'route'] },
  'owner_signal=stop': { kinds: ['instruction', 'stage', 'subagent', 'guard'] },
  'owner_signal=no_questions': { kinds: ['instruction', 'gate', 'register'] },
  'deviation=D2_goal_shift': { kinds: ['route', 'skill', 'stage', 'instruction'] },
  'deviation=D1_off_topic': { kinds: ['route', 'skill', 'instruction', 'register', 'stage'] },
  'deviation=D9_out_of_scope': { kinds: ['route', 'skill', 'subagent', 'instruction'] },
  'deviation=D7_silence_or_burst': { kinds: ['instruction', 'register', 'guard', 'subagent'] },
};

const EVENT_AXES = new Set(['session_state', 'owner_signal', 'deviation', 'estate_hazard']);

/** The ids of the approved atoms a value acts on: by kind, and by the map's links to a helper for a helper event. */
function actedOn(concern: Concern, atoms: readonly Atom[], edges: EstateMap['edges']): Set<string> {
  const helpers = new Set(atoms.filter((atom) => atom.kind === 'subagent').map((atom) => atom.id));
  const linked = new Set(
    edges
      .filter((edge) => (edge.kind === 'route' || edge.kind === 'dispatch') && helpers.has(edge.to))
      .map((edge) => edge.from),
  );
  return new Set(
    atoms
      .filter(
        (atom) =>
          concern.kinds.includes(atom.kind) ||
          (concern.helperRoutes === true &&
            atom.kind === 'route' &&
            (atom.fields?.targetKind === 'subagent' || linked.has(atom.id))),
      )
      .map((atom) => atom.id),
  );
}

export function situationSpace(map: EstateMap, space: SpaceMap): { space: SpaceMap; notes: string[] } {
  const approved = map.atoms.filter((atom) => atom.approved);
  const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
  const constraints = [...space.constraints];
  const notes: string[] = [];
  for (const dimension of space.dimensions) {
    if (!EVENT_AXES.has(dimension.id)) continue;
    for (const [index, value] of dimension.values.entries()) {
      // The first value is the axis's baseline, and long is an unperturbed session as well.
      if (index === 0 || (dimension.id === 'session_state' && value.id === 'long')) continue;
      const concern = CONCERNS[`${dimension.id}=${value.id}`];
      const relevant = concern ? actedOn(concern, approved, map.edges) : new Set<string>();
      const inTargets = targets.flatMap((target) => target.values.filter((atom) => relevant.has(atom.id)));
      if (inTargets.length === 0) {
        notes.push(
          `${dimension.id}=${value.id}: no relevant target is declared for this situation value or none exists in the estate; relevance is unresolved, so the declared combinations are retained.`,
        );
        continue;
      }
      for (const target of targets) {
        for (const atom of target.values) {
          if (relevant.has(atom.id)) continue;
          constraints.push({
            forbid: { [target.id]: atom.id, [dimension.id]: value.id },
            reason: `${value.title} does not act on the kind of ${atom.id}`,
          });
        }
      }
    }
  }
  return { space: { ...space, constraints }, notes };
}
