import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

const hidden = hiddenSpec(1);
const source = await generateFrom(hidden, renderMap(hidden), 1, {}, { once: true });
if (!source.prepared) throw new Error('the fictional map failed to load');
const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 3, seed: 1 });

describe('the cell of a deviation probe', () => {
  it('records the stage the class is said at, not the stage its recovery goes to', () => {
    let probes = 0;
    for (const spec of suite.complete) {
      const records = (spec.metadata?.generated as { blocks?: Array<{ cell: Record<string, string> }> })
        ?.blocks;
      spec.blocks.forEach((block, index) => {
        const injected = block.when && 'injection' in block.when ? block.when.injection.class : undefined;
        if (!injected || injected === 'D8_tool_failure' || index === 0) return;
        const before = spec.blocks[index - 1]?.expect?.stage;
        if (before === undefined) return;
        probes += 1;
        expect(records?.[index]?.cell.stage, `${spec.id} ${block.id}`).toBe(before);
      });
    }
    expect(probes).toBeGreaterThan(0);
  }, 60_000);
});
