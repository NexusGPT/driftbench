import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { MAP_FILES, renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const SEVERAL = 'You may answer one message with several messages.';

async function suiteOf(seed: number, several: boolean) {
  const hidden = hiddenSpec(seed);
  const rendered = renderMap(hidden);
  if (several) {
    const map = parseDocument(rendered.map);
    const relations = map.get('relations') as { add: (value: unknown) => void };
    relations.add({
      kind: 'reply_count',
      per_turn: 'any',
      evidence: { source: `./${MAP_FILES.prompt}`, quote: SEVERAL },
      produced_by: 'model',
      approved: true,
    });
    rendered.map = map.toString();
    rendered.prompt = `${rendered.prompt.trimEnd()}\n\n${SEVERAL}\n`;
  }
  const source = await generateFrom(hidden, rendered, seed, {}, { once: true });
  if (!source.prepared)
    throw new Error(`the fictional map failed to load: ${JSON.stringify(source.refused)}`);
  return generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed }).complete;
}

describe('replies per user turn', () => {
  it('rules one reply per user turn on every spec when the map states no reply count', async () => {
    const specs = await suiteOf(1, false);
    expect(specs.length).toBeGreaterThan(0);
    const missing = specs.filter((spec) => spec.rules?.one_message_per_turn !== true).map((spec) => spec.id);
    expect(missing).toEqual([]);
  }, 180_000);

  it('leaves the rule to the nudge recovery when the map allows several replies', async () => {
    const specs = await suiteOf(1, true);
    const ruled = specs.filter((spec) => spec.rules?.one_message_per_turn === true);
    expect(ruled.length).toBeLessThan(specs.length);
    for (const spec of ruled) {
      const classes = [
        ...spec.blocks.flatMap((block) => ('injection' in block.when ? [block.when.injection.class] : [])),
        ...(spec.perturbations ?? []).map((entry) => entry.class),
      ];
      expect(classes, spec.id).toContain('D7_silence_or_burst');
    }
  }, 180_000);
});
