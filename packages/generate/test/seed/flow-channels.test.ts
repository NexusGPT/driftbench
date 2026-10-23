import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { loadApprovedMap } from '../../src/enumerate/load';

describe('the channels of a flow', () => {
  // On hidden map 14 the two behaviours of the new-request flow are web only, and the other behaviours belong to other
  // flows, so no behaviour completes new-request on messaging: the cell is no allowed full cell.
  it('allow no flow whose every behaviour is kept off the channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generate-flow-channels-'));
    try {
      const rendered = renderMap(hiddenSpec(14));
      await mkdir(join(root, 'map'));
      for (const [key, name] of Object.entries(MAP_FILES))
        await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
      const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
      if (!loaded.ok) throw new Error(loaded.message);
      const { space, feasibility } = loaded.prepared;
      const at = (id: string) => space.dimensions.findIndex((dimension) => dimension.id === id);
      const flow = at('flow');
      const channel = at('channel');
      const value = (dimension: number, id: string) => space.dimensions[dimension]?.index.get(id) as number;
      expect(
        feasibility.allowed([
          [flow, value(flow, 'new-request')],
          [channel, value(channel, 'messaging')],
        ]),
      ).toBe(false);
      expect(
        feasibility.allowed([
          [flow, value(flow, 'new-request')],
          [channel, value(channel, 'web')],
        ]),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
