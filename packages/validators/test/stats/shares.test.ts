import { analysePilot, type PilotAnalysis } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  generator,
  type PilotAnalyser,
  plantedShares,
  plantShares,
  SHARES_RECOVERY,
  sharesLevel,
} from '../../src/ladders/stats/index';
import { committedDesigns, designsWith, SLOW } from './support';

describe('the planted shares', { timeout: SLOW }, () => {
  it('match the pilot analysis truth on a planted dataset, computed apart from it', () => {
    const design = committedDesigns().shares;
    const { observations, chances } = plantShares(generator(3, 1), design);
    const planted = analysePilot(observations, { iterations: 2 }).planted;
    const shares = plantedShares(chances);
    expect(planted?.levels.map((level) => level.level)).toEqual([
      'cell',
      'conversation',
      'wording',
      'repeat',
    ]);
    planted?.levels.forEach((level, index) => {
      expect(Math.abs(level.share - (shares[index] as number))).toBeLessThan(1e-12);
    });
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  });

  it('give the whole variance to the repeats when every chance is the same', () => {
    const flat = [0, 1].map(() => [0, 1].map(() => [0.3, 0.3]));
    expect(plantedShares(flat)).toEqual([0, 0, 0, 1]);
  });

  it('put a cell difference on the cell level', () => {
    // Cell means 0.2 and 0.8, nothing varies inside a cell: s_c = 0.18, s_k = s_w = 0.
    const chances = [0.2, 0.8].map((p) => [0, 1].map(() => [p, p]));
    const shares = plantedShares(chances);
    const noise = (0.2 * 0.8 + 0.8 * 0.2) / 2;
    expect(shares[0]).toBeCloseTo(0.18 / (0.18 + noise), 12);
    expect(shares.slice(1, 3)).toEqual([0, 0]);
  });
});

describe('level 4: variance share recovery', { timeout: SLOW }, () => {
  it(
    'passes on the committed design: the planted shares lie inside their intervals',
    () => {
      const measure = sharesLevel(1, committedDesigns().shares);
      expect(measure.value).toBeGreaterThanOrEqual(SHARES_RECOVERY);
      expect(measure.items.length).toBeLessThanOrEqual(2);
    },
    SLOW,
  );

  it('fails when the analysis gives an interval of zero width, naming dataset, level, truth and interval', () => {
    const design = designsWith((d) => {
      d.shares.datasets = 2;
    }).shares;
    const pinned: PilotAnalyser = (rows, options) => {
      const analysis: PilotAnalysis = analysePilot(rows, { ...options, iterations: 20 });
      for (const level of analysis.pooled.levels)
        level.shareInterval = { lower: level.share, upper: level.share };
      return analysis;
    };
    const measure = sharesLevel(1, design, pinned);
    expect(measure.value).toBeLessThan(SHARES_RECOVERY);
    expect(measure.items).toHaveLength(8);
    expect(measure.items[0]?.id).toBe('shares-1-cell');
    expect(measure.items[0]?.component).toBe('packages/generate/src/pilot/analyse.ts');
    expect(measure.items[0]?.detail).toMatch(
      /^estimator analysePilot \(pooled variance share, cluster bootstrap\), seed 1, dataset 1 of 2, level cell: truth [\d.e-]+, estimate [\d.e-]+, interval \[[\d.e-]+, [\d.e-]+\]$/,
    );
  });

  it('fails when the analysis swaps two levels', () => {
    const design = designsWith((d) => {
      d.shares.datasets = 2;
    }).shares;
    const swapped: PilotAnalyser = (rows, options) => {
      const analysis = analysePilot(rows, options);
      const [cell, conversation] = analysis.pooled.levels;
      if (cell && conversation) [cell.level, conversation.level] = [conversation.level, cell.level];
      return analysis;
    };
    const measure = sharesLevel(2, design, swapped);
    expect(measure.value).toBeLessThan(SHARES_RECOVERY);
    expect(measure.items.length).toBeGreaterThan(0);
    expect(measure.items.every((item) => /^shares-[12]-(cell|conversation)$/.test(item.id))).toBe(true);
  });
});
