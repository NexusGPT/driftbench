import type { SpaceMap } from '@agent-nexus/driftbench-space';
import type { EstateMap } from '../schema';

/**
 * Which atoms a situation acts on is not inferred from the words of the estate: no title, quote, situation or
 * description decides it. A supplied space remains the authoritative way to declare relevance; without one, each
 * situation value of an event axis is reported as unresolved and the declared combinations are retained.
 */
const EVENT_AXES = new Set(['session_state', 'owner_signal', 'deviation', 'estate_hazard']);

export function situationSpace(_map: EstateMap, space: SpaceMap): { space: SpaceMap; notes: string[] } {
  const notes: string[] = [];
  for (const dimension of space.dimensions) {
    if (!EVENT_AXES.has(dimension.id)) continue;
    for (const [index, value] of dimension.values.entries()) {
      // The first value is the axis's baseline, and long is an unperturbed session as well.
      if (index === 0 || (dimension.id === 'session_state' && value.id === 'long')) continue;
      notes.push(
        `${dimension.id}=${value.id}: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.`,
      );
    }
  }
  return { space, notes };
}
