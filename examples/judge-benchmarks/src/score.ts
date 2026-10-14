import { wilson, Z95 } from '@driftbench/stats';
import type { PairDecision, PointDecision } from './contestants';
import type { BenchmarkId, Item, PairItem, PointItem } from './data';

/**
 * The papers' own scoring rules, applied to the decisions of one contestant.
 *
 * - JudgeBench: each pair is judged in both orders; each game that names the right response counts +1, the
 *   wrong one -1; the pair is right when the sum is positive. A tie or a missing answer counts 0, so a pair
 *   with two ties, or one right and one wrong game, is not right. Accuracy over all pairs.
 * - MM-Eval: RewardBench's generative scoring, one game in a random order, 1 when right, 0 when wrong, 0.5
 *   for a tie. Both orders are run here and each pair scores the mean of its two games, the expected value
 *   of the random order. Accuracy per subset; the total is the unweighted mean of the five subsets.
 * - LongJudgeBench wp_bench: accuracy over games, both orders; a tie is wrong.
 * - RubricBench: a binary preference against the human label, accuracy over all items; both orders are run
 *   here and scored as games, a tie is wrong.
 * - LongJudgeBench verify_bench_hard: accuracy of the binary verdict against the human label; an answer that
 *   gives no verdict is wrong. Balanced accuracy is given beside it, since four in five responses are wrong.
 *
 * A pointwise contestant on a pairwise benchmark scores each response once; the higher score wins, an equal
 * score is a tie (JudgeBench's single game). It has no order, so its position consistency is not defined.
 */

export type PairResult = {
  readonly item: PairItem;
  /** The decision with the pair as given (A first), and with the pair swapped, mapped back to A and B. */
  readonly games: readonly PairDecision[];
  readonly missing: number;
};

export type PointResult = {
  readonly item: PointItem;
  readonly decision: PointDecision;
  readonly missing: number;
};

export type Interval = { readonly estimate: number; readonly lower: number; readonly upper: number };

export type Summary = {
  readonly metric: string;
  readonly value: Interval;
  readonly n: number;
  /** Share of pairs whose two orders named the same response; undefined for a single game. */
  readonly positionConsistency?: number;
  readonly balancedAccuracy?: number;
  readonly byGroup: Readonly<Record<string, { n: number; value: number }>>;
  readonly missing: number;
};

const flip = (d: PairDecision): PairDecision => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');

/** The game decisions of a pairwise contestant, as the item names them: the second game is swapped back. */
export function pairGames(ordered: PairDecision, swapped: PairDecision): PairDecision[] {
  return [ordered, flip(swapped)];
}

/** One game from two pointwise scores. */
export function pointGame(a: PointDecision, b: PointDecision): PairDecision {
  const value = (d: PointDecision) => d.score ?? (d.pass === undefined ? undefined : d.pass ? 1 : 0);
  const va = value(a);
  const vb = value(b);
  if (va === undefined || vb === undefined || va === vb) return 'tie';
  return va > vb ? 'A' : 'B';
}

function judgeBenchCorrect(r: PairResult): number {
  let counter = 0;
  for (const g of r.games) {
    if (g === r.item.label) counter += 1;
    else if (g === flip(r.item.label)) counter -= 1;
  }
  return counter > 0 ? 1 : 0;
}

function gameScore(g: PairDecision, label: 'A' | 'B'): number {
  return g === label ? 1 : g === 'tie' ? 0.5 : 0;
}

function consistency(results: readonly PairResult[]): number | undefined {
  const twoGame = results.filter((r) => r.games.length === 2);
  if (twoGame.length === 0) return undefined;
  return twoGame.filter((r) => r.games[0] !== 'tie' && r.games[0] === r.games[1]).length / twoGame.length;
}

function groupMeans(
  values: readonly { group: string; value: number }[],
): Record<string, { n: number; value: number }> {
  const out: Record<string, { n: number; value: number }> = {};
  for (const { group, value } of values) {
    const g = out[group] ?? { n: 0, value: 0 };
    g.value = (g.value * g.n + value) / (g.n + 1);
    g.n += 1;
    out[group] = g;
  }
  return out;
}

function wilsonOf(k: number, n: number): Interval {
  return n === 0 ? { estimate: 0, lower: 0, upper: 1 } : wilson(Math.round(k), n);
}

export function scorePairs(bench: BenchmarkId, results: readonly PairResult[]): Summary {
  const missing = results.reduce((s, r) => s + r.missing, 0);
  const pc = consistency(results);
  const extra = pc === undefined ? {} : { positionConsistency: pc };
  if (bench === 'judgebench') {
    const values = results.map((r) => ({ group: r.item.group, value: judgeBenchCorrect(r) }));
    const k = values.reduce((s, v) => s + v.value, 0);
    return {
      metric: 'accuracy (JudgeBench, both orders)',
      value: wilsonOf(k, results.length),
      n: results.length,
      byGroup: groupMeans(values),
      missing,
      ...extra,
    };
  }
  if (bench === 'mmeval') {
    const values = results.map((r) => ({
      group: r.item.group,
      value: r.games.reduce((s, g) => s + gameScore(g, r.item.label), 0) / r.games.length,
    }));
    const byGroup = groupMeans(values);
    const groups = Object.values(byGroup);
    const total = groups.reduce((s, g) => s + g.value, 0) / groups.length;
    // The normal interval of a mean of subset means: each subset's variance of its pair scores over its n.
    const variance =
      Object.entries(byGroup).reduce((s, [group, g]) => {
        const xs = values.filter((v) => v.group === group).map((v) => v.value);
        const v = xs.length > 1 ? xs.reduce((a, x) => a + (x - g.value) ** 2, 0) / (xs.length - 1) : 0;
        return s + v / Math.max(1, g.n);
      }, 0) /
      groups.length ** 2;
    const half = Z95 * Math.sqrt(variance);
    return {
      metric: 'accuracy (MM-Eval: mean of the five subsets, tie 0.5)',
      value: { estimate: total, lower: Math.max(0, total - half), upper: Math.min(1, total + half) },
      n: results.length,
      byGroup,
      missing,
      ...extra,
    };
  }
  // wp_bench and RubricBench: accuracy over games, a tie is wrong. RubricBench's overall accuracy is over
  // all items (its overall row matches the item-weighted mean of its domains, not their plain mean).
  const games = results.flatMap((r) =>
    r.games.map((g) => ({ group: r.item.group, value: g === r.item.label ? 1 : 0 })),
  );
  const k = games.reduce((s, v) => s + v.value, 0);
  return {
    metric:
      bench === 'rubricbench' ? 'accuracy (RubricBench, over games)' : 'accuracy (LongJudgeBench, over games)',
    value: wilsonOf(k, games.length),
    n: results.length,
    byGroup: groupMeans(games),
    missing,
    ...extra,
  };
}

export function scorePoints(results: readonly PointResult[]): Summary {
  const right = (r: PointResult) =>
    r.decision.pass === undefined ? 0 : r.decision.pass === r.item.correct ? 1 : 0;
  const k = results.reduce((s, r) => s + right(r), 0);
  const rate = (correct: boolean) => {
    const xs = results.filter((r) => r.item.correct === correct);
    return xs.length === 0 ? 0 : xs.reduce((s, r) => s + right(r), 0) / xs.length;
  };
  return {
    metric: 'accuracy (LongJudgeBench verify, binary)',
    value: wilsonOf(k, results.length),
    n: results.length,
    balancedAccuracy: (rate(true) + rate(false)) / 2,
    byGroup: groupMeans(results.map((r) => ({ group: r.item.group, value: right(r) }))),
    missing: results.reduce((s, r) => s + r.missing, 0),
  };
}

export type { Item };
