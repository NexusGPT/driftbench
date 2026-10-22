import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pointer } from '@agent-nexus/driftbench-estate';
import {
  type EstateName,
  estateFolder,
  GOLD_SET_NAME,
  GOLD_SET_YAML,
} from '../../../estate/test/gold/gold';

/**
 * The numbers of a gold estate come from a recorded labeller. A second label set, `limits`, sits beside the set of
 * the gold labels. A model reads each window and marks the units that state a number limiting another unit; each
 * marking is a structured answer (the number, how a quantity is compared with it, what it counts, the unit it
 * limits). The answers are recorded once (`record-limits.ts`) and replayed in the chain with no model call. The
 * gold labels stay planted: they are the labels the limits are measured next to, not the thing under test.
 */
export const LIMITS_SET_NAME = 'limits';

export const LIMITS_SET_YAML = `  - set: ${LIMITS_SET_NAME}
    description: The numbers that limit the instructions of an agent.
    links:
      - name: limit
        description: The number a unit states, and how a quantity is compared with it for the limited unit to hold. Give value as a JSON number, to as the comparison, and unit as what the number counts when the unit says so.
        values: [lt, le, gt, ge]
        number: true
    labels:
      - name: bound
        description: A unit that states a number (a count, a duration, a size or a threshold) which limits when or how another unit applies. Give the unit of the instruction the number limits as the target. A unit that only mentions a number without limiting an instruction is none.
        target: required
        condition: true
        links: [limit]
`;

/** The label sets of the chain: the gold labels and the limits. */
export function chainSets() {
  const text = `${GOLD_SET_YAML}${LIMITS_SET_YAML}`;
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

export const cassettePath = (estate: EstateName): string => join(estateFolder(estate), 'limits.cassette.jsonl');

/** The recorded limits of an estate: the cassette entries of the limits set, and nothing else. */
export async function loadLimitsCassette(estate: EstateName): Promise<pointer.Cassette> {
  const text = await readFile(cassettePath(estate), 'utf8');
  return pointer.Cassette.parse(text);
}

/**
 * One labeler for both sets: the planted gold labeller answers the gold set, the model labeller the limits set. A
 * request of the limits set that the cassette does not hold stops the run with a message that names the fix.
 */
export function composite(planted: pointer.Labeler, model: pointer.Labeler): pointer.Labeler {
  const pick = (set: { set: string }): pointer.Labeler => (set.set === GOLD_SET_NAME ? planted : model);
  return {
    id: 'gold-and-limits',
    cls: 'system2',
    family: 'composite',
    model: model.model,
    settings: {},
    maxUnits: (set, wanted) => pick(set).maxUnits(set, wanted),
    render: (set, window, context) => pick(set).render(set, window, context),
    opinions: (answer, set, window, context) => pick(set).opinions(answer, set, window, context),
    ...(model.ready ? { ready: () => model.ready?.() } : {}),
    async call(wire, set, window, attempt) {
      const labeler = pick(set);
      if (!labeler.call) {
        throw new pointer.LabelerConfigError(
          `no recorded answer for ${window.id} of the set ${set.set}: record the limits again (record-limits.ts)`,
        );
      }
      return labeler.call(wire, set, window, attempt);
    },
  };
}
