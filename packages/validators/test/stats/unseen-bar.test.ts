import { describe, expect, it } from 'vitest';
import { runInProcess, statsBank } from '../../src/ladders/stats/bank/index';
import { ROOT, real, SLOW } from './support';

const items = () =>
  statsBank(ROOT).filter((item) => /^analytic\.unseen\.(hill-q[12]|chao1-large)\./.test(item.id));

async function failing(seed: number, impl: typeof real): Promise<string[]> {
  const run = await runInProcess(items(), seed, ROOT, impl);
  return [...run.entries()].filter(([, result]) => !result.pass).map(([id]) => id);
}

describe('the Chao1-at-scale and Hill bars', { timeout: SLOW }, () => {
  it('pass the real estimators on the seeds where one sample failed them', async () => {
    // With one sample: hill-q1.s40-tail5 failed on 154, 12290 and 12734, chao1-large.s80-tail10 on 1808 and
    // hill-q2.s40-tail5 on 3577.
    for (const seed of [154, 12290, 12734, 1808, 3577]) expect(await failing(seed, real)).toEqual([]);
  });

  it('fail q1 returned for q2, on s40-tail5 as well as s80-tail10', async () => {
    const swapped = {
      ...real,
      hillNumbers: (counts: readonly number[]) => ({
        ...real.hillNumbers(counts),
        q2: real.hillNumbers(counts).q1,
      }),
    } as typeof real;
    expect(await failing(1, swapped)).toEqual(
      expect.arrayContaining(['analytic.unseen.hill-q2.s40-tail5', 'analytic.unseen.hill-q2.s80-tail10']),
    );
  });

  it('fail q2 returned for q1, on s150-tail3 as well', async () => {
    const swapped = {
      ...real,
      hillNumbers: (counts: readonly number[]) => ({
        ...real.hillNumbers(counts),
        q1: real.hillNumbers(counts).q2,
      }),
    } as typeof real;
    expect(await failing(2, swapped)).toEqual(
      expect.arrayContaining([
        'analytic.unseen.hill-q1.s40-tail5',
        'analytic.unseen.hill-q1.s80-tail10',
        'analytic.unseen.hill-q1.s150-tail3',
      ]),
    );
  });

  it.each([0.9, 1.1])('fails Chao1 multiplied by %s at every population', async (factor) => {
    const biased = {
      ...real,
      chaoCoverage: (counts: readonly number[]) => {
        const got = real.chaoCoverage(counts);
        return { ...got, chao1: got.chao1 * factor };
      },
    };
    for (const seed of [1, 154, 1808, 3577]) {
      expect((await failing(seed, biased)).filter((id) => id.includes('chao1-large'))).toHaveLength(4);
    }
  });
});
