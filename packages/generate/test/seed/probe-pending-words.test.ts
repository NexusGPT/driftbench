import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('a probe whose recovery stays on the pending stage', () => {
  it('is held to what the reply that reached the stage must never hold, such as narrated steps', async () => {
    const seed = 1;
    const hidden = hiddenSpec(seed);
    const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
    if (!source.prepared) throw new Error('the fictional map failed to load');
    const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed });
    const questions = new Map(hidden.stages.map((stage) => [stage.id, escapeText(stage.question)]));
    const missing: string[] = [];
    let probes = 0;
    for (const spec of suite.complete) {
      spec.blocks.forEach((block, index) => {
        // A tool failure is the walk's own turn with the tool failing: its own Then, not a detour.
        if (!('injection' in block.when) || block.when.injection.class === 'D8_tool_failure' || index === 0)
          return;
        const previous = spec.blocks[index - 1];
        const stage = block.expect?.stage;
        // Only a probe that stays where the walk's move left the conversation.
        if (stage === undefined || stage === hidden.start || previous?.expect?.stage !== stage) return;
        if (!(previous.expect?.must ?? []).includes(questions.get(stage) ?? '')) return;
        probes += 1;
        const mustNot = block.expect?.must_not ?? [];
        if (!mustNot.includes('Step [0-9]+:')) missing.push(`${spec.id}#${block.id}`);
      });
    }
    expect(probes).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  }, 180_000);
});
