import { describe, expect, it } from 'vitest';
import { ACTS_ON, actsOn, buildPlan } from '../../src/index';
import { approvedFixture } from './support';

describe('a situation crossed only with atoms it can act on', () => {
  it('keeps every pairwise row to a target its situation values can act on', async () => {
    const map = await approvedFixture();
    const atom = new Map(map.atoms.map((entry) => [entry.id, entry]));
    const { plan, details } = buildPlan(map);
    const pairwise = plan.rows.filter((row) => row.id.startsWith('pairwise.'));
    expect(pairwise.length).toBeGreaterThan(0);
    const wrong = pairwise.filter((row) => {
      const target = atom.get(row.atomIds[0] as string);
      return (
        target !== undefined &&
        Object.entries(row.cell).some(([dimension, value]) => !actsOn(dimension, value, target))
      );
    });
    expect(wrong.map((row) => row.id)).toEqual([]);
    expect(details.tuples.covered).toBe(details.tuples.allowed);
  }, 120_000);

  it('lets a dead helper act on helpers and the routes to them, and nothing else', () => {
    expect(actsOn('estate_hazard', 'dead_helper', { kind: 'subagent' })).toBe(true);
    expect(
      actsOn('estate_hazard', 'dead_helper', { kind: 'route', fields: { targetKind: 'subagent' } }),
    ).toBe(true);
    expect(actsOn('estate_hazard', 'dead_helper', { kind: 'route', fields: { targetKind: 'skill' } })).toBe(
      false,
    );
    expect(actsOn('estate_hazard', 'dead_helper', { kind: 'gate' })).toBe(false);
    expect(actsOn('estate_hazard', 'no_hazard', { kind: 'gate' })).toBe(true);
    expect(Object.keys(ACTS_ON).sort()).toEqual([
      'deviation',
      'estate_hazard',
      'owner_signal',
      'session_state',
    ]);
  });
});
