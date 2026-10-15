import { gridSize, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { actsOn, buildPlan, pairwiseCells, toEstateSpaceMap } from '../../src/index';
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
    const atom = 'instruction.standing.never-force-push';
    const constrained: SpaceMap = {
      ...space,
      constraints: [
        ...space.constraints,
        { forbid: { 'atoms.instruction': atom, deviation: 'none' }, reason: 'test' },
        {
          forbid: { 'atoms.instruction': atom, 'atoms.gate': 'gate.standing.read-a-file-before-editing-it' },
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

describe('situation relevance', () => {
  const atom = (kind: string, fields: Record<string, unknown> = {}) =>
    ({ kind, fields }) as Parameters<typeof actsOn>[2];

  it('crosses a situation value only with the atom kinds it acts on', () => {
    expect(actsOn('estate_hazard', 'dead_helper', atom('subagent'))).toBe(true);
    expect(actsOn('estate_hazard', 'dead_helper', atom('route', { targetKind: 'subagent' }))).toBe(true);
    expect(actsOn('estate_hazard', 'dead_helper', atom('route', { targetKind: 'skill' }))).toBe(false);
    expect(actsOn('estate_hazard', 'stale_tracker', atom('instruction'))).toBe(false);
    expect(actsOn('owner_signal', 'language_switch', atom('register'))).toBe(true);
    expect(actsOn('owner_signal', 'language_switch', atom('guard'))).toBe(false);
    // The first value of an axis and a value the table does not name act on every atom.
    expect(actsOn('estate_hazard', 'no_hazard', atom('guard'))).toBe(true);
    expect(actsOn('owner_signal', 'frustration', atom('tool'))).toBe(true);
  });

  it('forbids the pairs a value cannot act on and still covers every other allowed pair', () => {
    const space: SpaceMap = {
      version: 'test',
      agent: 'bakery',
      dimensions: [
        {
          id: 'estate_hazard',
          title: 'hazard',
          kind: 'data',
          values: [
            { id: 'no_hazard', title: 'none' },
            { id: 'stale_tracker', title: 'stale' },
          ],
        },
        {
          id: 'owner_signal',
          title: 'signal',
          kind: 'persona',
          values: [
            { id: 'go', title: 'go' },
            { id: 'stop', title: 'stop' },
          ],
        },
        { id: 'atoms.stage', title: 'stages', kind: 'behaviour', values: [{ id: 'stage.proof', title: 'proof' }] },
        { id: 'atoms.register', title: 'registers', kind: 'behaviour', values: [{ id: 'register.tone', title: 'tone' }] },
      ],
      constraints: [],
      prior: { kind: 'declared' },
    };
    const kinds: Record<string, string> = { 'stage.proof': 'stage', 'register.tone': 'register' };
    const result = pairwiseCells(space, {
      ...OPTIONS,
      acts: (dimension, value, id) => actsOn(dimension, value, atom(kinds[id] ?? '')),
    });
    expect(result.covered).toBe(result.allowed);
    const pairs = result.cells.map((cell) => `${cell.atom}|${cell.situation.estate_hazard}|${cell.situation.owner_signal}`);
    // A stale tracker meets only the stage; a stop meets the stage, never the register (a stop ends acts).
    expect(pairs.some((pair) => pair.startsWith('register.tone|stale_tracker'))).toBe(false);
    expect(pairs.some((pair) => pair.startsWith('register.tone|') && pair.endsWith('|stop'))).toBe(false);
    expect(pairs).toContain('stage.proof|stale_tracker|stop');
    expect(pairs.some((pair) => pair.startsWith('register.tone|no_hazard|go'))).toBe(true);
  });

  it('plans pairwise rows of the fixture only where the situation acts on the target', async () => {
    const map = await approvedFixture();
    const byId = new Map(map.atoms.map((entry) => [entry.id, entry]));
    const { plan } = buildPlan(map);
    const rows = plan.rows.filter((row) => row.id.startsWith('pairwise.'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const target = byId.get(row.atomIds[0] as string);
      if (!target) continue;
      for (const [dimension, value] of Object.entries(row.cell)) {
        if (!dimension.startsWith('atoms.')) expect(actsOn(dimension, value, target)).toBe(true);
      }
    }
  }, 60_000);
});
