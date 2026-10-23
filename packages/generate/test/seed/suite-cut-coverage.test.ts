import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Spec } from '@agent-nexus/driftbench-core';
import { obligationSpecOf, SuiteIndex, stageBookOf } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { cellsOf, generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { PreparedMap } from '../../src/seed/map';
import { buildTaskInputs } from '../../src/seed/tasks';

/**
 * The whole-suite tail cut may shorten and drop walks, never lose what the suite is for. This reads two suites of the
 * same map and seed, written without the pass and with it, and lists what the second no longer covers:
 * - every obligation of the shared ruling (a class probed per path, a declared perturbation per path and class, a pair of
 *   twins per path and context axis) that the first holds;
 * - every metamorphic relation: each family of the first is in the second with all its variants, and its variants
 *   still say different things at some turn;
 * - every message the first says;
 * - every coverage tuple at t = 2 and t = 3.
 */

type Suite = {
  specs: Spec[];
  prepared: PreparedMap;
  declared: { channels: Set<string>; personas: Set<string> };
};

const text = (block: Spec['blocks'][number]): string[] => {
  const when = block.when;
  if (when === undefined) return [];
  if ('user' in when) return [when.user];
  if ('burst' in when) return when.burst;
  return when.injection.user === undefined ? [] : [when.injection.user];
};

/** The obligation keys a suite holds: what it would lose if every spec went. */
function obligations(suite: Suite): Set<string> {
  const index = new SuiteIndex(suite.declared);
  const book = stageBookOf(suite.specs);
  for (const spec of suite.specs) index.add(obligationSpecOf(spec, book));
  return new Set(index.lostBy(suite.specs.map((spec) => ({ spec: spec.id }))).lost);
}

/** Per family id: its variants, and the number of turn positions where its variants say different things. */
function families(specs: readonly Spec[]): Map<string, { variants: Set<number>; contrast: number }> {
  const out = new Map<string, { variants: Set<number>; at: Map<number, Set<string>> }>();
  for (const spec of specs) {
    const meta = (
      spec.metadata?.generated as { metamorphic?: { family: string; variant: number } } | undefined
    )?.metamorphic;
    if (!meta) continue;
    const family = out.get(meta.family) ?? { variants: new Set<number>(), at: new Map() };
    family.variants.add(meta.variant);
    spec.blocks.forEach((block, index) => {
      const said = family.at.get(index) ?? new Set<string>();
      for (const message of text(block)) said.add(message);
      family.at.set(index, said);
    });
    out.set(meta.family, family);
  }
  return new Map(
    [...out].map(([id, family]) => [
      id,
      { variants: family.variants, contrast: [...family.at.values()].filter((said) => said.size > 1).length },
    ]),
  );
}

/** What `after` covers less than `before`, as sentences: empty when it covers at least as much. */
export function coverageLost(before: Suite, after: Suite): string[] {
  const lost: string[] = [];
  const kept = obligations(after);
  for (const key of obligations(before))
    if (!key.startsWith('family|') && !kept.has(key)) lost.push(`obligation ${key}`);
  const had = families(before.specs);
  const has = families(after.specs);
  for (const [id, family] of had) {
    const now = has.get(id);
    if (!now) {
      lost.push(`relation ${id}: no variant left`);
      continue;
    }
    for (const variant of family.variants)
      if (!now.variants.has(variant)) lost.push(`relation ${id}: variant ${variant} is gone`);
    if (family.contrast > 0 && now.contrast === 0)
      lost.push(`relation ${id}: the variants say the same thing`);
  }
  const said = new Set(after.specs.flatMap((spec) => spec.blocks.flatMap(text)));
  for (const message of new Set(before.specs.flatMap((spec) => spec.blocks.flatMap(text))))
    if (!said.has(message)) lost.push(`message "${message}"`);
  for (const t of [2, 3]) {
    const covered = new Set(
      cellsOf(after.prepared, after.specs, t)
        .filter((cell) => cell.count > 0)
        .map((cell) => JSON.stringify(cell.values)),
    );
    for (const cell of cellsOf(before.prepared, before.specs, t))
      if (cell.count > 0 && !covered.has(JSON.stringify(cell.values)))
        lost.push(`tuple t=${t} ${JSON.stringify(cell.values)}`);
  }
  return lost;
}

async function suites(seed: number): Promise<{ off: Suite; on: Suite; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'suite-cut-coverage-'));
  const hidden = hiddenSpec(seed);
  const rendered = renderMap(hidden);
  await mkdir(join(root, 'map'));
  for (const [key, name] of Object.entries(MAP_FILES))
    await writeFile(join(root, 'map', name), rendered[key as keyof typeof rendered]);
  const loaded = await loadApprovedMap(join(root, 'map', MAP_FILES.map));
  if (!loaded.ok) throw new Error(loaded.message);
  const tasks = await buildTaskInputs(loaded.prepared, join(root, 'map'), { n: 1, seed });
  const options = { seed, mapPath: '../map.yaml', tasks: tasks.inputs };
  const declared = {
    channels: new Set(hidden.channels),
    personas: new Set(hidden.personas.map((entry) => `persona:${entry.id}`)),
  };
  return {
    root,
    off: {
      specs: generateSuite(loaded.prepared, { ...options, settle: false }).complete,
      prepared: loaded.prepared,
      declared,
    },
    on: {
      specs: generateSuite(loaded.prepared, { ...options, settle: true }).complete,
      prepared: loaded.prepared,
      declared,
    },
  };
}

describe('the whole-suite tail cut covers at least what the cut at write time covers', () => {
  it.each([1, 2, 3])(
    'on hidden map %s: every obligation, relation, message and tuple',
    async (seed) => {
      const { off, on, root } = await suites(seed);
      try {
        // The pass did something: the settled suite is not the unsettled one.
        const blocks = (suite: Suite) => suite.specs.reduce((sum, spec) => sum + spec.blocks.length, 0);
        expect(blocks(on)).toBeLessThan(blocks(off));
        expect(coverageLost(off, on)).toEqual([]);
        // The check reads something: a suite and itself lose nothing, and the metamorphic relations are there to read.
        expect(coverageLost(off, off)).toEqual([]);
        expect(families(off.specs).size).toBeGreaterThan(0);
        expect(obligations(off).size).toBeGreaterThan(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it('names a relation whose last variant is dropped (red-first mutant)', async () => {
    const { off, on, root } = await suites(1);
    try {
      const family = [...families(on.specs)].find(([, entry]) => entry.variants.size >= 2);
      if (!family) throw new Error('the settled suite has no family of two variants');
      const [id, entry] = family;
      const last = Math.max(...entry.variants);
      const mutant = {
        ...on,
        specs: on.specs.filter((spec) => {
          const meta = (
            spec.metadata?.generated as { metamorphic?: { family: string; variant: number } } | undefined
          )?.metamorphic;
          return !(meta?.family === id && meta.variant === last);
        }),
      };
      expect(mutant.specs.length).toBe(on.specs.length - 1);
      expect(coverageLost(off, mutant)).toContain(`relation ${id}: variant ${last} is gone`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);

  it('names an obligation whose last holder is dropped (red-first mutant)', async () => {
    const { off, on, root } = await suites(1);
    try {
      const held = obligations(off);
      const key = [...held].find((entry) => entry.startsWith('perturb|') || entry.startsWith('inject|'));
      if (!key) throw new Error('the suite holds no probe or perturbation');
      const [, path, cls] = key.split('|');
      const mutant = {
        ...on,
        specs: on.specs.filter((spec) => {
          const generated = spec.metadata?.generated as { path?: string } | undefined;
          if (generated?.path !== path) return true;
          const declares = (spec.perturbations ?? []).some((entry) => entry.class === cls);
          const injects = spec.blocks.some(
            (block) =>
              block.when !== undefined && 'injection' in block.when && block.when.injection.class === cls,
          );
          return !(declares || injects);
        }),
      };
      expect(coverageLost(off, mutant).some((entry) => entry.startsWith('obligation '))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
});
