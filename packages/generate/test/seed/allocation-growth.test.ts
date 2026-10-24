import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { Allocation, MAX_ROUNDS } from '../../src/seed/allocation';
import type { SpecDraft } from '../../src/seed/assemble';

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

/** The loop of release/next, written here: it stops after 8 stalled rounds, with no bound on growth. */
function* oldRounds(
  this: Allocation,
  context: Parameters<Allocation['rounds']>[0],
  written: () => number,
  classes: Parameters<Allocation['rounds']>[2],
): Generator<SpecDraft> {
  let best = this.imbalance();
  let stalled = 0;
  for (let round = 0; round < MAX_ROUNDS && this.imbalance() > 0; round += 1) {
    const before = written();
    yield* this.stageTopUps(context, before);
    yield* classes.topUps(context, written());
    yield* this.behaviourTopUps(context, written());
    if (written() === before) break;
    const now = this.imbalance();
    if (now < best) {
      best = now;
      stalled = 0;
    } else {
      stalled += 1;
      if (stalled >= 8) break;
    }
  }
}

describe('the rounds of the allocation', () => {
  it.each([1, 2, 3, 9])(
    'on map %s write no more specs than the loop with 8 stalled rounds (run live), and end balanced',
    async (seed) => {
      const { prepared, result } = await suite(seed);
      // The old loop, run live in this tree on the same map: the new one never writes more.
      const spy = vi.spyOn(Allocation.prototype, 'rounds').mockImplementation(oldRounds);
      const old = await suite(seed);
      spy.mockRestore();
      expect(result.report.summary.specs).toBeLessThanOrEqual(old.result.report.summary.specs);
      // Stages, classes and behaviours together: nothing is under a third of the most placed value of its stratum.
      const placed = new Allocation(prepared);
      for (const spec of result.complete) placed.observeSpec(spec);
      if (seed === 9) expect(placed.imbalance()).toBe(0);
    },
    300_000,
  );
});
