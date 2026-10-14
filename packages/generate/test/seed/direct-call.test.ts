import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

// Seed 3 has a read tool no flow calls: a user asks for it directly, with one argument.
const SEED = 3;

async function directCalls(withDefaults: boolean) {
  const hidden = hiddenSpec(SEED);
  const tool = hidden.tools.find((entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect);
  if (!tool) throw new Error(`seed ${SEED} has no tool that no flow calls`);
  const rendered = renderMap(hidden);
  if (withDefaults) {
    // The schema states the default of each integer argument, as `default:`.
    for (const property of tool.input)
      if (property.type === 'integer')
        rendered.tools = rendered.tools.replace(
          `${property.name}: { type: integer, minimum: ${property.minimum}, maximum: ${property.maximum} }`,
          `${property.name}: { type: integer, minimum: ${property.minimum}, maximum: ${property.maximum}, default: ${property.minimum} }`,
        );
  }
  const source = await generateFrom(hidden, rendered, SEED, {}, { once: true });
  if (!source.prepared) throw new Error(`the fictional map failed to load: ${JSON.stringify(source.refused)}`);
  const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed: SEED });
  const enumField = tool.input.find((property) => property.type === 'enum');
  const integer = tool.input.find((property) => property.type === 'integer');
  if (enumField?.type !== 'enum' || integer?.type !== 'integer') throw new Error('unexpected tool shape');
  const calls = suite.complete.flatMap((spec) =>
    spec.blocks.flatMap((block) =>
      (block.expect?.tools ?? []).filter(
        (call) => call.label === tool.name && call.input && Object.hasOwn(call.input, enumField.name),
      ),
    ),
  );
  return { calls, enumField, integer };
}

describe('a tool a user asks for directly', () => {
  it('is called once, its other arguments at their schema default, the input closed', async () => {
    const { calls, enumField, integer } = await directCalls(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.count).toBe(1);
      expect(call.input?.[integer.name]).toBe(integer.minimum);
      expect(enumField.members).toContain(call.input?.[enumField.name]);
      expect(call.input_closed).toBe(true);
    }
  }, 180_000);

  it('leaves an argument with no schema default open', async () => {
    const { calls, integer } = await directCalls(false);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.count).toBe(1);
      expect(call.input).not.toHaveProperty(integer.name);
      expect(call.input_closed).toBeUndefined();
    }
  }, 180_000);
});
