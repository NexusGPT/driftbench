import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const prepared = source.prepared;
const suite = generateSuite(prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('a family over the persona axis', () => {
  it('has each user say their approved persona phrase after the first move, and expects the same', () => {
    const said = new Set(
      suite.complete.flatMap((spec) =>
        spec.blocks.flatMap((block) => (block.when && 'user' in block.when ? [block.when.user] : [])),
      ),
    );
    const personas = prepared.phrases.filter((phrase) =>
      prepared.space.dimensions.some(
        (dimension) => dimension.id === phrase.dimension && dimension.kind === 'persona',
      ),
    );
    expect(personas.length).toBeGreaterThan(0);
    for (const phrase of personas) expect(said.has(phrase.text), phrase.text).toBe(true);
  }, 60_000);
});
