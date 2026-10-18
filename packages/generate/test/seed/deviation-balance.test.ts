import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVIATION_POOL, hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';

describe('deviation allocation after coverage', () => {
  it.each([5, 8, 20])(
    'balances actual probe blocks on seed %s without dropping coverage',
    async (seed) => {
      const root = await mkdtemp(join(tmpdir(), 'generate-balance-'));
      try {
        const hidden = hiddenSpec(seed);
        const rendered = renderMap(hidden);
        await mkdir(join(root, 'map'));
        for (const [key, name] of Object.entries(MAP_FILES))
          await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
        const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
        if (!loaded.ok) throw new Error(loaded.message);
        const suite = generateSuite(loaded.prepared, { mapPath: '../map.yaml', seed });
        const counts = new Map<string, number>(DEVIATION_POOL.map((cls) => [cls, 0]));
        for (const spec of suite.complete)
          for (const block of spec.blocks)
            if ('injection' in block.when) {
              const cls = block.when.injection.class;
              counts.set(cls, (counts.get(cls) ?? 0) + 1);
            }
        expect(counts.size).toBeGreaterThan(1);
        expect(
          Math.max(...counts.values()) / Math.min(...counts.values()),
          JSON.stringify([...counts]),
        ).toBeLessThanOrEqual(3);
        expect(suite.report.coverage.actual.every((level) => level.covered === level.allowed)).toBe(true);
        expect(suite.report.invalid).toEqual([]);
        expect(suite.report.lint).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
