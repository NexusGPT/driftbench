import { exactPaired } from './paired';

// Student t inverse CDF at 0.975 with 29 degrees of freedom. All trials have 30 seeds.
const T29 = 2.045229642132703;

export function spread(values: readonly number[]) {
  if (values.length !== 30 || values.some((value) => !Number.isFinite(value)))
    throw new RangeError('summaries require 30 finite observations');
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  const margin = (T29 * sd) / Math.sqrt(values.length);
  return {
    n: values.length,
    mean,
    sampleStandardDeviation: sd,
    min: Math.min(...values),
    max: Math.max(...values),
    meanCI95: [mean - margin, mean + margin],
  };
}

export function paired(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) throw new RangeError('unpaired observations');
  return {
    ...exactPaired(left, right),
    differenceSummary: spread(left.map((value, index) => value - (right[index] as number))),
  };
}

export const analysisPolicy = {
  interval: 'two-sided 95% Student t interval for the seed mean, df=29; assumes independent seed trials',
  pairedTest:
    'exact two-sided within-seed label swaps of the mean difference; integer-sum dynamic programming',
  null: 'exchangeable method labels within each seed pair; independent swaps across pairs',
  multiplicity: 'unadjusted tests; budgets and outcomes are dependent; no generalisation claim',
};
