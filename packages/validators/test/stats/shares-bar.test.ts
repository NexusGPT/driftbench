import type * as Stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it, vi } from 'vitest';
import { runInProcess, statsBank } from '../../src/ladders/stats/bank/index';
import { generator, plantShares, SHARES_RECOVERY, sharesLevel } from '../../src/ladders/stats/index';
import { committedDesigns, ROOT, real, SLOW } from './support';

type Result = Stats.VarianceComponentsResult;

/** Which variance-component estimator the pilot analysis gets: the real one or a planted wrong one. */
const planted = vi.hoisted(() => ({
  estimator: 'real' as 'real' | 'balanced' | 'residual-over-n' | 'no-residual' | 'swap',
}));

/**
 * The balanced nested ANOVA solved again from the mean squares of a real result (cell > conversation > wording >
 * repeat). `balanced` is the correct solve; the others plant a wrong estimator: the residual mean square over
 * N instead of its degrees of freedom, or no residual subtracted from the levels above it.
 */
function solve(result: Result, estimator: 'balanced' | 'residual-over-n' | 'no-residual'): Result {
  const [cell, conversation, wording, repeat] = result.components;
  if (!cell || !conversation || !wording || !repeat) return result;
  const R = result.n / wording.groups;
  const W = wording.groups / conversation.groups;
  const K = conversation.groups / cell.groups;
  const sigma = estimator === 'residual-over-n' ? repeat.sumSquares / result.n : repeat.meanSquare;
  const subtracted = estimator === 'no-residual' ? 0 : sigma;
  const w = (wording.meanSquare - subtracted) / R;
  const k = (conversation.meanSquare - subtracted - R * w) / (W * R);
  const c = (cell.meanSquare - subtracted - R * w - W * R * k) / (K * W * R);
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

async function failing(seed: number): Promise<string[]> {
  const run = await runInProcess(sharesItems(), seed, ROOT, real);
  return [...run.entries()].filter(([, result]) => !result.pass).map(([id]) => id);
}

describe('the share recovery bars', { timeout: SLOW }, () => {
  it('pass the correct analysis on seed 305826193, the hidden seed of main 4dc61151 (29 of 32)', async () => {
    planted.estimator = 'real';
    const measure = sharesLevel(305826193, committedDesigns().shares);
    expect(measure.value).toBe(29 / 32);
    expect(measure.value).toBeLessThan(0.93);
    expect(measure.value).toBeGreaterThanOrEqual(SHARES_RECOVERY);
    expect(await failing(305826193)).toEqual([]);
  });

  it('solve the balanced pilot like the real estimator, so the planted ones differ only by their fault', () => {
    planted.estimator = 'real';
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
    planted.estimator = 'residual-over-n';
    try {
      const measure = sharesLevel(1, committedDesigns().shares);
      expect(measure.value).toBeLessThan(SHARES_RECOVERY);
      const failed = await failing(1);
      expect(failed).toContain('simulation.shares.pooled');
    } finally {
      planted.estimator = 'real';
    }
  });

  it('fail an estimator that subtracts no residual, on the pooled item and on the wording and repeat levels', async () => {
    planted.estimator = 'no-residual';
    try {
      // Another seed than the case above: the bank keeps one shares run per seed in this process.
      const failed = await failing(3);
      expect(failed).toEqual(
        expect.arrayContaining([
          'simulation.shares.pooled',
          'simulation.shares.wording',
          'simulation.shares.repeat',
        ]),
      );
    } finally {
      planted.estimator = 'real';
    }
  });

  it('fail swapped cell and conversation shares on the cell level alone when the pooled count stays under its bar', async () => {
    planted.estimator = 'swap';
    try {
      // Seed 7: the swap misses the cell share on 2 of 8 datasets and nothing else (30 of 32).
      expect(await failing(7)).toEqual(['simulation.shares.cell']);
    } finally {
      planted.estimator = 'real';
    }
  });
});
