import { type CampaignData, runPassed, scoredRuns } from './data';
import { rate } from './estimate';

/**
 * A criterion scored over a whole campaign: one number from every run together, compared with a
 * threshold. It is not a block check and not a per-run verdict. A campaign with no runs is
 * inconclusive (value and passed are undefined), never a failure.
 *
 * A criterion that counts successes gives a Wilson interval of its rate. The interval says whether the
 * threshold is decided. When it is not, `runsNeeded` is the number of runs at the same rate whose interval
 * would decide it.
 */
export type AggregateCriterion = {
  name: string;
  /** `at-least`: passes when value >= threshold. `at-most`: passes when value <= threshold. */
  direction: 'at-least' | 'at-most';
  threshold: number;
  measure: (data: CampaignData) => number | undefined;
  /** The successes and the total, when the criterion is a rate. Gives the interval and the planning number. */
  counts?: (data: CampaignData) => { k: number; n: number };
};

export type AggregateResult = {
  name: string;
  direction: 'at-least' | 'at-most';
  threshold: number;
  value: number | undefined;
  passed: boolean | undefined;
  reason: string;
  /** The Wilson interval of the rate and the runs it stands on. Absent for a criterion with no counts. */
  interval?: { lower: number; upper: number; n: number };
  /** True when the interval is entirely on one side of the threshold. */
  decided?: boolean;
  /** When undecided: the runs at the same rate that would decide it. */
  runsNeeded?: number;
};

const MAX_PLANNED_RUNS = 100_000;

function decides(
  direction: 'at-least' | 'at-most',
  lower: number,
  upper: number,
  threshold: number,
): boolean {
  return direction === 'at-least'
    ? lower >= threshold || upper < threshold
    : upper <= threshold || lower > threshold;
}

/** The smallest run count at the same rate whose Wilson interval decides the threshold. */
function runsNeededAt(
  direction: 'at-least' | 'at-most',
  value: number,
  n: number,
  threshold: number,
): number | undefined {
  for (let candidate = n + 1; candidate <= MAX_PLANNED_RUNS; candidate += 1) {
    const interval = rate(Math.round(value * candidate), candidate);
    if (interval && decides(direction, interval.lower, interval.upper, threshold)) return candidate;
  }
  return undefined;
}

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
    const base = {
      name: criterion.name,
      direction: criterion.direction,
      threshold: criterion.threshold,
      value,
      passed,
      reason: `${value} ${criterion.direction === 'at-least' ? '>=' : '<='} ${criterion.threshold}`,
    };
    if (!criterion.counts) return base;
    const { k, n } = criterion.counts(data);
    const interval = rate(k, n);
    if (!interval) return base;
    const decided = decides(criterion.direction, interval.lower, interval.upper, criterion.threshold);
    const runsNeeded = decided ? undefined : runsNeededAt(criterion.direction, value, n, criterion.threshold);
    return {
      ...base,
      interval: { lower: interval.lower, upper: interval.upper, n },
      decided,
      ...(runsNeeded === undefined ? {} : { runsNeeded }),
    };
  });
}

/** The counts of the built-in criteria: successes and total runs. */
const COUNTS: Record<string, (data: CampaignData) => { k: number; n: number }> = {
  // A run neither passed nor failed (a block not run or blocked) is left out of the rate.
  'pass-rate': (data) => {
    const scored = scoredRuns(data.runs);
    return { k: scored.filter((run) => runPassed(run)).length, n: scored.length };
  },
  'broken-share': (data) => ({
    k: data.runs.filter((run) => run.status !== 'completed').length,
    n: data.runs.length,
  }),
};

function criterionOf(name: string, direction: 'at-least' | 'at-most', threshold: number): AggregateCriterion {
  const counts = COUNTS[name] as (data: CampaignData) => { k: number; n: number };
  return {
    name,
    direction,
    threshold,
    measure: (data) => {
      const { k, n } = counts(data);
      return n === 0 ? undefined : k / n;
    },
    counts,
  };
}

export const BUILT_IN_AGGREGATES = {
  /**
   * Share of the runs that pass (completed, every block passing, end state matched), over the runs that passed
   * or failed: a run with a block not run or blocked, and no failure, is left out. Default threshold 0.5.
   */
  passRate: (threshold = 0.5): AggregateCriterion => criterionOf('pass-rate', 'at-least', threshold),
  /** Share of runs that did not complete (failed or stopped). Passes at or below the threshold. */
  brokenShare: (threshold: number): AggregateCriterion => criterionOf('broken-share', 'at-most', threshold),
};

/**
 * Reads one `--aggregate` flag: `name:op threshold`, for example `pass-rate:>=0.8`. The operator sets the
 * direction: `>=` is at-least, `<=` is at-most. Throws a message that names the fix.
 */
export function aggregateFromFlag(text: string): AggregateCriterion {
  const match = /^([a-z-]+):(>=|<=)(.+)$/.exec(text);
  if (!match) throw new Error(`--aggregate takes name:op threshold, e.g. pass-rate:>=0.8, not "${text}"`);
  const [, name = '', op = '', raw = ''] = match;
  if (!(name in COUNTS)) {
    throw new Error(`unknown aggregate ${name}: use ${Object.keys(COUNTS).join(' or ')}`);
  }
  const threshold = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(threshold)) {
    throw new Error(`the threshold of ${name} must be a number, not "${raw}"`);
  }
  return criterionOf(name, op === '>=' ? 'at-least' : 'at-most', threshold);
}
