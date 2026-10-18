import { compileSpace, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { enumerateCells, MAX_POOL, selectBudget, slicedLhs } from '../../src/seed/budget';
import { Feasibility } from '../../src/seed/feasible';
import { range, rngFor, shuffle } from '../../src/seed/random';

/** A map of category dimensions with the given sizes and constraints. */
function fixture(sizes: number[], constraints: SpaceMap['constraints'] = []): SpaceMap {
  return {
    version: '1',
    agent: 'test',
    dimensions: sizes.map((size, index) => ({
      id: `d${index}`,
      title: `d${index}`,
      kind: 'persona' as const,
      values: Array.from({ length: size }, (_, value) => ({ id: `d${index}v${value}`, title: 'v' })),
    })),
    constraints,
    prior: { kind: 'declared' },
  };
}

/** Three category dimensions and two constraints: the fixture of the budget tests. */
const SIZES = [4, 3, 2];
const CONSTRAINTS: SpaceMap['constraints'] = [
  { forbid: { d0: 'd0v0', d1: 'd1v1' }, reason: 'r' },
  { forbid: { d1: 'd1v0', d2: 'd2v1' }, reason: 'r' },
];

function setup(sizes = SIZES, constraints = CONSTRAINTS) {
  const feasibility = new Feasibility(compileSpace(fixture(sizes, constraints)));
  const pool = enumerateCells(sizes, (cell) =>
    feasibility.allowed(cell.map((value, dimension) => [dimension, value] as const)),
  );
  return { feasibility, pool };
}

/** Every allowed pair of the pool, by brute force: dimension pair, then value pair. */
function allowedPairs(pool: number[][]): Set<string> {
  const out = new Set<string>();
  for (const row of pool)
    for (let i = 0; i < row.length; i += 1)
      for (let j = i + 1; j < row.length; j += 1) out.add(`${i}=${row[i]},${j}=${row[j]}`);
  return out;
}

/** The pairs a set of picked rows covers. */
function coveredBy(rows: number[][]): Set<string> {
  return allowedPairs(rows);
}

describe('enumerateCells', () => {
  it('lists the allowed cells only, and no forbidden one', () => {
    const { feasibility, pool } = setup();
    // 24 cells: the first constraint forbids d0=0 with d1=1 (2 cells), the second d1=0 with d2=1 (4 cells).
    expect(pool.length).toBe(18);
    for (const cell of pool)
      expect(feasibility.allowed(cell.map((value, d) => [d, value] as const))).toBe(true);
  });

  it('refuses a grid over the pool limit', () => {
    expect(() => enumerateCells([1000, 1000, 1000, 10], () => true)).toThrow(RangeError);
    expect(MAX_POOL).toBeGreaterThan(0);
  });
});

describe('selectBudget: pair coverage', () => {
  it.each([14, 15])('chooses coverage, balance and seeded order at every step for budget %i', (budget) => {
    const { pool } = setup();
    const selection = selectBudget(pool, SIZES, budget, rngFor(9, 'budget'));
    const order = shuffle(rngFor(9, 'budget'), range(pool.length));
    const taken = new Set<number>();
    const covered = new Set<string>();
    const counts = SIZES.map((size) => Array.from({ length: size }, () => 0));
    let balancedAfterCover = false;
    for (const picked of selection.picked) {
      const candidates = order
        .filter((index) => !taken.has(index))
        .map((index) => {
          const row = pool[index] as number[];
          return {
            index,
            gain: [...allowedPairs([row])].filter((pair) => !covered.has(pair)).length,
            // Squared distance to the fair share decreases most for the least-used values.
            balance: row.reduce((sum, value, dimension) => sum - (counts[dimension]?.[value] ?? 0), 0),
          };
        });
      candidates.sort((a, b) => b.gain - a.gain || b.balance - a.balance);
      expect(picked).toBe(candidates[0]?.index);
      if (covered.size === allowedPairs(pool).size) balancedAfterCover = true;
      const row = pool[picked] as number[];
      for (const pair of allowedPairs([row])) covered.add(pair);
      row.forEach((value, dimension) => {
        const column = counts[dimension] as number[];
        column[value] = (column[value] ?? 0) + 1;
      });
      taken.add(picked);
    }
    expect(balancedAfterCover).toBe(true);
  });

  it('covers every allowed pair when the budget is above the pair-cover size', () => {
    const { pool } = setup([4, 3, 5], []);
    const selection = selectBudget(pool, [4, 3, 5], 40, rngFor(1, 'budget'));
    const rows = selection.picked.map((index) => pool[index] as number[]);
    const all = allowedPairs(pool);
    expect(selection.pairs.allowed).toBe(all.size);
    expect(selection.pairs.covered).toBe(all.size);
    expect(coveredBy(rows)).toEqual(all);
  });

  it('covers at least one new pair per test below the cover size, and no pick covers fewer than the best one could', () => {
    const { pool } = setup([4, 3, 5], []);
    const selection = selectBudget(pool, [4, 3, 5], 3, rngFor(1, 'budget'));
    const rows = selection.picked.map((index) => pool[index] as number[]);
    // Each pick adds a new pair while one is uncovered: the greedy floor is one new pair per test.
    expect(selection.pairs.covered).toBeGreaterThanOrEqual(3);
    // The first pick covers the most pairs of any cell: every pair of a full grid cell, C(3,2) = 3.
    expect(coveredBy([rows[0] as number[]]).size).toBe(3);
    expect(selection.pairs.covered).toBe(coveredBy(rows).size);
  });

  it('never picks a forbidden cell', () => {
    const { feasibility, pool } = setup();
    const selection = selectBudget(pool, SIZES, 10, rngFor(4, 'budget'));
    for (const index of selection.picked) {
      const row = pool[index] as number[];
      expect(feasibility.allowed(row.map((value, d) => [d, value] as const))).toBe(true);
    }
  });
});

describe('selectBudget: balance', () => {
  it('keeps every value within one test of its fair share when N is a multiple of every value count', () => {
    // 4, 3 and 2 values: N = 12 is a multiple of each.
    const { pool } = setup();
    const selection = selectBudget(pool, SIZES, 12, rngFor(1, 'budget'));
    expect(selection.picked).toHaveLength(12);
    SIZES.forEach((_, dimension) => {
      const present = new Set(pool.map((row) => row[dimension] ?? -1));
      const fair = 12 / present.size;
      for (const value of present) {
        const count = selection.counts[dimension]?.[value] ?? 0;
        expect(Math.abs(count - fair)).toBeLessThanOrEqual(1);
      }
    });
  });

  it('spreads the tests evenly once every pair is covered', () => {
    const { pool } = setup([4, 3, 5], []);
    const selection = selectBudget(pool, [4, 3, 5], 60, rngFor(2, 'budget'));
    expect(selection.picked).toHaveLength(60);
    expect(selection.counts[0]?.every((count) => count === 15)).toBe(true);
    expect(selection.counts[1]?.every((count) => count === 20)).toBe(true);
    expect(selection.counts[2]?.every((count) => count === 12)).toBe(true);
  });
});

describe('selectBudget: determinism', () => {
  it('reuses categorical cells only when numeric sampling requests slices', () => {
    const pool = [[0], [1]];
    expect(selectBudget(pool, [2], 12, rngFor(1, 'budget')).picked).toHaveLength(2);
    const repeated = selectBudget(pool, [2], 12, rngFor(1, 'budget'), true);
    expect(repeated.picked).toHaveLength(12);
    expect(repeated.counts).toEqual([[6, 6]]);
    expect(() => selectBudget(pool, [2], MAX_POOL + 1, rngFor(1, 'budget'), true)).toThrow(RangeError);
  });
  it('caps at the pool without duplicates and counts only values present in allowed cells', () => {
    const pool = [
      [0, 0],
      [0, 2],
      [1, 2],
    ];
    const selection = selectBudget(pool, [2, 3], 100, rngFor(1, 'budget'));
    expect(selection.picked).toHaveLength(3);
    expect(new Set(selection.picked).size).toBe(3);
    expect(selection.allowedValues).toEqual([2, 2]);
    expect(selection.counts).toEqual([
      [2, 1],
      [1, 0, 2],
    ]);
    expect(selection.pairs).toEqual({ allowed: 3, covered: 3 });
  });

  it('returns no picks or coverage for an empty allowed pool', () => {
    const selection = selectBudget([], [2, 3], 5, rngFor(1, 'budget'));
    expect(selection.picked).toEqual([]);
    expect(selection.pairs).toEqual({ allowed: 0, covered: 0 });
    expect(selection.allowedValues).toEqual([0, 0]);
  });

  it('gives the same picks for the same seed, and may differ for another seed', () => {
    const { pool } = setup();
    const first = selectBudget(pool, SIZES, 8, rngFor(7, 'budget'));
    const again = selectBudget(pool, SIZES, 8, rngFor(7, 'budget'));
    expect(again.picked).toEqual(first.picked);
    const other = selectBudget(pool, SIZES, 8, rngFor(8, 'budget'));
    expect(other.pairs.allowed).toBe(first.pairs.allowed);
    expect(other.picked).not.toEqual(first.picked);
  });
});

describe('slicedLhs', () => {
  it.each([
    [2, 3],
    [1, 3, 7],
    [3, 4, 5],
    [1, 1, 1],
  ])('handles unequal slice sizes %j', (...sizes) => {
    const slices = sizes.flatMap((size, index) => Array.from({ length: size }, () => String(index)));
    const n = slices.length;
    for (const rng of [rngFor(1, 'numeric'), () => 0, () => 1 - Number.EPSILON]) {
      const values = slicedLhs(rng, 0, 1, n, slices);
      expect(values.map((value) => Math.floor(value * n)).sort((a, b) => a - b)).toEqual(range(n));
      sizes.forEach((size, index) => {
        const own = values.filter((_, row) => slices[row] === String(index));
        expect(own.map((value) => Math.floor(value * size)).sort((a, b) => a - b)).toEqual(range(size));
      });
    }
  });

  it('refuses a missing slice label and non-finite ranges before drawing', () => {
    expect(() => slicedLhs(rngFor(1, 'numeric'), 0, 1, 2, ['a'])).toThrow(RangeError);
    expect(() => slicedLhs(rngFor(1, 'numeric'), 0, Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
    expect(() => slicedLhs(rngFor(1, 'numeric'), 0, 1, MAX_POOL + 1, [])).toThrow(RangeError);
  });
  it('covers bands globally and inside each categorical slice instead of clumping within a slice', () => {
    const slices = [...Array.from({ length: 6 }, () => 'a'), ...Array.from({ length: 6 }, () => 'b')];
    const draw = slicedLhs(rngFor(7, 'numeric'), 0, 1, 12, slices);
    expect(draw.map((value) => Math.floor(value * 12)).sort((a, b) => a - b)).toEqual(range(12));
    for (const slice of ['a', 'b']) {
      const bands = draw.filter((_, index) => slices[index] === slice).map((value) => Math.floor(value * 6));
      expect(bands.sort((a, b) => a - b)).toEqual(range(6));
    }
  });

  it('draws one value per band, so the values spread between the boundaries', () => {
    const values = slicedLhs(rngFor(3, 'numeric'), 0, 10, 5);
    expect(values).toHaveLength(5);
    const bands = values.map((value) => Math.floor(value / 2)).sort((a, b) => a - b);
    expect(bands).toEqual([0, 1, 2, 3, 4]);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it('gives the same draw for the same seed', () => {
    expect(slicedLhs(rngFor(3, 'numeric'), 0, 1, 4)).toEqual(slicedLhs(rngFor(3, 'numeric'), 0, 1, 4));
  });

  it('refuses a band count below one', () => {
    expect(() => slicedLhs(rngFor(1, 'numeric'), 0, 1, 0)).toThrow(RangeError);
  });
});
