import type { BlockResult, RunResult } from '@agent-nexus/driftbench-core';
import { mulberry32, wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { block, run } from './support';

/**
 * Coverage of the suite headline on simulated suites with parents, read through the real `suiteHeadline`. A suite
 * is one spec of `families` root families of `children` child blocks each, run `repeats` times. A family has a
 * pass rate phi ~ Beta(dFamily theta, dFamily (1 - theta)); each child a rate around phi, ~ Beta(dChild phi,
 * dChild (1 - phi)); a child passes in a repeat with its rate; a root always passes. The children of one family
 * move together because their rates share phi, which is what makes the runs of a family one piece of evidence.
 *
 * Two readings of the same draws:
 * - the family reading, which is what the headline does with the recorded parent links: one outcome per root tree
 *   and repeat (the tree passes when its root and every child pass), one tree per family. It estimates the rate of
 *   a tree, E[phi^children] (the children are independent given phi).
 * - the child reading: every child block read as a run of a spec of its own, so every child is a tree; it estimates
 *   the rate of a child, theta. This is the grouping the headline had before blocks could name a parent.
 * Nothing here depends on time; every draw comes from a seeded generator, so the numbers are the same on every run.
 */

/** A Gamma(shape, 1) draw (Marsaglia and Tsang), through a seeded uniform generator. */
function gamma(rng: () => number, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const c = shape - 1 / 3;
  const s = 1 / Math.sqrt(9 * c);
  for (;;) {
    const u1 = 1 - rng();
    const x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
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

type Cell = {
  families: number;
  children: number;
  repeats: number;
  theta: number;
  dFamily: number;
  dChild: number;
};

/** E[phi^children] for phi ~ Beta(a, b): the rate of a tree whose children pass independently given phi. */
function treeRate(cell: Cell): number {
  const a = cell.dFamily * cell.theta;
  const b = cell.dFamily * (1 - cell.theta);
  let rate = 1;
  for (let i = 0; i < cell.children; i += 1) rate *= (a + i) / (a + b + i);
  return rate;
}

/** The family layout of one repeat: a root and its children, every child naming the root as its parent. */
function linkedRun(cell: Cell, repeat: number, passes: boolean[][]): RunResult {
  const blocks: BlockResult[] = [];
  passes.forEach((family, f) => {
    blocks.push({
      ...block(blocks.length, { blockId: `r${f}` }),
      specIndex: blocks.length,
    });
    family.forEach((passed, c) => {
      blocks.push({
        ...block(blocks.length, { blockId: `r${f}c${c}`, pass: passed }),
        specIndex: blocks.length,
        parent: `r${f}`,
      });
    });
  });
  return { ...run({ specId: 'suite', repeat }), blocks };
}

/** The child layout of the same draws: every child block is a run of a spec of its own. */
function childRuns(passes: boolean[][], repeat: number): RunResult[] {
  return passes.flatMap((family, f) =>
    family.map((passed, c) => run({ specId: `f${f}c${c}`, repeat, blocks: [{ pass: passed }] })),
  );
}

/** The share of simulated suites whose interval holds the truth, by reading, over `reps` suites. */
function coverage(cell: Cell, reps: number, seed: number) {
  const rng = mulberry32(seed);
  const target = treeRate(cell);
  const held = { family: 0, child: 0, naive: 0 };
  for (let rep = 0; rep < reps; rep += 1) {
    // passes[repeat][family][child]
    const rates = Array.from({ length: cell.families }, () => {
      const phi = beta(rng, cell.dFamily * cell.theta, cell.dFamily * (1 - cell.theta));
      return Array.from({ length: cell.children }, () =>
        beta(rng, cell.dChild * phi, cell.dChild * (1 - phi)),
      );
    });
    const draws = Array.from({ length: cell.repeats }, () =>
      rates.map((family) => family.map((rate) => rng() < rate)),
    );
    const linked = draws.map((passes, repeat) => linkedRun(cell, repeat, passes));
    const family = suiteHeadline(linked, (entry) => entry.specId);
    if (family && family.lower <= target && target <= family.upper) held.family += 1;
    const children = draws.flatMap((passes, repeat) => childRuns(passes, repeat));
    const child = suiteHeadline(children, (entry) => entry.specId);
    if (child && child.lower <= cell.theta && cell.theta <= child.upper) held.child += 1;
    // Wilson on every tree outcome as if the trees and repeats were independent.
    const outcomes = draws.flatMap((passes) => passes.map((f) => f.every(Boolean)));
    const naive = wilson(outcomes.filter(Boolean).length, outcomes.length);
    if (naive.lower <= target && target <= naive.upper) held.naive += 1;
  }
  return { family: held.family / reps, child: held.child / reps, naive: held.naive / reps };
}

describe('coverage of the suite headline on simulated suites with parents', () => {
  const cells: Cell[] = [];
  for (const families of [12, 30])
    for (const theta of [0.6, 0.9])
      for (const dFamily of [0.5, 2, 8])
        cells.push({ families, children: 3, repeats: 3, theta, dFamily, dChild: 2 });
  const results = cells.map((cell, index) => ({ cell, ...coverage(cell, 200, 700 + index) }));
  const mean = (pick: (r: (typeof results)[number]) => number) =>
    results.reduce((sum, r) => sum + pick(r), 0) / results.length;

  it('reads 12 cells of 200 suites with fixed seeds', () => {
    expect(results).toHaveLength(12);
  });

  it('the family reading, which the headline takes from the recorded parent links, holds the true rate in 93 percent of suites or more', () => {
    expect(mean((r) => r.family)).toBeGreaterThanOrEqual(0.93);
    expect(mean((r) => r.family)).toBeLessThan(0.99);
    // A single cell rests on 200 suites, so it moves by about 2 points between seeds: the worst cell stays near 90.
    expect(Math.min(...results.map((r) => r.family))).toBeGreaterThanOrEqual(0.88);
  });

  it('the child reading undercovers: it holds the true rate in under 88 percent of suites', () => {
    expect(mean((r) => r.child)).toBeLessThan(0.88);
  });

  it('naive Wilson on every tree outcome, which reads trees and repeats as independent, covers under 85 percent', () => {
    expect(mean((r) => r.naive)).toBeLessThan(0.85);
  });

  it('the family reading covers more than the child reading in every cell where the families agree inside', () => {
    // dFamily 0.5 and 2: the children of a family move together, the case grouping by family is for.
    const together = results.filter((r) => r.cell.dFamily <= 2);
    expect(together).toHaveLength(8);
    for (const r of together)
      expect(r.family, `${r.cell.families} families, theta ${r.cell.theta}`).toBeGreaterThan(r.child);
  });
});
