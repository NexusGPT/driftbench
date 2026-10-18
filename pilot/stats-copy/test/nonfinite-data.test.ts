import { describe, expect, it } from 'vitest';
import {
  bootstrapCI,
  cusum,
  ksTest,
  mean,
  pageHinkley,
  quantile,
  quantileSorted,
  sampleVariance,
  unreliability,
  wilcoxonSignedRank,
} from '../src/index';

// A NaN or an infinite value in a data array is rejected with a RangeError that names the function and the argument.
const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const data = (x: number): number[] => [0.4, 0.2, x, 0.7, 0.1, 0.6];

const cases: [string, (x: number) => unknown, RegExp][] = [
  ['mean', (x) => mean(data(x)), /^mean: values/],
  ['quantile', (x) => quantile(data(x), 0.5), /^quantile: values/],
  ['quantileSorted', (x) => quantileSorted(data(x), 0.9), /^quantileSorted: sorted/],
  ['sampleVariance', (x) => sampleVariance(data(x)), /^sampleVariance: values/],
  ['unreliability', (x) => unreliability(data(x)), /^unreliability: samples/],
  ['bootstrapCI', (x) => bootstrapCI(data(x), { iterations: 20 }), /^bootstrapCI: values/],
  ['cusum', (x) => cusum(data(x), { sd: 1 }), /^cusum: series/],
  ['pageHinkley', (x) => pageHinkley(data(x)), /^pageHinkley: series/],
  ['ksTest a', (x) => ksTest(data(x), [0.3, 0.5]), /^ksTest: a or b/],
  ['ksTest b', (x) => ksTest([0.3, 0.5], data(x)), /^ksTest: a or b/],
  ['wilcoxonSignedRank x', (x) => wilcoxonSignedRank(data(x), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), /^wilcoxonSignedRank: x or y/],
  ['wilcoxonSignedRank y', (x) => wilcoxonSignedRank([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], data(x)), /^wilcoxonSignedRank: x or y/],
];

describe('non-finite data', () => {
  for (const [name, call, message] of cases) {
    for (const x of bad) {
      it(`${name} rejects ${x}`, () => {
        expect(() => call(x)).toThrowError(RangeError);
        expect(() => call(x)).toThrowError(message);
      });
    }
  }
});
