import { describe, expect, it } from 'vitest';
import { hierarchicalBetaBinomial, simulateCoverage, wilson, wilsonEffective } from '../src/index';
import reference from './reference/clustered.json';

/** The 143 tree sizes of the Acme parent forest (research/block-parents, H12): 923 blocks, sizes 1 to 47. */
const ACME_TREE_SIZES = [
  ...Array<number>(51).fill(1),
  ...Array<number>(12).fill(2),
  ...Array<number>(7).fill(3),
  ...Array<number>(7).fill(4),
  ...Array<number>(14).fill(5),
  ...Array<number>(13).fill(6),
  ...Array<number>(4).fill(7),
  ...Array<number>(3).fill(8),
  ...Array<number>(4).fill(9),
  ...Array<number>(6).fill(10),
  ...Array<number>(2).fill(11),
  ...Array<number>(2).fill(12),
  ...Array<number>(3).fill(13),
  14,
  16,
  16,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  34,
  41,
  41,
  46,
  47,
];

describe('hierarchicalBetaBinomial', () => {
  it.each(reference.hierarchical)('matches the independent reference on the product grid: $name', (c) => {
    const got = hierarchicalBetaBinomial(c.trees);
    expect(got.treeMean).toBeCloseTo(c.grid.treeMean, 12);
    expect(got.lower).toBeCloseTo(c.grid.lower, 9);
    expect(got.upper).toBeCloseTo(c.grid.upper, 9);
    expect(got.posteriorMean).toBeCloseTo(c.grid.posteriorMean, 9);
  });

  it.each(reference.hierarchical)('stays within one cell of a grid 20 times finer: $name', (c) => {
    const got = hierarchicalBetaBinomial(c.trees);
    expect(Math.abs(got.lower - c.fine.lower)).toBeLessThan(0.015);
    expect(Math.abs(got.upper - c.fine.upper)).toBeLessThan(0.015);
  });

  it('is deterministic and does not depend on the order of the trees', () => {
    const trees = [
      { n: 6, k: 0 },
      { n: 6, k: 3 },
      { n: 6, k: 5 },
      { n: 6, k: 6 },
    ];
    const a = hierarchicalBetaBinomial(trees);
    expect(hierarchicalBetaBinomial(trees)).toEqual(a);
    expect(hierarchicalBetaBinomial([...trees].reverse())).toEqual(a);
  });

  it('keeps the tree mean inside its interval and the interval inside [0, 1]', () => {
    for (const c of reference.hierarchical) {
      const got = hierarchicalBetaBinomial(c.trees);
      expect(got.lower).toBeLessThanOrEqual(got.estimate);
      expect(got.upper).toBeGreaterThanOrEqual(got.estimate);
      expect(got.lower).toBeGreaterThanOrEqual(0);
      expect(got.upper).toBeLessThanOrEqual(1);
    }
  });

  it('is wider when the trees disagree than when they agree at the same mean', () => {
    const agree = hierarchicalBetaBinomial(Array.from({ length: 10 }, () => ({ n: 8, k: 4 })));
    const disagree = hierarchicalBetaBinomial([
      ...Array.from({ length: 5 }, () => ({ n: 8, k: 8 })),
      ...Array.from({ length: 5 }, () => ({ n: 8, k: 0 })),
    ]);
    expect(agree.estimate).toBeCloseTo(disagree.estimate, 12);
    expect(disagree.upper - disagree.lower).toBeGreaterThan(agree.upper - agree.lower);
  });

  it('is wider than a naive Wilson interval when the blocks of a tree move together', () => {
    const trees = [
      ...Array.from({ length: 6 }, () => ({ n: 8, k: 8 })),
      ...Array.from({ length: 6 }, () => ({ n: 8, k: 2 })),
    ];
    const got = hierarchicalBetaBinomial(trees);
    const naive = wilson(
      trees.reduce((s, t) => s + t.k, 0),
      trees.reduce((s, t) => s + t.n, 0),
    );
    expect(got.upper - got.lower).toBeGreaterThan(1.5 * (naive.upper - naive.lower));
  });

  it('narrows as agreeing trees accumulate', () => {
    const width = (g: number) => {
      const r = hierarchicalBetaBinomial(Array.from({ length: g }, () => ({ n: 5, k: 4 })));
      return r.upper - r.lower;
    };
    expect(width(40)).toBeLessThan(width(10));
    expect(width(10)).toBeLessThan(width(2));
  });

  it('honours alpha: a 90 percent interval sits inside the 95 percent one', () => {
    const trees = [
      { n: 6, k: 1 },
      { n: 6, k: 5 },
      { n: 4, k: 4 },
      { n: 9, k: 3 },
    ];
    const wide = hierarchicalBetaBinomial(trees);
    const narrow = hierarchicalBetaBinomial(trees, { alpha: 0.1 });
    expect(narrow.lower).toBeGreaterThanOrEqual(wide.lower);
    expect(narrow.upper).toBeLessThanOrEqual(wide.upper);
  });

  it('rejects bad input', () => {
    expect(() => hierarchicalBetaBinomial([])).toThrow(RangeError);
    expect(() => hierarchicalBetaBinomial([{ n: 0, k: 0 }])).toThrow(/no block/);
    expect(() => hierarchicalBetaBinomial([{ n: 3, k: 4 }])).toThrow(/exceeds/);
    expect(() => hierarchicalBetaBinomial([{ n: 3.5, k: 1 }])).toThrow(RangeError);
    expect(() => hierarchicalBetaBinomial([{ n: 3, k: 1 }], { alpha: 0 })).toThrow(RangeError);
  });
});

describe('wilsonEffective', () => {
  for (const quantile of ['z', 't'] as const) {
    it.each(reference.wilsonEffective)(
      `matches the independent reference, ${quantile} quantile: $name`,
      (c) => {
        const want = c[quantile];
        const got = wilsonEffective(c.clusters, { quantile });
        expect(got.estimate).toBeCloseTo(want.estimate, 12);
        expect(got.lower).toBeCloseTo(want.lower, 9);
        expect(got.upper).toBeCloseTo(want.upper, 9);
        expect(got.n).toBe(want.n);
        expect(got.clusters).toBe(want.clusters);
        expect(got.designEffect).toBeCloseTo(want.designEffect, 9);
        expect(got.effectiveN).toBeCloseTo(want.effectiveN, 9);
      },
    );
  }

  it('reproduces the report worked example: six trees of six, 26 passes, design effect 4.06 before the CR1 factor', () => {
    const got = wilsonEffective([0, 3, 5, 6, 6, 6].map((k) => ({ n: 6, k })));
    // The report prints SE_cl 0.1504 and deff 4.06 without the small-cluster factor g / (g - 1) = 1.2.
    expect(got.designEffect / 1.2).toBeCloseTo(4.06, 2);
    expect(got.effectiveN).toBeCloseTo(36 / (4.06 * 1.2), 1);
  });

  it('gives the plain Wilson interval for independent singletons up to the design effect clip', () => {
    const clusters = [
      ...Array.from({ length: 18 }, () => ({ n: 1, k: 1 })),
      ...Array.from({ length: 7 }, () => ({ n: 1, k: 0 })),
    ];
    const got = wilsonEffective(clusters, { quantile: 'z' });
    const plain = wilson(18, 25);
    expect(got.designEffect).toBeGreaterThan(0.9);
    expect(got.designEffect).toBeLessThan(1.1);
    expect(Math.abs(got.lower - plain.lower)).toBeLessThan(0.02);
  });

  it('counts each cluster once when every block agrees', () => {
    const got = wilsonEffective(Array.from({ length: 8 }, () => ({ n: 5, k: 5 })));
    expect(got.degenerate).toBe(true);
    expect(got.effectiveN).toBe(8);
    expect(got.upper).toBe(1);
    expect(got.lower).toBeGreaterThan(0.5);
  });

  it('widens with the number of blocks that move together', () => {
    const tight = wilsonEffective(Array.from({ length: 10 }, (_, i) => ({ n: 6, k: 3 + (i % 2) })));
    const loose = wilsonEffective(Array.from({ length: 10 }, (_, i) => ({ n: 6, k: i % 2 === 0 ? 6 : 1 })));
    expect(loose.designEffect).toBeGreaterThan(tight.designEffect);
    expect(loose.upper - loose.lower).toBeGreaterThan(tight.upper - tight.lower);
  });

  it('refuses an empty cluster: it must not inflate the cluster count', () => {
    const one = wilsonEffective([{ n: 1, k: 1 }]);
    expect(one.effectiveN).toBe(1);
    const padded = [{ n: 1, k: 1 }, ...Array.from({ length: 99 }, () => ({ n: 0, k: 0 }))];
    expect(() => wilsonEffective(padded)).toThrow(/no block/);
  });

  it('keeps 1 <= design effect <= n', () => {
    for (const c of reference.wilsonEffective) {
      const got = wilsonEffective(c.clusters);
      if (!got.degenerate) {
        expect(got.designEffect).toBeGreaterThanOrEqual(1 - 1e-12);
        expect(got.designEffect).toBeLessThanOrEqual(got.n);
      }
    }
  });

  it('rejects bad input', () => {
    expect(() => wilsonEffective([])).toThrow(RangeError);
    expect(() => wilsonEffective([{ n: 0, k: 0 }])).toThrow(/no block/);
    expect(() => wilsonEffective([{ n: 2, k: 3 }])).toThrow(/exceeds/);
    expect(() => wilsonEffective([{ n: 2, k: 1 }], { alpha: 1 })).toThrow(RangeError);
  });
});

/**
 * Coverage at a reduced grid: Bowyer's clustered model, 24 cells (trees 12 and 50; tree sizes 3 and the real Acme
 * sizes; hyper-mean 0.6 and 0.9; concentration 0.5, 2 and 8), 400 simulated suites per cell, seed 12 onward.
 * The full grid in the research report (160 cells, 5,000 suites) gives 73.5, 91.0 and 95.7 percent.
 */
describe('coverage on simulated suites', () => {
  const started = Date.now();
  const mean: Record<string, number> = {};
  const width: Record<string, number> = {};
  let cells = 0;
  for (const trees of [12, 50]) {
    for (const sizes of [3, ACME_TREE_SIZES] as const) {
      for (const theta of [0.6, 0.9]) {
        for (const d of [0.5, 2, 8]) {
          cells += 1;
          const r = simulateCoverage({ trees, sizes, theta, d }, { reps: 400, seed: 11 + cells });
          for (const [method, share] of Object.entries(r.coverage))
            mean[method] = (mean[method] ?? 0) + share / 24;
          for (const [method, w] of Object.entries(r.width)) width[method] = (width[method] ?? 0) + w / 24;
        }
      }
    }
  }
  const seconds = (Date.now() - started) / 1000;

  it('runs the whole grid in well under a CI minute', () => {
    expect(cells).toBe(24);
    expect(seconds).toBeLessThan(30);
  });

  it('naive Wilson, which reads blocks as independent, covers under 80 percent', () => {
    expect(mean['naive wilson']).toBeLessThan(0.8);
  });

  it('Wilson on the effective blocks covers 90 percent or more', () => {
    expect(mean['wilson effective z']).toBeGreaterThanOrEqual(0.9);
    expect(mean['wilson effective t']).toBeGreaterThanOrEqual(mean['wilson effective z'] as number);
  });

  it('the hierarchical interval covers 93 percent or more, near 95', () => {
    expect(mean.hierarchical).toBeGreaterThanOrEqual(0.93);
    expect(mean.hierarchical).toBeLessThan(0.99);
  });

  it('coverage is not bought with width: the hierarchical interval stays narrower than the whole range', () => {
    expect(width.hierarchical).toBeLessThan(0.5);
    expect(width.hierarchical).toBeGreaterThan(width['naive wilson'] as number);
  });

  it('is repeatable for a seed', () => {
    const cell = { trees: 12, sizes: 3, theta: 0.9, d: 2 };
    expect(simulateCoverage(cell, { reps: 50, seed: 5 })).toEqual(
      simulateCoverage(cell, { reps: 50, seed: 5 }),
    );
  });

  it('rejects bad input', () => {
    expect(() => simulateCoverage({ trees: 0, sizes: 3, theta: 0.5, d: 1 }, { reps: 10 })).toThrow(
      RangeError,
    );
    expect(() => simulateCoverage({ trees: 3, sizes: [], theta: 0.5, d: 1 }, { reps: 10 })).toThrow(
      RangeError,
    );
    expect(() => simulateCoverage({ trees: 3, sizes: 3, theta: 0.5, d: 0 }, { reps: 10 })).toThrow(
      RangeError,
    );
    expect(() => simulateCoverage({ trees: 3, sizes: 3, theta: 0.5, d: 1 }, { reps: 0 })).toThrow(RangeError);
  });
});
