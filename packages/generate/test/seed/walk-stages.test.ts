import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { scenarioDraft } from '../../src/seed/seed-drafts';

describe('the stages a walk reaches', () => {
  // On this map the two behaviours of the new-request flow are web only and the others are kept off the stage done: two
  // constraints that exclude, together, every cell holding messaging and the stage done. No allowed full cell holds them,
  // so the oracle counts the walk impossible and the generator must not build it (Feasibility.allowed, as everywhere).
  it('are refused when no allowed full cell holds the cell and the stage together', async () => {
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
      expect('draft' in built).toBe(false);
      expect('draft' in built ? '' : built.reasons.join('; ')).toContain('constraints');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  // The context of a spec is drawn after its walk is built: a class the walk declares at a stage is one more pair the
  // channel must allow with it, not only each of the two alone.
  it('keep every declared class and the stage it is said at allowed with the channel the spec gets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generate-stages-'));
    try {
      const rendered = renderMap(hiddenSpec(14));
      await mkdir(join(root, 'map'));
      for (const [key, name] of Object.entries(MAP_FILES))
        await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
      const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
      if (!loaded.ok) throw new Error(loaded.message);
      const prepared = loaded.prepared;
      const dimensions = prepared.space.dimensions;
      const kind = (name: string) => dimensions.findIndex((dimension) => dimension.kind === name);
      const channel = kind('channel');
      const stage = kind('stage');
      const deviation = kind('deviation');
      const forbidden: string[] = [];
      const suite = generateSuite(prepared, { seed: 14, t: 2, mapPath: '../map.yaml' });
      for (const spec of suite.complete) {
        const cell = (spec.metadata?.generated as { cell?: Record<string, string> } | undefined)?.cell ?? {};
        const held = dimensions[channel]?.index.get(cell.channel ?? '');
        if (held === undefined) continue;
        const arrival = (index: number) =>
          [...spec.blocks.slice(0, index)].reverse().find((block) => block.expect?.stage !== undefined)
            ?.expect?.stage;
        const said = [
          ...spec.blocks.flatMap((block, index) =>
            block.when && 'injection' in block.when
              ? [[block.when.injection.class, arrival(index) ?? block.expect?.stage] as const]
              : [],
          ),
          ...(spec.perturbations ?? []).map(
            (perturbation) =>
              [
                perturbation.class,
                arrival(perturbation.inject_at ?? 0) ?? perturbation.expect?.stage,
              ] as const,
          ),
        ];
        for (const [classId, at] of said) {
          const picked = dimensions[deviation]?.index.get(classId);
          const where = dimensions[stage]?.index.get(at ?? '');
          if (picked === undefined || where === undefined) continue;
          if (
            !prepared.feasibility.allowed([
              [channel, held],
              [deviation, picked],
              [stage, where],
            ])
          )
            forbidden.push(`${spec.id}: ${classId} at ${at} on ${cell.channel}`);
        }
      }
      expect(forbidden).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});
