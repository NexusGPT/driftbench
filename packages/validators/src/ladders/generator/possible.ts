import type { DeviationClass } from '@agent-nexus/driftbench-core';
import { NONE } from '@agent-nexus/driftbench-space';
import type { HiddenPath, HiddenSpec } from './hidden';

/**
 * The cells of the hidden space a conversation can reach, by the hidden specification's own structure,
 * written apart from the generator so it can judge it. A cell is allowed only when it is possible (the
 * owner's rule for the coverage target: no test for a situation the agent's own map rules out).
 *
 * An event is something said at one position of one path: the move that reaches the stage (any position
 * after the first), or a deviation class said there. A class is said at a position when the flow recovers
 * from it, a phrase of it exists, the first turn carries only a class a first message can carry, a turn
 * after the last stage only a class whose recovery stays, and a tool failure only on a turn that calls a
 * tool the flow recovers from. A cell holding a stage or a class is possible when some event matches it
 * and the path's flow, its branch values and the cell's other values break no constraint; a behaviour
 * belongs to the flows that list it.
 */

/** Classes a first message can carry: they need no earlier turn. */
const FIRST_TURN: ReadonlySet<DeviationClass> = new Set([
  'D1_off_topic',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D9_out_of_scope',
]);

type Cell = Record<string, string>;

function said(spec: HiddenSpec, path: HiddenPath, index: number, cls: DeviationClass): boolean {
  const stage = path.stages[index] as string;
  const last = index === path.stages.length - 1;
  const recoveries = spec.recoveries.filter(
    (entry) => entry.class === cls && entry.flows.includes(path.flow),
  );
  if (recoveries.length === 0) return false;
  if (cls === 'D8_tool_failure') {
    if (last) return false;
    return spec.uses.some(
      (use) =>
        use.flow === path.flow &&
        use.from === stage &&
        recoveries.some((entry) => entry.tool === undefined || entry.tool === use.tool),
    );
  }
  if (!spec.phrases.some((phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === cls))
    return false;
  if (index === 0 && !FIRST_TURN.has(cls)) return false;
  if (last && !recoveries.some((entry) => entry.stageAfter === 'pending' || entry.stageAfter === stage))
    return false;
  return true;
}

/** Pairs of the hidden axes no event can reach, as constraints. */
export function impossiblePairs(spec: HiddenSpec): Array<{ forbid: Cell; reason: string }> {
  const allowed = (cell: Cell) =>
    !spec.constraints.some((constraint) =>
      Object.entries(constraint.forbid).every(([dimension, value]) => cell[dimension] === value),
    );
  const flowOf = (behaviour: string) => spec.flows.filter((flow) => flow.behaviours.includes(behaviour));
  const fits = (path: HiddenPath, cell: Cell): boolean => {
    const behaviour = cell.behaviour;
    if (behaviour !== undefined && !flowOf(behaviour).some((flow) => flow.id === path.flow)) return false;
    const branches = Object.entries(path.when);
    const choose = (at: number, picks: Cell): boolean => {
      if (at === branches.length) return allowed(picks);
      const [dimension, values] = branches[at] as [string, string[]];
      return values.some((value) =>
        picks[dimension] !== undefined && picks[dimension] !== value
          ? false
          : choose(at + 1, { ...picks, [dimension]: value }),
      );
    };
    return choose(0, { ...cell, flow: path.flow });
  };
  const events = spec.paths.flatMap((path) =>
    path.stages.flatMap((stage, index) => [
      ...(index >= 1 ? [{ path, stage, deviation: NONE as string }] : []),
      ...spec.deviations
        .filter((cls) => said(spec, path, index, cls))
        .map((deviation) => ({ path, stage, deviation: deviation as string })),
    ]),
  );
  const possible = (cell: Cell) =>
    events.some(
      (event) =>
        (cell.stage === undefined || cell.stage === event.stage) &&
        (cell.deviation === undefined || cell.deviation === event.deviation) &&
        fits(event.path, { ...cell, stage: event.stage, deviation: event.deviation }),
    );
  const axes: Array<[string, string[]]> = [
    ['behaviour', spec.behaviours.map((behaviour) => behaviour.id)],
    ['deviation', [NONE, ...spec.deviations]],
    ['channel', spec.channels],
    ['stage', spec.stages.map((stage) => stage.id)],
    ['user_type', spec.personas.map((persona) => persona.id)],
  ];
  const out: Array<{ forbid: Cell; reason: string }> = [];
  axes.forEach(([first, firstValues], index) => {
    for (const [second, secondValues] of axes.slice(index + 1)) {
      const structural = [first, second].some((axis) => axis === 'stage' || axis === 'deviation');
      if (!structural) continue;
      for (const x of firstValues)
        for (const y of secondValues) {
          const cell: Cell = { [first]: x, [second]: y };
          if (!allowed(cell)) continue;
          if (cell.stage === undefined && cell.deviation === NONE) continue;
          if (!possible(cell))
            out.push({
              forbid: cell,
              reason: `no path of the hidden map can reach ${first}=${x} with ${second}=${y}`,
            });
        }
    }
  });
  return out;
}
