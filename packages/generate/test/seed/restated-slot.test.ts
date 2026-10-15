import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

describe('a slot the user restates', () => {
  it('is asked for with one value just before the move, the move states another and expects the latest', async () => {
    const seed = 1;
    const hidden = hiddenSpec(seed);
    const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
    if (!source.prepared) throw new Error('the fictional map failed to load');
    const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed });
    const restated = suite.complete.filter((spec) => spec.id.startsWith('gen-restated-'));
    expect(restated.length).toBeGreaterThan(0);
    for (const spec of restated) {
      const at = spec.blocks.findIndex((block) => block.id?.endsWith('-restated'));
      const asked = spec.blocks[at]?.expect?.tools?.find((tool) => tool.count === 1);
      const move = spec.blocks[at + 1]?.expect?.tools?.find((tool) => tool.label === asked?.label);
      expect(move?.count, spec.id).toBe(1);
      // The request runs the tool as the move does, with one field changed; the move holds the latest value.
      const changed = Object.keys(move?.input ?? {}).filter(
        (key) => JSON.stringify(asked?.input?.[key]) !== JSON.stringify(move?.input?.[key]),
      );
      expect(changed, spec.id).toHaveLength(1);
      expect(asked?.input_closed, spec.id).toBe(move?.input_closed);
      const field = changed[0] as string;
      const when = spec.blocks[at + 1]?.when;
      expect(when && 'user' in when ? when.user : '', spec.id).toContain(String(move?.input?.[field]));
      // The request's reply reports the returned fields, as the move's reply does.
      expect(spec.blocks[at]?.expect?.must?.length ?? 0, spec.id).toBeGreaterThan(0);
    }
  }, 180_000);
});
