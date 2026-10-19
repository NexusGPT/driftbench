import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { ROOT } from './support';

const ID = 'scale.bootstrap-clustered';
const item = statsBank(ROOT).find((each) => each.id === ID);
if (!item) throw new Error(`missing ${ID}`);
/** The hidden seed of the CI run of PR 109, where a correct implementation gave [0.5000073, 0.5011350]. */
const HIDDEN = 240177888;

type S = typeof stats;
type Interval = ReturnType<S['bootstrapCI']>;
const reshape = (f: (r: Interval) => Partial<Interval>): S =>
  ({
    ...stats,
    bootstrapCI: (values: readonly number[], options?: Parameters<S['bootstrapCI']>[1]) => {
      const r = stats.bootstrapCI(values, options);
      return { ...r, ...f(r) };
    },
  }) as S;
const withOptions = (change: Partial<NonNullable<Parameters<S['bootstrapCI']>[1]>>): S =>
  ({
    ...stats,
    bootstrapCI: (values: readonly number[], options?: Parameters<S['bootstrapCI']>[1]) =>
      stats.bootstrapCI(values, { ...options, ...change }),
  }) as S;

/** Wrong implementations at the bootstrapCI seam (the old item caught some of them on part of the seeds). */
export const WRONG: Array<[string, S]> = [
  ['a degenerate interval [estimate, estimate]', reshape((r) => ({ lower: r.estimate, upper: r.estimate }))],
  ['a fixed interval [0.499, 0.501] around the truth', reshape(() => ({ lower: 0.499, upper: 0.501 }))],
  ['the interval [0, 1]', reshape(() => ({ lower: 0, upper: 1 }))],
  [
    'an interval of half the width',
    reshape((r) => ({
      lower: r.estimate - (r.estimate - r.lower) / 2,
      upper: r.estimate + (r.upper - r.estimate) / 2,
    })),
  ],
  [
    'an interval of twice the width',
    reshape((r) => ({
      lower: r.estimate - (r.estimate - r.lower) * 2,
      upper: r.estimate + (r.upper - r.estimate) * 2,
    })),
  ],
  ['an interval shifted up by 0.001', reshape((r) => ({ lower: r.lower + 0.001, upper: r.upper + 0.001 }))],
  [
    'an interval shifted up by 0.0005',
    reshape((r) => ({ lower: r.lower + 0.0005, upper: r.upper + 0.0005 })),
  ],
  ['an 80 percent interval (alpha 0.2)', withOptions({ alpha: 0.2 })],
  ['an interval that ignores alpha (always 0.05)', withOptions({ alpha: 0.05 })],
  ['20 resamples whatever is asked', withOptions({ iterations: 20 })],
  ['an interval at alpha 0.1 whatever is asked (a 90 percent interval)', withOptions({ alpha: 0.1 })],
  ['the bounds swapped', reshape((r) => ({ lower: r.upper, upper: r.lower }))],
  ['an estimate off by 0.001', reshape((r) => ({ estimate: r.estimate + 0.001 }))],
];

const OVERRUN = /ms of processor time, over the \d+ ms budget/;

/**
 * The correct statistics on one seed. The only failure a loaded machine can cause in a seeded item is an overrun of
 * the processor-time budget, so a run that failed on that alone is run again, up to three runs in all. Any other
 * failure counts at once, and a slow implementation overruns every run.
 */
const runCorrect = async (seed: number) => {
  let outcome = await runItem(item, seed, ROOT, stats);
  for (let run = 1; run < 3 && !outcome.pass && OVERRUN.test(outcome.detail); run += 1)
    outcome = await runItem(item, seed, ROOT, stats);
  return outcome;
};

describe(`${ID}: the interval against the data's own mean and standard error`, { timeout: 600_000 }, () => {
  it('passes the correct statistics on the hidden seed of PR 109 and on seeds 1 to 3', async () => {
    for (const seed of [HIDDEN, 1, 2, 3]) expect(await runCorrect(seed)).toMatchObject({ pass: true });
  });

  it('passes the correct statistics on every seed from 10000 to 10099', async () => {
    const failing: number[] = [];
    for (let seed = 10000; seed <= 10099; seed += 1) if (!(await runCorrect(seed)).pass) failing.push(seed);
    expect(failing).toEqual([]);
  });

  it.each(WRONG)(
    'fails %s on the hidden seed and on every seed from 10000 to 10019',
    async (_name, wrong) => {
      const passing: number[] = [];
      for (const seed of [HIDDEN, ...Array.from({ length: 20 }, (_, i) => 10000 + i)])
        if ((await runItem(item, seed, ROOT, wrong)).pass) passing.push(seed);
      expect(passing).toEqual([]);
    },
  );

  it('still fails a correct but slow implementation on the processor-time budget', async () => {
    const slow = {
      ...stats,
      bootstrapCI: (values: readonly number[], options?: Parameters<S['bootstrapCI']>[1]) => {
        const end = process.cpuUsage().user + 6_000_000;
        while (process.cpuUsage().user < end);
        return stats.bootstrapCI(values, options);
      },
    } as S;
    const result = await runItem(item, 10000, ROOT, slow);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/ms of processor time, over the 5000 ms budget/);
  });
});
