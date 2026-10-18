import { describe, expect, it } from 'vitest';
import {
  bootstrapCI,
  chaoCoverage,
  cohenKappa,
  cusum,
  goodTuring,
  hillNumber,
  hillNumbers,
  krippendorffAlpha,
  ksTest,
  mean,
  nonInferiority,
  pageHinkley,
  pairedRateDifference,
  quantile,
  quantileSorted,
  sampleVariance,
  unreliability,
  varianceComponents,
  wilcoxonSignedRank,
} from '../src/index';

// An empty input is rejected with a RangeError whose message begins with the function and the argument.
const cases: [string, () => unknown, RegExp][] = [
  ['mean', () => mean([]), /^mean: values/],
  ['quantile', () => quantile([], 0.5), /^quantile: values/],
  ['quantileSorted', () => quantileSorted([], 0.9), /^quantileSorted: sorted/],
  ['sampleVariance', () => sampleVariance([]), /^sampleVariance: values/],
  ['unreliability', () => unreliability([]), /^unreliability: samples/],
  ['bootstrapCI', () => bootstrapCI([], { iterations: 50 }), /^bootstrapCI: values/],
  ['chaoCoverage', () => chaoCoverage([]), /^chaoCoverage: counts/],
  ['goodTuring', () => goodTuring([]), /^goodTuring: counts/],
  ['hillNumber', () => hillNumber([], 2), /^hillNumber: counts/],
  ['hillNumbers', () => hillNumbers([]), /^hillNumbers: counts/],
  ['cohenKappa', () => cohenKappa([], []), /^cohenKappa: a/],
  ['krippendorffAlpha raters', () => krippendorffAlpha([]), /^krippendorffAlpha: matrix/],
  ['krippendorffAlpha pairable', () => krippendorffAlpha([[], []]), /^krippendorffAlpha: matrix/],
  ['cusum', () => cusum([], { sd: 1 }), /^cusum: series/],
  ['pageHinkley', () => pageHinkley([]), /^pageHinkley: series/],
  ['ksTest a', () => ksTest([], [0.1, 0.25]), /^ksTest: a or b/],
  ['ksTest b', () => ksTest([0.1], []), /^ksTest: a or b/],
  ['wilcoxonSignedRank', () => wilcoxonSignedRank([], []), /^wilcoxonSignedRank: x or y/],
  [
    'pairedRateDifference',
    () => pairedRateDifference({ bothPass: 0, regressed: 0, improved: 0, bothFail: 0 }),
    /^pairedRateDifference: table/,
  ],
  [
    'nonInferiority',
    () => nonInferiority({ baseline: [], candidate: [], margin: 0.05 }),
    /^nonInferiority: baseline/,
  ],
  ['varianceComponents', () => varianceComponents([], { levels: ['cell'] }), /^varianceComponents: observations/],
];

describe('empty input', () => {
  for (const [name, call, message] of cases) {
    it(`${name} throws a RangeError that names the argument`, () => {
      expect(call).toThrowError(RangeError);
      expect(call).toThrowError(message);
    });
  }
});
