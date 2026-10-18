import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

// On this fictional map three behaviours of five run on the web channel only, so a free draw of the
// channel leaves messaging with under a quarter of the specs.
const hidden = hiddenSpec(3);
const source = await generateFrom(hidden, renderMap(hidden), 3, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed: 3 });

describe('the context of a walk whose channel is free', () => {
  it('goes to the allowed channel placed on least, so no channel holds three times another', () => {
    const counts = new Map<string, number>();
    for (const spec of suite.complete)
      counts.set(spec.channel ?? '', (counts.get(spec.channel ?? '') ?? 0) + 1);
    const values = [...counts.values()];
    expect(values.length).toBeGreaterThan(1);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThanOrEqual(3);
    const total = values.reduce((sum, value) => sum + value, 0);
    const entropy = -values.reduce((sum, value) => sum + (value / total) * Math.log(value / total), 0);
    expect(entropy / Math.log(values.length)).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
