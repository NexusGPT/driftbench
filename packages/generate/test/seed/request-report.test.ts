import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

// Seed 3 has a read tool no flow calls, so no states relation says how a reply states its returned fields.
// Its prompt states every returned field one way ("<tool label with spaces> says <field> is <value>."), and
// the map's states relations of the other tools show that form.
const SEED = 3;

describe('a request turn that runs a tool', () => {
  it('reads every returned field the reply states, in the form the map states other tools with', async () => {
    const hidden = hiddenSpec(SEED);
    const tool = hidden.tools.find(
      (entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect,
    );
    if (!tool) throw new Error(`seed ${SEED} has no tool that no flow calls`);
    const source = await generateFrom(hidden, renderMap(hidden), SEED, {}, { once: true });
    if (!source.prepared)
      throw new Error(`the fictional map failed to load: ${JSON.stringify(source.refused)}`);
    const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed: SEED });
    const label = tool.name.replace(/_/g, ' ');
    let checked = 0;
    for (const spec of suite.complete) {
      const answer = spec.given?.world?.tools?.[tool.name]?.result as Record<string, unknown> | undefined;
      for (const block of spec.blocks) {
        const runs = (block.expect?.tools ?? []).some((call) => call.label === tool.name && call.count !== 0);
        if (!runs) continue;
        checked += 1;
        // The tool answers from the Given, so the reply has facts to state; each one is a must of the turn.
        expect(answer, `${spec.id} ${block.id}`).toBeDefined();
        const must = (block.expect?.must ?? []).map((pattern) => new RegExp(pattern));
        for (const field of tool.output) {
          const said = `${label} says ${field.name} is ${String(answer?.[field.name])}.`;
          expect(
            must.some((pattern) => pattern.test(said)),
            `${spec.id} ${block.id} reads "${said}"`,
          ).toBe(true);
          // The opposite yes or no fails the turn.
          if (field.type === 'boolean') {
            const flipped = `${label} says ${field.name} is ${String(!answer?.[field.name])}.`;
            expect(must.some((pattern) => pattern.test(flipped))).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 180_000);
});
