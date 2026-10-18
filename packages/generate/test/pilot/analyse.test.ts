import { varianceComponents } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { analysePilot, blockFlips, fSurvival } from '../../src/pilot/analyse';
import type { PilotObservation } from '../../src/pilot/run';
import { deterministicRows, simulate } from './support';

const row = (over: Partial<PilotObservation>): PilotObservation => ({
  cell: 'cell-0',
  conversation: 'conv-0',
  wording: 0,
  map: 'map-1',
  suite: 1,
  specId: 'conv-0.w0',
  repeat: 0,
  status: 'completed',
  pass: true,
  blocks: [true],
  ...over,
});

describe('analysePilot on a deterministic agent', () => {
  // Two cells; one conversation of cell 1 fails on every wording and repeat, one wording of another fails.
  const rows = deterministicRows([
    [
      [true, true, true],
      [true, true, true],
      [true, true, true],
    ],
    [
      [false, false, false],
      [true, false, true],
      [true, true, true],
    ],
  ]);
  const analysis = analysePilot(rows, { iterations: 50 });

  it('measures no run-to-run variance, no flip, and needs one repeat per block', () => {
    const repeat = analysis.pooled.levels.find((level) => level.level === 'repeat');
    expect(repeat?.variance).toBe(0);
    expect(repeat?.share).toBe(0);
    expect(analysis.flip.flipping).toBe(0);
    expect(analysis.flip.mean).toBe(0);
    expect(analysis.noiseFloor.perBlock.repeats).toBe(1);
    expect(analysis.noiseFloor.reached).toBe(0);
  });

  it('is the nested model of the stats package, cell > conversation > wording > repeat', () => {
    const direct = varianceComponents(
      rows.map((r) => ({ value: r.pass, path: [r.cell, r.conversation, String(r.wording)] })),
    );
    expect(analysis.pooled.levels.map((level) => level.variance)).toEqual(
      direct.components.map((component) => component.variance),
    );
    expect(analysis.pooled.levels.reduce((sum, level) => sum + level.share, 0)).toBeCloseTo(1, 12);
  });

  it('flags the cell whose outcome depends on the wording, and only that one', () => {
    expect(analysis.wording.flagged).toEqual(['cell-1']);
    const cell = analysis.cells.find((c) => c.cell === 'cell-1');
    expect(cell?.wording).toEqual({
      conversations: 3,
      maxRange: 1,
      meanRange: 1 / 3,
      pValue: 0,
      adjusted: 0,
      flagged: true,
    });
  });

  it('allocates the estimation pool to the cell with spread (Neyman)', () => {
    expect(analysis.allocation.strata.map((s) => [s.cell, s.allocated])).toEqual([
      ['cell-0', 0],
      ['cell-1', 100],
    ]);
  });

  it('measures the design effect from the within-cell conversation correlation', () => {
    const level = (name: string) => analysis.pooled.levels.find((l) => l.level === name)?.variance ?? 0;
    const rho = level('conversation') / (level('conversation') + level('wording') + level('repeat'));
    expect(analysis.designEffect.rho).toBeCloseTo(rho, 12);
    expect(analysis.designEffect.m).toBe(15);
    expect(analysis.designEffect.value).toBeCloseTo(1 + 14 * rho, 12);
  });
});

describe('flip rate and noise floor', () => {
  it('is 2 k (r - k) / (r (r - 1)) per block: the chance two repeats disagree', () => {
    const rows = [true, true, false, false, false].map((pass, repeat) =>
      row({ repeat, pass, blocks: [true, pass] }),
    );
    const flips = blockFlips(rows);
    expect(flips.map((f) => [f.block, f.passes, f.repeats, f.flip])).toEqual([
      [0, 5, 5, 0],
      [1, 2, 5, 0.6],
    ]);
  });

  it('sets the repeats per block from the run-to-run variance and the floor', () => {
    const rows = simulate({
      cells: 4,
      conversations: 5,
      wordings: 2,
      repeats: 6,
      sd: { cell: 0, conversation: 0, wording: 0 },
      base: 0.5,
      seed: 3,
    });
    const analysis = analysePilot(rows, { iterations: 20, floor: 0.1 });
    const variance = analysis.noiseFloor.variance;
    expect(variance).toBeGreaterThan(0.2);
    // r = ceil(2 z^2 variance / floor^2), two versions compared.
    expect(analysis.noiseFloor.perBlock.repeats).toBe(
      Math.ceil((2 * 1.959963984540054 ** 2 * variance) / 0.01),
    );
    expect(analysis.noiseFloor.perBlock.floor).toBeLessThanOrEqual(0.1);
  });
});

describe('analysePilot on a control with planted variance', () => {
  it('recovers the planted shares inside the bootstrap interval on most seeds', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = seeds.map((seed) => {
      const rows = simulate({
        cells: 10,
        conversations: 10,
        wordings: 3,
        repeats: 5,
        sd: { cell: 0, conversation: 0.1, wording: 0.15 },
        base: 0.6,
        seed,
      });
      return analysePilot(rows, { iterations: 200, seed }).planted;
    });
    for (const planted of results) expect(planted).toBeDefined();
    const covered = (level: string) =>
      results.filter((p) => p?.levels.find((l) => l.level === level)?.recovered).length;
    // A 95% interval covers on most seeds; at least 6 of 8 per level.
    for (const level of ['cell', 'conversation', 'wording', 'repeat']) {
      expect(covered(level), level).toBeGreaterThanOrEqual(6);
    }
  }, 60_000);

  it('separates a wording-only source from a repeat-only source', () => {
    const wordingOnly = simulate({
      cells: 6,
      conversations: 10,
      wordings: 3,
      repeats: 5,
      sd: { cell: 0, conversation: 0, wording: 0.25 },
      base: 0.5,
      seed: 11,
    });
    const analysis = analysePilot(wordingOnly, { iterations: 100 });
    const share = (name: string) => analysis.pooled.levels.find((l) => l.level === name)?.share ?? 0;
    expect(share('wording')).toBeGreaterThan(share('conversation'));
    expect(share('wording')).toBeGreaterThan(0.15);
    expect(analysis.planted?.levels.find((l) => l.level === 'wording')?.recovered).toBe(true);
  }, 30_000);

  it('reports no planted check when a run does not state its chance', () => {
    const rows = simulate({
      cells: 2,
      conversations: 3,
      wordings: 1,
      repeats: 3,
      sd: { cell: 0, conversation: 0, wording: 0 },
      base: 0.5,
      seed: 2,
    });
    const { planted: _dropped, ...first } = rows[0] as PilotObservation;
    expect(analysePilot([first, ...rows.slice(1)], { iterations: 10 }).planted).toBeUndefined();
  });
});

describe('analysePilot input', () => {
  it('leaves out runs that did not complete and counts them', () => {
    const rows = [row({}), row({ repeat: 1 }), row({ repeat: 2, status: 'failed', pass: false })];
    const analysis = analysePilot(rows, { iterations: 10 });
    expect(analysis.observations).toBe(2);
    expect(analysis.errored).toBe(1);
  });

  it('refuses a pilot where no run completed', () => {
    expect(() => analysePilot([row({ status: 'failed' })])).toThrow(/no run completed/);
  });
});

describe('wording sensitivity under repeat noise', () => {
  it('reads the F distribution as the reference tables do', () => {
    // Upper 5% points of F: (1, 10) 4.9646, (3, 10) 3.7083, (2, 20) 3.4928; upper 1% of (4, 30) 4.0179.
    expect(fSurvival(4.9646, 1, 10)).toBeCloseTo(0.05, 4);
    expect(fSurvival(3.7083, 3, 10)).toBeCloseTo(0.05, 4);
    expect(fSurvival(3.4928, 2, 20)).toBeCloseTo(0.05, 4);
    expect(fSurvival(4.0179, 4, 30)).toBeCloseTo(0.01, 4);
    expect(fSurvival(0, 2, 20)).toBe(1);
  });

  const noisy = (wording: number, seed: number) =>
    analysePilot(
      simulate({
        cells: 10,
        conversations: 10,
        wordings: 3,
        repeats: 5,
        sd: { cell: 0, conversation: 0, wording },
        base: 0.5,
        seed,
      }),
      { iterations: 10 },
    );

  it('does not flag a noisy agent whose wordings do not matter, though its ranges are wide', () => {
    const analysis = noisy(0, 21);
    expect(Math.max(...analysis.cells.map((cell) => cell.wording.maxRange ?? 0))).toBeGreaterThan(0.2);
    expect(analysis.wording.flagged).toEqual([]);
  }, 30_000);

  it('flags the cells of a noisy agent whose wordings do matter', () => {
    const analysis = noisy(0.25, 22);
    expect(analysis.wording.flagged.length).toBeGreaterThanOrEqual(5);
  }, 30_000);
});
