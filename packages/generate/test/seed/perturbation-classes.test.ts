import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

async function declared(seed: number): Promise<Set<string>> {
  const hidden = hiddenSpec(seed);
  const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
  if (!source.prepared) throw new Error('the fictional map failed to load');
  const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed });
  return new Set(suite.complete.flatMap((spec) => (spec.perturbations ?? []).map((entry) => entry.class)));
}

describe('perturbations of the stage graph walks', () => {
  it('declare every class a clean walk can take, whatever the seeded draws of the other walks', async () => {
    // The classes the draw of one perturbation per walk left out on these fictional maps.
    expect([...(await declared(9))]).toContain('D10_return');
    expect([...(await declared(11))]).toContain('D3_contradiction');
    const third = await declared(3);
    expect([...third]).toContain('D9_out_of_scope');
    expect([...third]).toContain('D2_goal_shift');
  }, 180_000);
});
