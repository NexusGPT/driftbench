import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { loadApprovedMap } from '../../src/enumerate/load';
import { scenarioDraft } from '../../src/seed/seed-drafts';

describe('the stages a walk reaches', () => {
  // On this map the two behaviours of the new-request flow are web only and the others are kept off the stage done, so a
  // walk to done on messaging has no behaviour to complete it with, yet a spec may cover no behaviour.
  it('are not refused for want of a behaviour the cell does not name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generate-stages-'));
    try {
      const rendered = renderMap(hiddenSpec(14));
      await mkdir(join(root, 'map'));
      for (const [key, name] of Object.entries(MAP_FILES))
        await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
      const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
      if (!loaded.ok) throw new Error(loaded.message);
      const prepared = loaded.prepared;
      const path = prepared.relations.paths.find((entry) => entry.id === 'new-request-full');
      const channel = prepared.space.dimensions.findIndex((dimension) => dimension.kind === 'channel');
      const messaging = prepared.space.dimensions[channel]?.index.get('messaging');
      if (!path || messaging === undefined) throw new Error('missing path or channel');
      const built = scenarioDraft(
        prepared,
        { seed: 14, t: 2, max: 1000 },
        'gen-metamorphic-900-2',
        'metamorphic',
        '',
        [[channel, messaging]],
        { preferred: [path], others: [] },
      );
      expect('draft' in built ? '' : built.reasons.join('; ')).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
