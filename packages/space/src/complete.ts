import {
  type InvalidSpec,
  type LoadedSpec,
  type LoadResult,
  error as specError,
} from '@agent-nexus/driftbench-core';
import { addEventCodes } from './coverage';
import {
  chaoCoverage,
  goodTuringDiscovery,
  type HillNumbers,
  hillNumbers,
  quantile,
  seededRandom,
} from './estimators';
import { assertGridSize, combinations, compileSpace, projectGrid, resolveT } from './grid';
import { placeSpec } from './place';
import type { SpaceMap } from './schema';

/** A point estimate and its percentile bootstrap interval. */
export type Interval = { estimate: number; lower: number; upper: number };

export type Completeness = {
  t: number;
  /** True when t is the number of dimensions: the classes are the cells of the full grid. */
  full: boolean;
  /** The interaction classes: the allowed cells at strength t. */
  cells: number;
  /** n: the valid specs that fall in at least one allowed cell, each one conversation. */
  conversations: number;
  /** Valid specs that fall in no allowed cell. They are left out of n. */
  unplaced: string[];
  /** Cells shown by at least one conversation. */
  seen: number;
  /** Cells shown by exactly one conversation, and by exactly two. */
  f1: number;
  f2: number;
  /** Hill numbers over the cells seen, weighted by how many conversations show each cell. */
  hill: HillNumbers;
  /** True when there are at least as many conversations as cells: only then are the estimates given. */
  printable: boolean;
  /** Why the estimates are not given, when they are not. */
  reason?: string;
  /** Sample coverage in the Chao form, with its interval. */
  coverage?: Interval;
  /** Good-Turing discovery probability f1 / n, with its interval. */
  discovery?: Interval;
  /** The plain-words line for the report. */
  sentence?: string;
  bootstrap?: { iterations: number; seed: number; level: number };
  invalidSpecs: InvalidSpec[];
};

export type CompletenessOptions = {
  /** The strength of the classes: cells on every subset of t dimensions. Defaults to the full grid. */
  t?: number;
  /** Bootstrap resamples. Default 2000. */
  iterations?: number;
  /** Seed of the resampling. Default 1: the same input gives the same interval. */
  seed?: number;
  /** Confidence level of the interval. Default 0.95. */
  level?: number;
  /** The largest full grid to enumerate. */
  maxCells?: number;
};

/** The assumption every completeness figure rests on, printed with it. */
export const COMPLETENESS_ASSUMPTION =
  'The figures assume independent conversations from a generator that does not learn from results; a generator that steers toward unseen cells makes them optimistic.';

/**
 * The completeness line of a fixed sample of conversations: how many interaction classes (cells) appeared,
 * and how likely the next conversation is to show a new one. Each valid spec is one conversation; the cells
 * it shows are the allowed cells it covers at strength t (see `placeSpec`), so one conversation can show
 * several cells (the Bernoulli product model of STADS, S2, section 7).
 *
 * - f1, f2: cells shown by exactly one and exactly two conversations; n: conversations.
 * - Discovery probability f1 / n (Good-Turing; see `goodTuringDiscovery`).
 * - Sample coverage in the Chao form (see `chaoCoverage`).
 * - Intervals: a percentile bootstrap that resamples whole conversations with replacement, the unit every
 *   interval of driftbench uses (docs/concepts/statistics.md), seeded so a rerun gives the same interval.
 * - Hill numbers at q = 0, 1 and 2 over the cells seen (see `hillNumbers`).
 *
 * The estimates are given only when there are at least as many conversations as cells: below that, how
 * much is unseen cannot be estimated from the counts (Lee and Bohme 2024, S39). They assume independent
 * conversations drawn by a generator that does not learn (S2, sections 6.5.3 and 9.5; S42); run it on a
 * fixed sample drawn before any result was read, never on an adaptive one. Throws a RangeError when t is
 * out of range or the full grid is over the limit.
 */
export function completeness(
  map: SpaceMap,
  specs: readonly LoadResult[],
  options: CompletenessOptions = {},
): Completeness {
  const space = compileSpace(map);
  const k = space.dimensions.length;
  const t = resolveT(space, options.t);
  assertGridSize(map, options.maxCells);
  const iterations = options.iterations ?? 2000;
  const seed = options.seed ?? 1;
  const level = options.level ?? 0.95;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('iterations must be a whole number of at least 1');
  }
  if (!(level > 0 && level < 1)) throw new RangeError('level must lie strictly between 0 and 1');

  const { projections } = projectGrid(space, combinations(k, t));
  // Every allowed tuple of every subset gets one class number.
  let cells = 0;
  const classOf = projections.map((projection) => {
    const numbers = new Int32Array(projection.size).fill(-1);
    projection.allowed.forEach((allowed, code) => {
      if (allowed) {
        numbers[code] = cells;
        cells += 1;
      }
    });
    return numbers;
  });

  const loaded = specs.filter((result): result is LoadedSpec => result.ok);
  const units: number[][] = [];
  const unplaced: string[] = [];
  for (const result of loaded) {
    const placement = placeSpec(space, result.spec);
    const shown = new Set<number>();
    projections.forEach((projection, position) => {
      const codes = new Set<number>();
      for (const event of placement.events) addEventCodes(projection, event, codes);
      for (const code of codes) {
        const number = classOf[position]?.[code] ?? -1;
        if (number >= 0) shown.add(number);
      }
    });
    if (shown.size === 0) unplaced.push(placement.id);
    else units.push([...shown]);
  }

  const n = units.length;
  const counts = incidence(units, cells);
  const { seen, f1, f2 } = frequencies(counts);
  const base: Completeness = {
    t,
    full: t === k,
    cells,
    conversations: n,
    unplaced,
    seen,
    f1,
    f2,
    hill: hillNumbers(counts),
    printable: false,
    invalidSpecs: specs.flatMap((result): InvalidSpec[] =>
      result.ok
        ? []
        : [
            {
              path: result.path,
              error: result.errors[0] ?? specError('SPEC_PARSE', '', 'the spec is invalid'),
            },
          ],
    ),
  };
  if (n === 0 || n < cells) {
    return {
      ...base,
      reason:
        n === 0
          ? 'no conversation falls in an allowed cell'
          : `the estimate needs at least as many conversations as cells, and there are ${n} for ${cells}`,
    };
  }

  const coverageEstimate = chaoCoverage(f1, f2, n);
  const discoveryEstimate = goodTuringDiscovery(f1, n);
  const random = seededRandom(seed);
  const coverages: number[] = [];
  const discoveries: number[] = [];
  const draw: number[][] = Array.from({ length: n }, () => []);
  for (let round = 0; round < iterations; round += 1) {
    for (let slot = 0; slot < n; slot += 1) draw[slot] = units[Math.floor(random() * n)] ?? [];
    const resampled = frequencies(incidence(draw, cells));
    coverages.push(chaoCoverage(resampled.f1, resampled.f2, n));
    discoveries.push(goodTuringDiscovery(resampled.f1, n));
  }
  const tail = (1 - level) / 2;
  const interval = (estimate: number, values: number[]): Interval => {
    const sorted = [...values].sort((a, b) => a - b);
    return { estimate, lower: quantile(sorted, tail), upper: quantile(sorted, 1 - tail) };
  };
  return {
    ...base,
    printable: true,
    coverage: interval(coverageEstimate, coverages),
    discovery: interval(discoveryEstimate, discoveries),
    sentence: `About ${aboutPercent(coverageEstimate)} percent of the interaction classes have appeared; the chance that the next conversation shows a new one is about ${aboutPercent(discoveryEstimate)} percent.`,
    bootstrap: { iterations, seed, level },
  };
}

/** How many conversations show each cell. */
function incidence(units: readonly (readonly number[])[], cells: number): Int32Array {
  const counts = new Int32Array(cells);
  for (const unit of units) {
    for (const cell of unit) counts[cell] = (counts[cell] ?? 0) + 1;
  }
  return counts;
}

function frequencies(counts: Int32Array): { seen: number; f1: number; f2: number } {
  let seen = 0;
  let f1 = 0;
  let f2 = 0;
  for (const count of counts) {
    if (count > 0) seen += 1;
    if (count === 1) f1 += 1;
    if (count === 2) f2 += 1;
  }
  return { seen, f1, f2 };
}

/**
 * A share as a whole percent for the sentence. A share strictly between 0 and 1 never prints as 0 or 100:
 * it keeps one decimal, rounded toward the middle, so the sentence never claims what the data do not show.
 */
export function aboutPercent(share: number): string {
  const percent = share * 100;
  if (percent <= 0) return '0';
  if (percent >= 100) return '100';
  const whole = Math.round(percent);
  if (whole > 0 && whole < 100) return String(whole);
  return String(percent < 50 ? Math.ceil(percent * 10) / 10 : Math.floor(percent * 10) / 10);
}
