import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { Allocation } from '../../src/seed/allocation';

/** Specs written by the allocation rounds of release/next (8 stalled rounds only), measured on these maps. */
const OLD_SPECS: Record<number, number> = { 1: 516, 2: 331, 3: 320, 9: 1350 };

async function suite(seed: number) {
  const root = await mkdtemp(join(tmpdir(), 'allocation-growth-'));
  try {
    const rendered = renderMap(hiddenSpec(seed));
    await mkdir(join(root, 'map'));
    for (const [key, name] of Object.entries(MAP_FILES))
      await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
    const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
    if (!loaded.ok) throw new Error(loaded.message);
    return {
      prepared: loaded.prepared,
      result: generateSuite(loaded.prepared, { mapPath: '../map.yaml', seed }),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('the rounds of the allocation', () => {
  it.each([1, 2, 3, 9])(
    'on map %s write no more specs than the loop with 8 stalled rounds, and end balanced',
    async (seed) => {
      const { prepared, result } = await suite(seed);
      expect(result.report.summary.specs).toBeLessThanOrEqual(OLD_SPECS[seed] as number);
      // Stages, classes and behaviours together: nothing is under a third of the most placed value of its stratum.
      const placed = new Allocation(prepared);
      for (const spec of result.complete) placed.observeSpec(spec);
      if (seed === 9) expect(placed.imbalance()).toBe(0);
    },
    300_000,
  );
});
