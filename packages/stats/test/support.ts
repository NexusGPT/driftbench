import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { Alarm, Observation } from '../src/index';

/** Python reference values, written by test/reference/make_fixtures.py. */
export interface Fixtures {
  special: {
    logGamma: { x: number; expected: number }[];
    incompleteBeta: { x: number; a: number; b: number; expected: number }[];
    betaQuantile: { p: number; a: number; b: number; expected: number }[];
    normalQuantile: { p: number; expected: number }[];
    normalCdf: { z: number; expected: number }[];
    chiSquareSf: { x: number; df: number; expected: number }[];
    binomialCdf: { k: number; n: number; p: number; expected: number }[];
  };
  intervals: {
    wilson: { k: number; n: number; z: number; lower: number; upper: number }[];
    clopperPearson: { k: number; n: number; alpha: number; lower: number; upper: number }[];
    zeroFailureBound: { p: number; alpha: number; expected: number }[];
    designEffect: { m: number; rho: number; expected: number }[];
  };
  bootstrap: {
    replay: {
      name: string;
      values: number[];
      clusters: string[] | null;
      iterations: number;
      seed: number;
      alpha: number;
      method: 'percentile' | 'basic';
      estimate: number;
      lower: number;
      upper: number;
    }[];
    independent: {
      values: number[];
      clusters: string[];
      iterations: number;
      alpha: number;
      lower: number;
      upper: number;
      tolerance: number;
      naiveHalfWidth: number;
    };
  };
  reliability: {
    passK: { c: number; n: number; k: number; expected: number }[];
    passAtK: { c: number; n: number; k: number; expected: number }[];
    unreliability: { samples: number[]; expected: number }[];
  };
  mcnemar: { b: number; c: number; method: 'exact' | 'chi-square'; statistic: number; pValue: number }[];
  wilcoxon: { name: string; x: number[]; y: number[]; statistic: number; pValue: number }[];
  paired: {
    pairedRateDifference: {
      bothPass: number;
      regressed: number;
      improved: number;
      bothFail: number;
      alpha: number;
      estimate: number;
      lower: number;
      upper: number;
    }[];
    nonInferiority: {
      name: string;
      baseline: boolean[];
      candidate: boolean[];
      margin: number;
      gatingFlags: { baseline: boolean[]; candidate: boolean[] } | null;
      regressed: number;
      improved: number;
      estimate: number;
      lower: number;
      upper: number;
      nonInferior: boolean;
    }[];
  };
  benjaminiHochberg: { pvalues: number[]; q: number; adjusted: number[]; rejected: boolean[] }[];
  mde: {
    n: number;
    repeats: number;
    baselineRate: number;
    power: number;
    alpha: number;
    rho: number;
    effect: number | null;
    effectiveN: number;
  }[];
  drift: {
    cusum: {
      name: string;
      series: number[];
      options: { target?: number; sd?: number; k?: number; h?: number };
      target: number;
      sd: number;
      upper: number[];
      lower: number[];
      alarms: Alarm[];
    }[];
    pageHinkley: {
      name: string;
      series: number[];
      options: { delta: number; threshold: number; minInstances: number };
      up: number[];
      down: number[];
      alarms: Alarm[];
    }[];
    ksTest: {
      name: string;
      a: number[];
      b: number[];
      statistic: number;
      pValue: number;
      asymptoticPValue: number;
    }[];
  };
  kappa: {
    name: string;
    a: (string | number)[];
    b: (string | number)[];
    weights: 'none' | 'linear' | 'quadratic';
    kappa: number;
  }[];
  krippendorff: {
    name: string;
    matrix: (number | null)[][];
    level: 'nominal' | 'ordinal' | 'interval' | 'ratio';
    alpha: number;
    published?: number;
  }[];
  varianceComponents: {
    name: string;
    balanced: boolean;
    levels?: string[];
    observations: Observation[];
    ss: number[];
    df: number[];
    ms: number[];
    estimates: number[];
  }[];
  neyman: { sizes: number[]; sds: number[]; total: number; exact: number[]; allocated: number[] }[];
  repeatsForFloor: {
    input: {
      flipRate?: number;
      variance?: number;
      floor: number;
      blocks?: number;
      difference?: boolean;
      z?: number;
    };
    repeats: number;
    floor: number;
  }[];
  coverage: {
    name: string;
    counts: number[];
    n: number;
    observed: number;
    f1: number;
    f2: number;
    discoveryProbability: number;
    turingCoverage: number;
    coverage: number;
    chao1: number;
    q0: number;
    q1: number;
    q2: number;
    q3: number;
  }[];
}

export const fixtures: Fixtures = JSON.parse(
  readFileSync(new URL('./reference/fixtures.json', import.meta.url), 'utf8'),
) as Fixtures;

/** The tolerance every Python reference value is matched to. */
export const TOLERANCE = 1e-6;

/** Asserts |actual - expected| <= tolerance, with a message naming the case. */
export function near(actual: number, expected: number, what: string, tolerance = TOLERANCE): void {
  const diff = Math.abs(actual - expected);
  expect(
    diff <= tolerance,
    `${what}: got ${actual}, expected ${expected} (diff ${diff}, tolerance ${tolerance})`,
  ).toBe(true);
}

export function nearAll(
  actual: readonly number[],
  expected: readonly number[],
  what: string,
  tolerance = TOLERANCE,
): void {
  expect(actual.length, `${what}: length`).toBe(expected.length);
  actual.forEach((v, i) => {
    near(v, expected[i] as number, `${what}[${i}]`, tolerance);
  });
}
