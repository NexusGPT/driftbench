import type * as Stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it, vi } from 'vitest';
import { runInProcess, statsBank } from '../../src/ladders/stats/bank/index';
import { generator, plantShares, sharesLevel } from '../../src/ladders/stats/index';
import { committedDesigns, ROOT, real, SLOW } from './support';

type Result = Stats.VarianceComponentsResult;
type Estimator = 'real' | 'balanced' | 'residual-over-n' | 'no-residual' | 'no-nested' | 'swap';

/** Which variance-component estimator the pilot analysis gets: the real one or a planted wrong one. */
const planted = vi.hoisted(() => ({ estimator: 'real' as Estimator }));

/**
 * The balanced nested ANOVA solved again from the mean squares of a real result (cell > conversation > wording >
 * repeat). `balanced` is the correct solve; the others plant a wrong estimator: the residual mean square over
 * N instead of its degrees of freedom, no residual subtracted from the levels above it, or no lower level
 * subtracted from the levels above it.
 */
function solve(result: Result, estimator: Exclude<Estimator, 'real' | 'swap'>): Result {
  const [cell, conversation, wording, repeat] = result.components;
  if (!cell || !conversation || !wording || !repeat) return result;
  const R = result.n / wording.groups;
  const W = wording.groups / conversation.groups;
  const K = conversation.groups / cell.groups;
  const sigma = estimator === 'residual-over-n' ? repeat.sumSquares / result.n : repeat.meanSquare;
  const subtracted = estimator === 'no-residual' ? 0 : sigma;
  const nested = estimator === 'no-nested' ? 0 : 1;
  const w = (wording.meanSquare - subtracted) / R;
  const k = (conversation.meanSquare - subtracted - nested * R * w) / (W * R);
  const c = (cell.meanSquare - subtracted - nested * (R * w + W * R * k)) / (K * W * R);
  const variances = [c, k, w].map((v) => Math.max(0, v));
  variances.push(Math.max(0, sigma));
  const total = variances.reduce((sum, v) => sum + v, 0);
  return {
    ...result,
    total,
    components: result.components.map((component, i) => ({
      ...component,
      variance: variances[i] as number,
      share: total > 0 ? (variances[i] as number) / total : 0,
    })),
  };
}

vi.mock('@agent-nexus/driftbench-stats', async (importOriginal) => {
  const actual = await importOriginal<typeof Stats>();
  return {
    ...actual,
    varianceComponents: (...args: Parameters<typeof actual.varianceComponents>) => {
      const result = actual.varianceComponents(...args);
      if (planted.estimator === 'real' || result.components.length !== 4) return result;
      if (planted.estimator !== 'swap') return solve(result, planted.estimator);
      // The cell and conversation estimates swapped, in the estimate and in every bootstrap draw.
      const [cell, conversation, ...rest] = result.components;
      if (!cell || !conversation) return result;
      return {
        ...result,
        components: [
          { ...cell, variance: conversation.variance, share: conversation.share },
          { ...conversation, variance: cell.variance, share: cell.share },
          ...rest,
        ],
      };
    },
  };
});

const sharesItems = () => statsBank(ROOT).filter((item) => item.id.startsWith('simulation.shares.'));

/** The failing share items on one seed. The bank keeps one shares run per seed, so each case takes its own seed. */
async function failing(seed: number, estimator: Estimator): Promise<string[]> {
  planted.estimator = estimator;
  try {
    const run = await runInProcess(sharesItems(), seed, ROOT, real);
    return [...run.entries()].filter(([, result]) => !result.pass).map(([id]) => id);
  } finally {
    planted.estimator = 'real';
  }
}

describe('the share recovery bars', { timeout: SLOW }, () => {
  it('pass the correct analysis on seed 305826193, the hidden seed of main 4dc61151', async () => {
    // With the earlier 8 datasets this seed recovered 29 of 32 shares, under the earlier bar 0.93.
    const before = sharesLevel(305826193, { ...committedDesigns().shares, datasets: 8 });
    expect(before.value).toBe(29 / 32);
    expect(await failing(305826193, 'real')).toEqual([]);
  });

  it('solve the balanced pilot like the real estimator, so the planted ones differ only by their fault', () => {
    const { observations } = plantShares(generator(1, 1), committedDesigns().shares);
    const result = real.varianceComponents(
      observations.map((row) => ({
        value: row.pass,
        path: [row.cell, row.conversation, String(row.wording)],
      })),
      { levels: ['cell', 'conversation', 'wording'] },
    );
    const again = solve(result, 'balanced');
    again.components.forEach((component, i) => {
      expect(Math.abs(component.share - (result.components[i]?.share as number))).toBeLessThan(1e-12);
    });
  });

  it('fail a residual mean square over N instead of its degrees of freedom', async () => {
    expect(await failing(1, 'residual-over-n')).toEqual(
      expect.arrayContaining([
        'simulation.shares.pooled',
        'simulation.shares.wording',
        'simulation.shares.repeat',
      ]),
    );
  });

  it('fail an estimator that subtracts no residual, on the pooled item and on the wording and repeat levels', async () => {
    expect(await failing(4, 'no-residual')).toEqual(
      expect.arrayContaining([
        'simulation.shares.pooled',
        'simulation.shares.wording',
        'simulation.shares.repeat',
      ]),
    );
  });

  it('fail swapped cell and conversation shares on the cell level', async () => {
    // Seed 3: the swap misses the cell share on 4 of 20 datasets, 6 shares of 80 in all.
    const failed = await failing(3, 'swap');
    expect(failed).toContain('simulation.shares.cell');
    expect(failed).not.toContain('simulation.shares.pooled');
  });

  it('fail an estimator that subtracts no lower level, on the nested design alone', async () => {
    // Seed 2: on the committed design this estimator recovers every share; the nested design shows it.
    expect(await failing(2, 'no-nested')).toEqual(['simulation.shares.nested']);
  });
});
