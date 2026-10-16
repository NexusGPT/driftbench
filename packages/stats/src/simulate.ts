/** Coverage of the interval methods on simulated suites of trees: the check that an interval keeps its promise. */

import { assertCount, assertFinite, assertProbability, mulberry32 } from './basics';
import { wilsonEffective } from './effective';
import { hierarchicalBetaBinomial } from './hierarchical';
import { wilson } from './intervals';

/**
 * One simulated setting, the clustered model of Bowyer, Aitchison and Ivanova (2025): every tree g has a pass rate
 * theta_g ~ Beta(d theta, d (1 - theta)) and each of its blocks passes with that rate. A small concentration d
 * means strong agreement inside a tree (the intraclass correlation is 1 / (1 + d)); a very large d is the
 * independent control.
 */
export interface CoverageCell {
  /** Trees in the suite. */
  readonly trees: number;
  /** One size for every tree, or a pool the sizes are drawn from with replacement. */
  readonly sizes: number | readonly number[];
  /** The hyper-mean the intervals try to cover. */
  readonly theta: number;
  readonly d: number;
}

export interface CoverageOptions {
  /** Simulated suites. */
  readonly reps: number;
  /** Seed of the generator. Default 1. The same seed gives the same result. */
  readonly seed?: number;
}

export type CoverageMethod = 'naive wilson' | 'wilson effective z' | 'wilson effective t' | 'hierarchical';

export interface CoverageResult {
  readonly cell: CoverageCell;
  readonly reps: number;
  /** Share of suites whose interval held theta, per method. */
  readonly coverage: Record<CoverageMethod, number>;
  /** Mean interval width, per method. */
  readonly width: Record<CoverageMethod, number>;
}

const METHODS: readonly CoverageMethod[] = [
  'naive wilson',
  'wilson effective z',
  'wilson effective t',
  'hierarchical',
];

/** A standard normal draw (Box-Muller). */
function normal(rng: () => number): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A Gamma(shape, 1) draw (Marsaglia and Tsang 2000; shapes below 1 through Gamma(shape + 1) U^(1 / shape)). */
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const c = shape - 1 / 3;
  const s = 1 / Math.sqrt(9 * c);
  for (;;) {
    const x = normal(rng);
    const v = (1 + s * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + c - c * v + c * Math.log(v)) return c * v;
  }
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  const y = gamma(rng, b);
  return x / (x + y);
}

function binomial(rng: () => number, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i += 1) if (rng() < p) k += 1;
  return k;
}

/**
 * The coverage and width of four 95 percent intervals on simulated suites of one cell: Wilson on all blocks as if
 * independent, Wilson on the effective blocks with the normal and with the Student t quantile, and the
 * hierarchical interval. Coverage near 0.95 is the promise. Deterministic for a seed.
 */
export function simulateCoverage(cell: CoverageCell, options: CoverageOptions): CoverageResult {
  assertCount('simulateCoverage', 'trees', cell.trees);
  assertCount('simulateCoverage', 'reps', options.reps);
  assertProbability('simulateCoverage', 'theta', cell.theta, true);
  assertFinite('simulateCoverage', 'd', cell.d);
  if (!(cell.trees >= 1))
    throw new RangeError(`simulateCoverage: trees must be at least 1, got ${cell.trees}`);
  if (!(options.reps >= 1))
    throw new RangeError(`simulateCoverage: reps must be at least 1, got ${options.reps}`);
  if (!(cell.d > 0)) throw new RangeError(`simulateCoverage: d must be above 0, got ${cell.d}`);
  const pool = typeof cell.sizes === 'number' ? [cell.sizes] : cell.sizes;
  if (pool.length === 0) throw new RangeError('simulateCoverage: sizes must not be empty');
  for (const size of pool) assertCount('simulateCoverage', 'size', size);
  if (pool.some((size) => size < 1)) throw new RangeError('simulateCoverage: every size must be at least 1');
  const rng = mulberry32(options.seed ?? 1);
  const held: Record<CoverageMethod, number> = {
    'naive wilson': 0,
    'wilson effective z': 0,
    'wilson effective t': 0,
    hierarchical: 0,
  };
  const widths = { ...held };
  const tally = (method: CoverageMethod, lower: number, upper: number): void => {
    if (lower <= cell.theta && cell.theta <= upper) held[method] += 1;
    widths[method] += upper - lower;
  };
  for (let rep = 0; rep < options.reps; rep += 1) {
    const trees: { n: number; k: number }[] = [];
    let n = 0;
    let k = 0;
    for (let g = 0; g < cell.trees; g += 1) {
      const size = pool[Math.floor(rng() * pool.length)] as number;
      const rate = beta(rng, cell.d * cell.theta, cell.d * (1 - cell.theta));
      const passed = binomial(rng, size, rate);
      trees.push({ n: size, k: passed });
      n += size;
      k += passed;
    }
    const naive = wilson(k, n);
    tally('naive wilson', naive.lower, naive.upper);
    const z = wilsonEffective(trees, { quantile: 'z' });
    tally('wilson effective z', z.lower, z.upper);
    const t = wilsonEffective(trees, { quantile: 't' });
    tally('wilson effective t', t.lower, t.upper);
    const h = hierarchicalBetaBinomial(trees);
    tally('hierarchical', h.lower, h.upper);
  }
  const coverage = { ...held };
  for (const method of METHODS) {
    coverage[method] = held[method] / options.reps;
    widths[method] /= options.reps;
  }
  return { cell, reps: options.reps, coverage, width: widths };
}
