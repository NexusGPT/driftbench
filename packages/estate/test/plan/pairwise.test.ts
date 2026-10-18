import { gridSize, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { pairwiseCells, toEstateSpaceMap } from '../../src/index';
import { approvedFixture } from './support';

const OPTIONS = { t: 2, seed: 1, maxRows: 100_000 };

async function fixtureSpace(): Promise<SpaceMap> {
  return toEstateSpaceMap(await approvedFixture());
}

describe('pairwise cells over the situation axes', () => {
  it('covers every allowed pair with one target atom per row, far below the full grid', async () => {
    const space = await fixtureSpace();
    const result = pairwiseCells(space, OPTIONS);
    expect(result.covered).toBe(result.allowed);
    expect(result.cells.length).toBeLessThan(gridSize(space) / 1_000_000);
    const targets = space.dimensions.filter((dimension) => dimension.id.startsWith('atoms.'));
    const atoms = targets.flatMap((dimension) => dimension.values.map((value) => value.id));
    const deviations = space.dimensions.find((dimension) => dimension.id === 'deviation')?.values ?? [];
    expect(result.cells.length).toBeGreaterThanOrEqual(atoms.length * deviations.length);
    const pairs = new Set(result.cells.map((cell) => `${cell.atom}|${cell.situation.deviation}`));
    for (const atom of atoms)
      for (const value of deviations) expect(pairs.has(`${atom}|${value.id}`)).toBe(true);
    for (const cell of result.cells) {
      expect(cell.dimension).toBe(`atoms.${cell.atom.split('.')[0]}`);
      expect(Object.keys(cell.situation)).toEqual(result.situations);
    }
  }, 60_000);

  it('keeps every constraint: no fresh session meets a mid-task compaction, a dead helper or a stale tracker', async () => {
    const result = pairwiseCells(await fixtureSpace(), OPTIONS);
    const forbidden = ['compaction_mid_task', 'dead_helper', 'stale_tracker'];
    expect(
      result.cells.some(
        (cell) =>
          cell.situation.session_state === 'fresh' && forbidden.includes(cell.situation.estate_hazard ?? ''),
      ),
    ).toBe(false);
    expect(result.cells.some((cell) => cell.situation.session_state === 'fresh')).toBe(true);
  }, 60_000);

  it('carries a constraint on one target atom, and drops one that names atoms of two kinds', async () => {
    const space = await fixtureSpace();
    const atom = 'instruction.standing.r6-never-run-git-push-force';
    const constrained: SpaceMap = {
      ...space,
      constraints: [
        ...space.constraints,
        { forbid: { 'atoms.instruction': atom, deviation: 'none' }, reason: 'test' },
        {
          forbid: {
            'atoms.instruction': atom,
            'atoms.gate': 'instruction.standing.r3-read-a-file-before-you',
          },
          reason: 'two kinds',
        },
      ],
    };
    const result = pairwiseCells(constrained, OPTIONS);
    expect(result.dropped).toBe(1);
    expect(result.cells.some((cell) => cell.atom === atom && cell.situation.deviation === 'none')).toBe(
      false,
    );
    expect(result.cells.some((cell) => cell.atom === atom)).toBe(true);
    expect(result.covered).toBe(result.allowed);
  }, 60_000);

  it('needs fewer rows at t = 1, gives the same rows for the same seed, and refuses a space with no target', async () => {
    const space = await fixtureSpace();
    const one = pairwiseCells(space, { ...OPTIONS, t: 1 });
    const two = pairwiseCells(space, OPTIONS);
    expect(one.cells.length).toBeLessThan(two.cells.length);
    expect(pairwiseCells(space, OPTIONS)).toEqual(two);
    const bare: SpaceMap = {
      ...space,
      dimensions: space.dimensions.filter((d) => !d.id.startsWith('atoms.')),
    };
    expect(() => pairwiseCells(bare, OPTIONS)).toThrow(/no target atom/);
  }, 60_000);
});
