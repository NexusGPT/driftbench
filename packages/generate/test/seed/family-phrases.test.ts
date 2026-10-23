import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { buildTaskInputs, generateSuite } from '../../src';
import { loadApprovedMap } from '../../src/enumerate/load';

describe('the phrases of a metamorphic family', () => {
  // A value with two or more approved phrases is said by a complete metamorphic family. The reducer cuts a family at the
  // end like any walk, so a block whose phrase no written family holds is kept, even when a written spec says the text.
  it('are kept for every value with two or more phrases, in the suite with tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generate-family-phrases-'));
    try {
      const rendered = renderMap(hiddenSpec(14));
      await mkdir(join(root, 'map'));
      for (const [key, name] of Object.entries(MAP_FILES))
        await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
      const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
      if (!loaded.ok) throw new Error(loaded.message);
      const tasks = await buildTaskInputs(loaded.prepared, join(root, 'map'), { n: 1, seed: 14 });
      const suite = generateSuite(loaded.prepared, { seed: 14, mapPath: '../map.yaml', tasks: tasks.inputs });
      const counts = new Map<string, number>();
      for (const phrase of loaded.prepared.phrases)
        counts.set(
          `${phrase.dimension}=${phrase.value}`,
          (counts.get(`${phrase.dimension}=${phrase.value}`) ?? 0) + 1,
        );
      const wanted = [...counts].filter(([, count]) => count >= 2).map(([key]) => key);
      const held = new Set(
        suite.complete.flatMap((spec) => {
          const meta = spec.metadata?.generated as
            | {
                metamorphic?: unknown;
                blocks?: Array<{ phrase?: { dimension: string; value: string } | null }>;
              }
            | undefined;
          return meta?.metamorphic
            ? (meta.blocks ?? []).flatMap((entry) =>
                entry.phrase ? [`${entry.phrase.dimension}=${entry.phrase.value}`] : [],
              )
            : [];
        }),
      );
      expect(wanted.filter((key) => !held.has(key))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});
