import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  bootstrapCI,
  chaoCoverage,
  clopperPearson,
  cohenKappa,
  designEffect,
  goodTuring,
  hillNumber,
  hillNumbers,
  mcnemar,
  mde,
  nonInferiority,
  pairedRateDifference,
  passAtK,
  passK,
  quantile,
  repeatsForFloor,
  varianceComponents,
  wilcoxonSignedRank,
  wilson,
  zeroFailureBound,
  zFor,
} from '../src/index';

// A guard that rejects a bad argument names the function and the argument it rejects.
const cases: [string, () => unknown, RegExp][] = [
  ['benjaminiHochberg low p', () => benjaminiHochberg([0.01, -0.2]), /^benjaminiHochberg: pvalues/],
  ['benjaminiHochberg high p', () => benjaminiHochberg([0.01, 1.5]), /^benjaminiHochberg: pvalues/],
  ['benjaminiHochberg q zero', () => benjaminiHochberg([0.01, 0.2], 0), /^benjaminiHochberg: q/],
  ['benjaminiHochberg q NaN', () => benjaminiHochberg([0.01, 0.2], Number.NaN), /^benjaminiHochberg: q/],
  ['bootstrapCI alpha', () => bootstrapCI([1, 2, 3], { alpha: 0 }), /^bootstrapCI: alpha/],
  ['bootstrapCI clusters', () => bootstrapCI([1, 2, 3], { clusters: [1, 2] }), /^bootstrapCI: clusters/],
  ['chaoCoverage', () => chaoCoverage([3, -1, 2]), /^chaoCoverage: counts/],
  ['goodTuring', () => goodTuring([3, -2, 2]), /^goodTuring: counts/],
  ['hillNumber', () => hillNumber([4, 2, Number.NaN], 2), /^hillNumber: counts/],
  ['hillNumbers', () => hillNumbers([3, 1.5, 2]), /^hillNumbers: counts/],
  ['clopperPearson alpha', () => clopperPearson(2, 10, 0), /^clopperPearson: alpha/],
  ['clopperPearson n', () => clopperPearson(3, Number.POSITIVE_INFINITY), /^clopperPearson: n/],
  ['wilson k', () => wilson(1.5, 3), /^wilson: k/],
  ['wilson n', () => wilson(3, Number.POSITIVE_INFINITY), /^wilson: n/],
  ['zFor', () => zFor(1), /^zFor: alpha/],
  ['zeroFailureBound', () => zeroFailureBound(1), /^zeroFailureBound: p/],
  ['designEffect m', () => designEffect(0.5, 0.1), /^designEffect: m/],
  ['mcnemar negative', () => mcnemar(-1, 3), /^mcnemar: b/],
  ['mcnemar NaN', () => mcnemar(Number.NaN, 3), /^mcnemar: b/],
  ['passK c', () => passK(Number.NaN, 10, 2), /^passK: c/],
  ['passK c above n', () => passK(5, 3, 1), /^passK: c/],
  ['passAtK k', () => passAtK(2, 5, 6), /^passAtK: k/],
  ['quantile p', () => quantile([1, 2, 3], 1.5), /^quantile: p/],
  ['mde baselineRate', () => mde({ n: 50, baselineRate: 1.2 }), /^mde: baselineRate/],
  ['mde baselineRate NaN', () => mde({ n: 50, baselineRate: Number.NaN }), /^mde: baselineRate/],
  ['mde rho', () => mde({ n: 50, baselineRate: 0.8, rho: 2 }), /^mde: rho/],
  ['mde rho NaN', () => mde({ n: 50, baselineRate: 0.8, rho: Number.NaN }), /^mde: rho/],
  [
    'pairedRateDifference count',
    () => pairedRateDifference({ bothPass: -2, regressed: 1, improved: 2, bothFail: 3 }),
    /^pairedRateDifference: bothPass/,
  ],
  [
    'pairedRateDifference alpha',
    () => pairedRateDifference({ bothPass: 1, regressed: 1, improved: 2, bothFail: 3 }, 1.2),
    /^pairedRateDifference: alpha/,
  ],
  ['cohenKappa length', () => cohenKappa(['a', 'b'], ['a']), /^cohenKappa: a or b/],
  ['wilcoxonSignedRank length', () => wilcoxonSignedRank([1, 2, 3], [1, 2]), /^wilcoxonSignedRank: x or y/],
  [
    'nonInferiority length',
    () => nonInferiority({ baseline: [true, false], candidate: [true], margin: 0.05 }),
    /^nonInferiority: baseline or candidate/,
  ],
  ['repeatsForFloor flipRate', () => repeatsForFloor({ flipRate: 1.5, floor: 0.05 }), /^repeatsForFloor: flipRate/],
  [
    'varianceComponents path',
    () => varianceComponents([{ value: 1, path: ['a', 'b'] }, { value: 0, path: ['a'] }], { levels: ['cell', 'conversation'] }),
    /^varianceComponents: observations/,
  ],
  [
    'varianceComponents value',
    () => varianceComponents([{ value: Number.NaN, path: ['a'] }], { levels: ['cell'] }),
    /^varianceComponents: observations/,
  ],
];

describe('named argument', () => {
  for (const [name, call, message] of cases) {
    it(`${name} throws a RangeError that names the function and the argument`, () => {
      expect(call).toThrowError(RangeError);
      expect(call).toThrowError(message);
    });
  }
});
