import type { RunResult } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial, mde, wilsonEffective } from '@agent-nexus/driftbench-stats';
import { groupBy, runPassed } from './data';
import type { Estimate } from './estimate';

/** The power the detectable drop is read at: the same 80% the comparison prints (PLANNING_POWER in compare). */
export const HEADLINE_POWER = 0.8;

/**
 * The headline of a suite: its pass rate as the mean over trees, with the hierarchical Beta-Bernoulli interval,
 * and what a reader needs to judge it.
 *
 * A tree is the group of runs that cannot be told apart as independent evidence: today the repeats of one
 * golden (one spec in one mode, one perturbation in P). Every tree weighs the same, whatever its repeats, so a
 * golden with ten repeats does not outvote one with two. The interval widens when trees disagree and narrows
 * when they agree; it is the one to quote for a suite.
 */
export type SuiteHeadline = Estimate & {
  method: 'hierarchical' | 'none';
  /** The trees: goldens with at least one run. */
  trees: number;
  /** Runs in all trees. */
  runs: number;
  /** The pass rate over all runs pooled, each run counting once. Differs from `estimate` when trees have unequal repeats. */
  pooledRate: number;
  /** Design effect of the pooled rate across trees and the runs it is worth: the same clustering, Wilson on n_eff. */
  designEffect: number;
  effectiveRuns: number;
  /** True when every run passed or every run failed: the spread between goldens is zero, so each golden counts once. */
  degenerate: boolean;
  /** The smallest drop in the tree-level rate two suites like this one detect at 80% power; null when none is. */
  detectableDrop: number | null;
  /** Shares of the runs that did not give a verdict. `blocked` and `notRun` are 0 until a run carries that status. */
  shares: { incomplete: number; blocked: number; notRun: number };
};

/** The status of a run as text, so a status a later schema adds (`blocked`, `not_run`) counts without a type change. */
function statusOf(run: RunResult): string {
  return String((run as { status: unknown }).status);
}

/** The suite headline of runs, grouped into trees by `treeOf`. Undefined with no run. */
export function suiteHeadline(
  runs: readonly RunResult[],
  treeOf: (run: RunResult) => string,
): SuiteHeadline | undefined {
  if (runs.length === 0) return undefined;
  const groups = [...groupBy(runs, treeOf).values()];
  const counts = groups.map((group) => ({ n: group.length, k: group.filter(runPassed).length }));
  const shares = {
    incomplete: runs.filter((run) => statusOf(run) !== 'completed').length / runs.length,
    blocked: runs.filter((run) => statusOf(run) === 'blocked').length / runs.length,
    notRun: runs.filter((run) => statusOf(run) === 'not_run').length / runs.length,
  };
  const pooled = counts.reduce((sum, c) => sum + c.k, 0) / runs.length;
  const base = { trees: groups.length, runs: runs.length, shares, pooledRate: pooled };
  if (groups.length < 2) {
    // One tree: the spread between trees cannot be measured, so no interval is drawn.
    const only = counts[0] as { n: number; k: number };
    const estimate = only.k / only.n;
    return {
      ...base,
      estimate,
      lower: estimate,
      upper: estimate,
      method: 'none',
      n: runs.length,
      clusters: 1,
      designEffect: 1,
      effectiveRuns: runs.length,
      degenerate: false,
      detectableDrop: null,
    };
  }
  const interval = hierarchicalBetaBinomial(counts);
  const effective = wilsonEffective(counts);
  // Kept inside (0, 1) so a suite where everything passes still has a detectable drop, as `compare` does.
  const rate = Math.min(Math.max(interval.estimate, 0.5 / runs.length), 1 - 0.5 / runs.length);
  const detectable = mde({ n: Math.max(1, effective.effectiveN), baselineRate: rate, power: HEADLINE_POWER });
  return {
    ...base,
    estimate: interval.estimate,
    lower: interval.lower,
    upper: interval.upper,
    method: 'hierarchical',
    n: runs.length,
    clusters: groups.length,
    designEffect: effective.designEffect,
    effectiveRuns: effective.effectiveN,
    degenerate: effective.degenerate,
    detectableDrop: detectable.effect,
  };
}
