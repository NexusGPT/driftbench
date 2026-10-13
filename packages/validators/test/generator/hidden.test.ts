import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApprovedMap, stageGraph } from '@agent-nexus/driftbench-generate';
import { validateSpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  DEVIATION_POOL,
  HIDDEN_SHAPE,
  hiddenSpec,
  intentsByText,
  readTurn,
} from '../../src/ladders/generator/hidden';
import { hiddenSpaceMap, MAP_FILES, renderMap } from '../../src/ladders/generator/render';

const FIXTURE = new URL('../../fixtures/generator/seed-1/', import.meta.url);
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

function inside(value: number, [low, high]: readonly [number, number]): boolean {
  return value >= low && value <= high;
}

async function writeMap(seed: number): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'vgen-test-'));
  const files = renderMap(hiddenSpec(seed));
  for (const [key, name] of Object.entries(MAP_FILES)) {
    await writeFile(join(dir, name), files[key as keyof typeof files]);
  }
  return { dir, path: join(dir, MAP_FILES.map) };
}

describe('the hidden specification', () => {
  it('is the same on the same seed and differs between seeds', () => {
    expect(hiddenSpec(7)).toEqual(hiddenSpec(7));
    const shapes = new Set(SEEDS.map((seed) => JSON.stringify(hiddenSpec(seed))));
    expect(shapes.size).toBe(SEEDS.length);
  });

  it('draws S stages, B behaviours, T tools, C constraints and D deviations per flow inside the declared ranges', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      expect(inside(spec.stages.length, HIDDEN_SHAPE.stages)).toBe(true);
      expect(inside(spec.behaviours.length, HIDDEN_SHAPE.behaviours)).toBe(true);
      expect(inside(spec.tools.length, HIDDEN_SHAPE.tools)).toBe(true);
      expect(inside(spec.constraints.length, HIDDEN_SHAPE.constraints)).toBe(true);
      expect(inside(spec.flows.length, HIDDEN_SHAPE.flows)).toBe(true);
      for (const flow of spec.flows) {
        expect(flow.deviations.every((cls) => DEVIATION_POOL.includes(cls))).toBe(true);
      }
      // The three flows together require every class, so every class has its items on every seed.
      expect(new Set(spec.flows.flatMap((flow) => flow.deviations))).toEqual(new Set(DEVIATION_POOL));
      expect(spec.tools.map((tool) => tool.role)).toEqual(['read', 'list', 'write']);
      expect(spec.recoveries.map((recovery) => recovery.class)).toEqual([...DEVIATION_POOL]);
      for (const path of spec.paths) {
        path.stages.slice(1).forEach((to, index) => {
          expect(
            spec.transitions.some((edge) => edge.from === path.stages[index] && edge.to === to),
            `${path.id} ${to}`,
          ).toBe(true);
        });
      }
      for (const tool of spec.tools) {
        for (const property of [...tool.input, ...tool.output]) {
          if (property.type === 'enum') expect(property.members.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('gives one intent per phrase and a phrase to every move, data value and deviation class but a tool failure', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      const texts = spec.phrases.map((phrase) => phrase.text);
      expect(new Set(texts).size).toBe(texts.length);
      expect(intentsByText(spec).size).toBe(texts.length);
      const phrased = new Set(spec.phrases.map((phrase) => `${phrase.dimension}=${phrase.value}`));
      for (const edge of spec.transitions) expect(phrased.has(`stage_transition=${edge.id}`)).toBe(true);
      for (const value of spec.data) expect(phrased.has(`${value.dimension}=${value.id}`)).toBe(true);
      for (const cls of spec.deviations) {
        expect(phrased.has(`deviation=${cls}`)).toBe(cls !== 'D8_tool_failure');
      }
    }
  });

  it('reads a slot phrase back with the value it states', () => {
    const spec = hiddenSpec(1);
    const read = spec.tools.find((tool) => tool.role === 'read');
    const property = read?.input[0];
    if (!read || property?.type !== 'enum') throw new Error('no read tool');
    const text = `It is about a ${property.members[2]} item, please look it up.`;
    expect(readTurn(spec, text)).toEqual({
      intent: { kind: 'transition', edge: `${spec.goal}-to-check` },
      slots: { [read.slot]: property.members[2] },
    });
    expect(readTurn(spec, 'Something nobody says.')).toBeUndefined();
  });

  it('computes the concrete value of every partition from the schema bounds', () => {
    const spec = hiddenSpec(1);
    const tool = spec.tools[0];
    const integer = tool?.input.find((property) => property.type === 'integer');
    if (integer?.type !== 'integer') throw new Error('the first tool has no integer input');
    const value = (partition: string) =>
      spec.data.find(
        (entry) => entry.tool === tool?.name && entry.field === integer.name && entry.partition === partition,
      );
    expect(value('below-minimum')).toMatchObject({ value: integer.minimum - 1, invalid: true });
    expect(value('at-minimum')).toMatchObject({ value: integer.minimum, invalid: false });
    expect(value('at-maximum')).toMatchObject({ value: integer.maximum, invalid: false });
    expect(value('above-maximum')).toMatchObject({ value: integer.maximum + 1, invalid: true });
  });
});

describe('the rendered map', () => {
  it('renders seed 1 byte for byte as the fixture', async () => {
    const spec = hiddenSpec(1);
    const files = renderMap(spec);
    for (const [key, name] of Object.entries(MAP_FILES)) {
      expect(files[key as keyof typeof files], name).toBe(await readFile(new URL(name, FIXTURE), 'utf8'));
    }
    expect(JSON.parse(await readFile(new URL('hidden.json', FIXTURE), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(spec)),
    );
  });

  it('is accepted by the generator as an approved map, every quote found, on seeds 1 to 8', async () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { dir, path } = await writeMap(seed);
      try {
        const loaded = await loadApprovedMap(path);
        expect(loaded.ok ? 'ok' : `${loaded.code} ${loaded.message} ${JSON.stringify(loaded.issues)}`).toBe(
          'ok',
        );
        if (!loaded.ok) continue;
        const spec = hiddenSpec(seed);
        const graph = stageGraph(loaded.prepared);
        expect(graph?.start).toBe(spec.start);
        expect(graph?.edges.map((edge) => edge.id).sort()).toEqual(
          spec.transitions.map((edge) => edge.id).sort(),
        );
        expect(loaded.prepared.axisMap.dimensions.map((dimension) => dimension.id).sort()).toEqual(
          hiddenSpaceMap(spec)
            .dimensions.map((dimension) => dimension.id)
            .sort(),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('builds the hidden cells as a valid space map: the written constraints and the pairs no path reaches', () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      const map = hiddenSpaceMap(spec);
      const result = validateSpaceMap(map);
      expect(result.ok ? 'ok' : JSON.stringify(result.errors)).toBe('ok');
      expect(map.constraints.slice(0, spec.constraints.length).map((entry) => entry.forbid)).toEqual(
        spec.constraints.map((entry) => entry.forbid),
      );
      // No deviation at the start stage: nothing is said there without a class.
      expect(map.constraints).toContainEqual({
        forbid: { deviation: 'none', stage: spec.start },
        reason: expect.stringContaining('no path of the hidden map'),
      });
    }
  });
});
