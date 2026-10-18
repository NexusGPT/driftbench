import { describe, expect, it } from 'vitest';
import { runInProcess, statsBank } from '../../src/ladders/stats/bank/index';
import { ROOT, real, SLOW } from './support';

type Interval = { estimate: number; lower: number; upper: number };

/** Wilson's score interval at a given z, the way a wrong implementation could write it. */
function wilsonAt(z: number): (k: number, n: number) => Interval {
  return (k, n) => {
    const p = k / n;
    const d = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / d;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return { estimate: p, lower: centre - half, upper: centre + half };
  };
}

function wald(k: number, n: number): Interval {
  const p = k / n;
  const half = 1.959963984540054 * Math.sqrt((p * (1 - p)) / n);
  return { estimate: p, lower: p - half, upper: p + half };
}

const items = () => statsBank(ROOT).filter((item) => item.id.startsWith('simulation.wilson-coverage.'));

async function failing(seed: number, wilson: (k: number, n: number) => Interval): Promise<string[]> {
  const run = await runInProcess(items(), seed, ROOT, { ...real, wilson } as typeof real);
  return [...run.entries()].filter(([, result]) => !result.pass).map(([id]) => id);
}

describe('the Wilson coverage bar', { timeout: SLOW }, () => {
  it('passes the real interval on seed 180, which covered 0.926 at n 200 with 1000 draws', async () => {
    expect(await failing(180, real.wilson)).toEqual([]);
  });

  it('fails the Wald interval at n 20 and 50', async () => {
    expect(await failing(1, wald)).toEqual(
      expect.arrayContaining(['simulation.wilson-coverage.n20', 'simulation.wilson-coverage.n50']),
    );
  });

  it('fails a Wilson interval at z 1.90, which covers 0.943 to 0.946', async () => {
    expect((await failing(1, wilsonAt(1.9))).length).toBeGreaterThan(0);
  });
});
