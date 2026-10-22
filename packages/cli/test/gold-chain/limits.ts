import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pointer } from '@agent-nexus/driftbench-estate';
import { type EstateName, estateFolder, GOLD_SET_NAME, GOLD_SET_YAML } from '../../../estate/test/gold/gold';

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
        description: The number a unit states, and how a quantity is compared with it for the limited unit to hold. value is the number as a JSON number, to is the comparison, unit is what the number counts when the unit says so. Every unit with a label that lists this kind needs at least one limit link.
        values: [lt, le, gt, ge]
        number: true
    labels:
      - name: bound
        description: A unit that states a number (a count, a duration, a size or a threshold) which limits when or how ANOTHER unit applies. Give the unit of the instruction the number limits as the target. Give each such unit as its own entry, never inside a range, with its limit links. A unit that only mentions a number without limiting an instruction is none.
        target: required
        condition: true
        links: [limit]
      - name: own
        description: A unit that is itself an instruction and states a number that limits it, such as a duration or a count written inside the instruction. Give each such unit as its own entry, never inside a range, with its limit links. A unit that states no such number is none.
        links: [limit]
`;

/** The label sets of the chain: the gold labels and the limits. */
export function chainSets() {
  const text = `${GOLD_SET_YAML}${LIMITS_SET_YAML}`;
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

/** The runs of a window, as the product labels its main sets: a unit takes what more than half of the runs give. */
export const LIMITS_RUNS = 5;
/** The model the gate replays. A comparison recording of another model sits beside it. */
export const DEFAULT_LIMITS_MODEL = 'claude-haiku-5-5';

/** The cassette of an estate for a model: the default model keeps the plain name. */
export const cassettePath = (estate: EstateName, model: string = DEFAULT_LIMITS_MODEL): string =>
  join(
    estateFolder(estate),
    model === DEFAULT_LIMITS_MODEL ? 'limits.cassette.jsonl' : `limits.${model}.cassette.jsonl`,
  );

/** The recorded limits of an estate: the cassette entries of the limits set, and nothing else. */
export async function loadLimitsCassette(
  estate: EstateName,
  model: string = DEFAULT_LIMITS_MODEL,
): Promise<pointer.Cassette> {
  const text = await readFile(cassettePath(estate, model), 'utf8');
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
    runs: model.runs ?? 1,
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

/**
 * The model labeller of the limits set. The default model is asked with thinking off, as the product asks it. Another
 * model (the comparison recording) is asked with the request's thinking field left out, because one of them refuses
 * `disabled`.
 */
export function limitsModelLabeler(model: string, key?: string): pointer.Labeler {
  return pointer.createAnthropicLabeler({
    model,
    runs: LIMITS_RUNS,
    ...(model === DEFAULT_LIMITS_MODEL ? {} : { thinking: 'default' as const }),
    ...(key === undefined ? {} : { key }),
  });
}
