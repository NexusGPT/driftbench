import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('a tool failure probe', () => {
  it('is followed by the same turn with the tool answering again, then the rest of the walk', () => {
    let continued = 0;
    for (const spec of suite.complete) {
      const at = spec.blocks.findIndex(
        (block) => block.when && 'injection' in block.when && block.when.injection.class === 'D8_tool_failure',
      );
      if (at < 0) continue;
      const failing = spec.blocks[at];
      const retry = spec.blocks[at + 1];
      expect(retry, `${spec.id} ends at its tool failure`).toBeDefined();
      const tool = Object.keys(failing?.given?.world?.tools ?? {})[0] as string;
      const said = failing?.when && 'injection' in failing.when ? failing.when.injection.user : undefined;
      expect(retry?.when && 'user' in retry.when ? retry.when.user : undefined).toBe(said);
      expect(retry?.given?.world?.tools?.[tool]?.error).toBeUndefined();
      expect(retry?.given?.world?.tools?.[tool]?.result).toBeDefined();
      expect(retry?.expect?.tools?.find((call) => call.label === tool)?.count).toBe(1);
      continued += 1;
    }
    expect(continued).toBeGreaterThan(0);
  }, 60_000);
});

describe('a clean walk in perturbed mode', () => {
  it('declares a tool failure the recovery stays from, with the turn answering again afterwards', () => {
    let declared = 0;
    for (const spec of suite.complete) {
      for (const perturbation of spec.perturbations ?? []) {
        if (perturbation.class !== 'D8_tool_failure') continue;
        declared += 1;
        const tool = Object.keys(perturbation.world?.tools ?? {})[0] as string;
        expect(perturbation.world?.tools?.[tool]?.error).toBeDefined();
        const turn = spec.blocks[perturbation.inject_at];
        expect(perturbation.user).toBe(turn?.when && 'user' in turn.when ? turn.when.user : undefined);
        expect(turn?.given?.world?.tools?.[tool]?.result).toBeDefined();
        expect(perturbation.expect?.stage).toBe(perturbation.recovery?.stage_after);
      }
    }
    expect(declared).toBeGreaterThan(0);
  }, 60_000);
});
