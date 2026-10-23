import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';

describe('a recovery is followed by the rest of the flow', () => {
  // On this map every probe of a goal shift is the last block of its walk (the recovery goes back to intake), so
  // no spec shows the agent going on after it, until a probe is placed where the recovery stays.
  it.each([306132888])(
    'has a spec that goes on after a goal shift probe on map %s',
    async (seed) => {
      const root = await mkdtemp(join(tmpdir(), 'generate-continued-'));
      try {
        const rendered = renderMap(hiddenSpec(seed));
        await mkdir(join(root, 'map'));
        for (const [key, name] of Object.entries(MAP_FILES))
          await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
        const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
        if (!loaded.ok) throw new Error(loaded.message);
        const suite = generateSuite(loaded.prepared, { mapPath: '../map.yaml', seed });
        const continues = suite.complete.some((spec) =>
          spec.blocks.some(
            (block, index) =>
              'injection' in block.when &&
              block.when.injection.class === 'D2_goal_shift' &&
              index < spec.blocks.length - 1,
          ),
        );
        expect(continues).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
