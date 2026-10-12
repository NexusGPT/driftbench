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

const MEASURES: Record<string, (data: CampaignData) => number | undefined> = {
  'pass-rate': (data) => data.runs.filter((run) => runPassed(run)).length / data.runs.length,
  'broken-share': (data) => data.runs.filter((run) => run.status !== 'completed').length / data.runs.length,
};

/**
 * Reads one `--aggregate` flag: `name:op threshold`, for example `pass-rate:>=0.8`. The operator sets the
 * direction: `>=` is at-least, `<=` is at-most. Throws a message that names the fix.
 */
export function aggregateFromFlag(text: string): AggregateCriterion {
  const match = /^([a-z-]+):(>=|<=)(.+)$/.exec(text);
  if (!match) throw new Error(`--aggregate takes name:op threshold, e.g. pass-rate:>=0.8, not "${text}"`);
  const [, name = '', op = '', raw = ''] = match;
  const measure = MEASURES[name];
  if (!measure) {
    throw new Error(`unknown aggregate ${name}: use ${Object.keys(MEASURES).join(' or ')}`);
  }
  const threshold = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(threshold)) {
    throw new Error(`the threshold of ${name} must be a number, not "${raw}"`);
  }
  return {
    name,
    direction: op === '>=' ? 'at-least' : 'at-most',
    threshold,
    measure,
  };
}
