import { fileURLToPath } from 'node:url';
import {
  defineLadder,
  type FloorsFile,
  floorOf,
  ladderVersion,
  readFloors,
  registeredLadders,
} from '@agent-nexus/driftbench-validators';
import { describe, expect, it } from 'vitest';
import { committedFloorRun } from './support/committed-floor';

function fixture(failAt = 0) {
  const computed: number[] = [];
  const ladder = defineLadder({
    component: 'system',
    version: 5,
    levels: Array.from({ length: 11 }, (_, index) => ({
      id: `level-${index + 1}`,
      name: `Level ${index + 1}`,
      metric: 'items passing / items',
      threshold: 1,
      compute: () => {
        computed.push(index + 1);
        return { value: index + 1 === failAt ? 0 : 1, items: [] };
      },
    })),
  });
  return { ladder, computed };
}

const floors = (floor: number, version = 5): FloorsFile => ({
  version: 2,
  ladderVersion: { system: version },
  floors: { system: floor },
});

describe('committed ladder floor guard', () => {
  it('keeps an applicable regression floor for the registered system bank', () => {
    const ladder = registeredLadders().system;
    if (!ladder) throw new Error('missing system ladder');
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    expect(floorOf(readFloors(root), 'system', ladderVersion(ladder))).toBeGreaterThan(0);
  });

  it.each([2, 7])('computes exactly through the applicable floor %s', async (floor) => {
    const f = fixture();
    const { run } = await committedFloorRun(f.ladder, floors(floor), '/fixture');
    expect(f.computed).toEqual(Array.from({ length: floor }, (_, index) => index + 1));
    expect(run?.level).toBe(floor);
    expect(run?.top).toBe(11);
    expect(run?.rows.slice(floor).every((row) => row.observed === null)).toBe(true);
  });

  it('retains a failure below the floor', async () => {
    const f = fixture(3);
    const { floor, run } = await committedFloorRun(f.ladder, floors(7), '/fixture');
    expect(floor).toBe(7);
    expect(run?.level).toBe(2);
    expect(run?.failing?.id).toBe('level-3');
    expect(f.computed).toEqual([1, 2, 3]);
  });

  it.each([floors(0), floors(7, 4), { version: 2, ladderVersion: {}, floors: {} } as FloorsFile])(
    'does no computation when no floor applies: %j',
    async (file) => {
      const f = fixture();
      expect(await committedFloorRun(f.ladder, file, '/fixture')).toEqual({ floor: 0, run: null });
      expect(f.computed).toEqual([]);
    },
  );
});
