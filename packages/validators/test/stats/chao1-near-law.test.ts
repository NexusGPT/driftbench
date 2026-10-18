import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { analyticItems, CHAO1_ERROR_LAWS } from '../../src/ladders/stats/bank/analytic';
import { runItem } from '../../src/ladders/stats/bank/index';
import { generator } from '../../src/ladders/stats/draw';
import { ROOT } from './support';

const ID = 'analytic.unseen.chao1-near.s40-tail5.x3';
const item = analyticItems().find((each) => each.id === ID);
if (!item) throw new Error(`missing ${ID}`);
/** The hidden seed of the CI run of PR 69, where a correct implementation measured 0.10155 against 0.10. */
const HIDDEN = 931610427;

type S = typeof stats;
const mk = (f: (a: ReturnType<S['chaoCoverage']>, counts: readonly number[]) => number): S =>
  ({
    ...stats,
    chaoCoverage: (counts: readonly number[]) => {
      const a = stats.chaoCoverage(counts);
      return { ...a, chao1: f(a, counts) };
    },
  }) as S;
const WRONG: Array<[string, S]> = [
  ['the planted true class count', mk((_a, c) => c.length)],
  [
    'bias-corrected Chao1, f1 (f1 - 1) / (2 (f2 + 1))',
    mk((a) => a.observed + ((1 - 1 / a.n) * a.f1 * (a.f1 - 1)) / (2 * (a.f2 + 1))),
  ],
  [
    'no (n - 1) / n correction',
    mk((a) => a.observed + (a.f2 > 0 ? (a.f1 * a.f1) / (2 * a.f2) : (a.f1 * (a.f1 - 1)) / 2)),
  ],
  ['the observed class count alone', mk((a) => a.observed)],
  ['Chao1 times 1.1', mk((a) => a.chao1 * 1.1)],
  ['Chao1 times 0.9', mk((a) => a.chao1 * 0.9)],
  ['Chao1 times 1.02', mk((a) => a.chao1 * 1.02)],
  ['Chao1 plus 1', mk((a) => a.chao1 + 1)],
  [
    'singletons and doubletons swapped',
    mk((a) => a.observed + (1 - 1 / a.n) * (a.f1 > 0 ? (a.f2 * a.f2) / (2 * a.f1) : 0)),
  ],
  ['first-order jackknife, observed + f1 (n - 1) / n', mk((a) => a.observed + (a.f1 * (a.n - 1)) / a.n)],
  ['Chao1 rounded to an integer', mk((a) => Math.round(a.chao1))],
  ['Chao1 capped at 1.2 times the observed count', mk((a) => Math.min(a.chao1, 1.2 * a.observed))],
  ['unseen term halved', mk((a) => a.observed + (a.chao1 - a.observed) / 2)],
];

describe(`${ID}: classic Chao1 per draw, and the mean error inside its sampling law`, {
  timeout: 120_000,
}, () => {
  it('passes the correct statistics on the hidden seed of PR 69 and on seeds 1 to 3', async () => {
    for (const seed of [HIDDEN, 1, 2, 3])
      expect(await runItem(item, seed, ROOT, stats)).toMatchObject({ pass: true });
  });

  it('passes the correct statistics on every seed from 10000 to 10099', async () => {
    const failing: number[] = [];
    for (let seed = 10000; seed <= 10099; seed += 1)
      if (!(await runItem(item, seed, ROOT, stats)).pass) failing.push(seed);
    expect(failing).toEqual([]);
  });

  it.each(WRONG)(
    'fails %s on the hidden seed and on every seed from 10000 to 10099',
    async (_name, wrong) => {
      const passing: number[] = [];
      for (const seed of [HIDDEN, ...Array.from({ length: 100 }, (_, i) => 10000 + i)])
        if ((await runItem(item, seed, ROOT, wrong)).pass) passing.push(seed);
      expect(passing).toEqual([]);
    },
  );

  it('holds a law that a fresh simulation of the planted population reproduces', () => {
    const law = CHAO1_ERROR_LAWS['s40-tail5.x3'];
    if (!law) throw new Error('no law for s40-tail5.x3');
    const classes = 40;
    const weights = Array.from({ length: classes }, (_, i) => 5 ** (-i / (classes - 1)));
    const total = weights.reduce((a, b) => a + b, 0);
    const cumulative: number[] = [];
    let running = 0;
    for (const weight of weights) {
      running += weight / total;
      cumulative.push(running);
    }
    const rng = generator(20261013, 4053);
    const draws = 200_000;
    const n = 120;
    let sum = 0;
    let squares = 0;
    for (let d = 0; d < draws; d += 1) {
      const counts = new Array<number>(classes).fill(0);
      for (let i = 0; i < n; i += 1) {
        const u = rng();
        let j = cumulative.findIndex((c) => u < c);
        if (j < 0) j = classes - 1;
        counts[j] = (counts[j] as number) + 1;
      }
      const observed = counts.filter((c) => c > 0).length;
      const f1 = counts.filter((c) => c === 1).length;
      const f2 = counts.filter((c) => c === 2).length;
      const unseen = f2 > 0 ? (f1 * f1) / (2 * f2) : (f1 * (f1 - 1)) / 2;
      const error = Math.abs(observed + ((n - 1) / n) * unseen - classes) / classes;
      sum += error;
      squares += error * error;
    }
    const mean = sum / draws;
    const sd = Math.sqrt(squares / draws - mean * mean);
    // Six Monte Carlo standard errors of the mean; the sd of a law this heavy-tailed moves by a few percent.
    expect(Math.abs(mean - law.mean)).toBeLessThan((6 * law.sd) / Math.sqrt(draws));
    expect(Math.abs(sd / law.sd - 1)).toBeLessThan(0.1);
    expect(law.alpha).toBeLessThanOrEqual(0.001);
    expect(law.lower).toBeLessThan(law.mean);
    expect(law.upper).toBeGreaterThan(law.mean);
    // The retired bar of 0.10 sits inside the law: a correct implementation crossed it on about 3 seeds in 100.
    expect(law.upper).toBeGreaterThan(0.1);
  });
});
