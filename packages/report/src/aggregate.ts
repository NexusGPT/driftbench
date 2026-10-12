import type { CampaignData } from './data';
import { runPassed } from './data';

/**
 * A criterion scored over a whole campaign: one number from every run together, compared with a
 * threshold. It is not a block check and not a per-run verdict. A campaign with no runs is
 * inconclusive (value and passed are undefined), never a failure.
 */
export type AggregateCriterion = {
  name: string;
  /** `at-least`: passes when value >= threshold. `at-most`: passes when value <= threshold. */
  direction: 'at-least' | 'at-most';
  threshold: number;
  measure: (data: CampaignData) => number | undefined;
};

export type AggregateResult = {
  name: string;
  direction: 'at-least' | 'at-most';
  threshold: number;
  value: number | undefined;
  passed: boolean | undefined;
  reason: string;
};

/** Scores each criterion over the campaign. Returns one result per criterion, in the order given. */
export function evaluateAggregates(
  data: CampaignData,
  criteria: readonly AggregateCriterion[],
): AggregateResult[] {
  return criteria.map((criterion) => {
    const value = data.runs.length === 0 ? undefined : criterion.measure(data);
    if (value === undefined) {
      return {
        name: criterion.name,
        direction: criterion.direction,
        threshold: criterion.threshold,
        value: undefined,
        passed: undefined,
        reason: 'no runs in the campaign: inconclusive',
      };
    }
    const passed =
      criterion.direction === 'at-least' ? value >= criterion.threshold : value <= criterion.threshold;
    return {
      name: criterion.name,
      direction: criterion.direction,
      threshold: criterion.threshold,
      value,
      passed,
      reason: `${value} ${criterion.direction === 'at-least' ? '>=' : '<='} ${criterion.threshold}`,
    };
  });
}

export const BUILT_IN_AGGREGATES = {
  /** Share of all runs that pass (completed, every block passing, end state matched). Default threshold 0.5. */
  passRate: (threshold = 0.5): AggregateCriterion => ({
    name: 'pass-rate',
    direction: 'at-least',
    threshold,
    measure: (data) => data.runs.filter((run) => runPassed(run)).length / data.runs.length,
  }),
  /** Share of runs that did not complete (failed or stopped). Passes at or below the threshold. */
  brokenShare: (threshold: number): AggregateCriterion => ({
    name: 'broken-share',
    direction: 'at-most',
    threshold,
    measure: (data) => data.runs.filter((run) => run.status !== 'completed').length / data.runs.length,
  }),
};
