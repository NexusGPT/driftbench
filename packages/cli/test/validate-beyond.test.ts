import { defineLadder, registeredLadders, runSeeds, seedSpecs } from '@agent-nexus/driftbench-validators';
import { describe, expect, it } from 'vitest';
import { bankLadder } from '../../validators/test/support';
import { BEYOND_NOTE, splitBeyond } from '../src/commands/validate-beyond';

describe('the levels measured beyond the first failing level', () => {
  it('moves them to their own section, shows them as not run in the rows, keeps the level', async () => {
    const { ladder } = bankLadder([2]);
    const full = await runSeeds(ladder, seedSpecs([1, 2]), undefined, { full: true });
    const { report, beyond } = splitBeyond(full);
    // Seed 2 fails level 1: its level 2 was measured beyond; seed 1 fails level 2: nothing beyond.
    expect(report.level).toBe(full.level);
    expect(report.seeds.map((run) => run.level)).toEqual(full.seeds.map((run) => run.level));
    expect(report.seeds.map((run) => run.failing?.id)).toEqual(full.seeds.map((run) => run.failing?.id));
    expect(report.seeds[1]?.rows[1]).toMatchObject({ level: 2, observed: null, pass: null, itemCount: null });
    expect(report.seeds[1]?.rows[1]).not.toHaveProperty('bank');
    expect(report.seeds[1]?.rows[1]).not.toHaveProperty('beyond');
    expect(report.seeds[0]?.rows[1]).toMatchObject({ level: 2, pass: false });
    expect(beyond.note).toBe(BEYOND_NOTE);
    expect(beyond.seeds).toHaveLength(1);
    expect(beyond.seeds[0]).toMatchObject({ seed: 2, firstFailingLevel: 1 });
    const level = beyond.seeds[0]?.levels[0];
    expect(level).toMatchObject({ level: 2, id: 'deep', metThreshold: false, itemCount: 1 });
    // Not a verdict: the section never carries a `pass` field a reader could take for one.
    expect(level).not.toHaveProperty('pass');
    expect(level?.bank?.length).toBeGreaterThan(0);
  });

  it('leaves a stopping run as it is: nothing was measured beyond', async () => {
    const { ladder } = bankLadder([2]);
    const stopping = await runSeeds(ladder, seedSpecs([1, 2]));
    const { report, beyond } = splitBeyond(stopping);
    expect(report).toEqual(stopping);
    expect(beyond.seeds).toEqual([]);
  });

  it('marks the report of a ladder that reports them apart, and only that one', async () => {
    const { ladder } = bankLadder([2]);
    expect(await runSeeds(ladder, seedSpecs([1]))).not.toHaveProperty('beyondApart');
    const apart = defineLadder({ ...ladder, beyondApart: true });
    expect((await runSeeds(apart, seedSpecs([1]))).beyondApart).toBe(true);
  });

  it('is declared by the estate ladder only, among the registered ladders', () => {
    const apart = Object.entries(registeredLadders())
      .filter(([, ladder]) => ladder.beyondApart)
      .map(([name]) => name);
    expect(apart).toEqual(['estate']);
  });
});
