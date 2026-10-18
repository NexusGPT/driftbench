import type { RunResult } from '@agent-nexus/driftbench-core';
import { parseRepeatReducer, type RepeatReducer, reduceRepeats } from '@agent-nexus/driftbench-stats';
import { type CampaignData, lineKey } from './data';

/**
 * One criterion over the repeats of one line, reduced by the criterion's own repeat reducer.
 *
 * A run's outcome for the criterion folds its blocks: any fail makes the run a fail, every block passing makes it
 * a pass, and anything else (an inconclusive verdict, or no block judged it) leaves the run undecided.
 */
export type CriterionRepeat = {
  specId: string;
  specHash: string;
  target: RunResult['target'];
  mode: RunResult['mode'];
  perturbationId?: string;
  criterion: string;
  /** The reducer as the criterion spells it: mode, median or at_least:<k>. */
  reducer: string;
  /** One entry per repeat, in repeat order: 1 pass, 0 fail, undefined undecided. */
  outcomes: (0 | 1 | undefined)[];
  /** The reduced verdict of the repeats: 1 pass, 0 fail, undefined undecided. */
  verdict: 0 | 1 | undefined;
};

/** A reducer as the criterion spells it. */
export function reducerSpelling(reducer: RepeatReducer): string {
  return reducer.kind === 'at_least' ? `at_least:${reducer.k}` : reducer.kind;
}

/** The criterion's outcome in one run: 1, 0 or undefined. */
export function runOutcome(run: RunResult, criterion: string): 0 | 1 | undefined {
  const outcomes = run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.kind === 'judge' && verdict.name === criterion)
      .map((v) => v.outcome),
  );
  if (outcomes.length === 0) return undefined;
  if (outcomes.includes('fail')) return 0;
  if (outcomes.every((outcome) => outcome === 'pass')) return 1;
  return undefined;
}

/** The repeat reducers of every spec in the campaign, by spec hash. A criterion without one is not listed. */
export function repeatReducersOf(data: CampaignData): Map<string, Map<string, RepeatReducer>> {
  const bySpec = new Map<string, Map<string, RepeatReducer>>();
  for (const loaded of data.specs.values()) {
    const reducers = new Map<string, RepeatReducer>();
    for (const criterion of loaded.spec.criteria ?? []) {
      if (criterion.repeat_reducer !== undefined)
        reducers.set(criterion.name, parseRepeatReducer(criterion.repeat_reducer));
    }
    if (reducers.size > 0) bySpec.set(loaded.hash, reducers);
  }
  return bySpec;
}

/**
 * Reduces every criterion that has a repeat reducer, over every line of runs. The reducers come per spec hash, so
 * a criterion of one spec is never applied to another spec's runs.
 */
export function criterionRepeats(
  runs: readonly RunResult[],
  reducersBySpec: ReadonlyMap<string, ReadonlyMap<string, RepeatReducer>>,
): CriterionRepeat[] {
  const lines = new Map<string, RunResult[]>();
  for (const run of runs) {
    const key = lineKey(run);
    const list = lines.get(key) ?? [];
    list.push(run);
    lines.set(key, list);
  }
  const result: CriterionRepeat[] = [];
  for (const lineRuns of lines.values()) {
    const ordered = [...lineRuns].sort((a, b) => a.repeat - b.repeat);
    const first = ordered[0];
    if (first === undefined) continue;
    const reducers = reducersBySpec.get(first.specHash);
    if (reducers === undefined) continue;
    for (const [criterion, reducer] of reducers) {
      const outcomes = ordered.map((run) => runOutcome(run, criterion));
      result.push({
        specId: first.specId,
        specHash: first.specHash,
        target: first.target,
        mode: first.mode,
        ...(first.perturbationId === undefined ? {} : { perturbationId: first.perturbationId }),
        criterion,
        reducer: reducerSpelling(reducer),
        outcomes,
        verdict: reduceRepeats(outcomes, reducer),
      });
    }
  }
  return result;
}
