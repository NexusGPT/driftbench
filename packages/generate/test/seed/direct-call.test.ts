import { describe, expect, it } from 'vitest';
import { defaultValue } from '../../../validators/src/ladders/generator/follower';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

// Seed 3 has a read tool no flow calls: a user asks for it directly, with one argument.
const SEED = 3;

async function directCalls(withDefaults: boolean) {
  const hidden = hiddenSpec(SEED);
  const tool = hidden.tools.find(
    (entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect,
  );
  if (!tool) throw new Error(`seed ${SEED} has no tool that no flow calls`);
  const rendered = renderMap(hidden);
  // The rendered tools file states the default of each input, as `default:`. Without defaults it is stripped.
  if (!withDefaults) {
    for (const property of tool.input)
      rendered.tools = rendered.tools.replace(
        new RegExp(`(${property.name}: \\{[^}\\n]*?), default: [^,}\\n]+`),
        '$1',
      );
  }
  const source = await generateFrom(hidden, rendered, SEED, {}, { once: true });
  if (!source.prepared)
    throw new Error(`the fictional map failed to load: ${JSON.stringify(source.refused)}`);
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
  // Every turn that runs the tool, an argument or a returned value asked for, runs it once.
  const runs = suite.complete.flatMap((spec) =>
    spec.blocks.flatMap((block) =>
      (block.expect?.tools ?? []).filter((call) => call.label === tool.name && call.count !== 0),
    ),
  );
  return { calls, runs, enumField, integer };
}

describe('a tool a user asks for directly', () => {
  it('is called once, its other arguments at their schema default, the input closed', async () => {
    const { calls, runs, enumField, integer } = await directCalls(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(runs.length).toBeGreaterThan(calls.length);
    expect(runs.map((call) => call.count)).toEqual(runs.map(() => 1));
    // The tools file states the integer's default, so a value turn can assert the full input too: it tests
    // another value of the integer, in range, with the other arguments at their defaults. A direct call
    // keeps the default.
    for (const call of calls) {
      expect(call.count).toBe(1);
      const value = call.input?.[integer.name];
      expect(value).toBeGreaterThanOrEqual(integer.minimum);
      expect(value).toBeLessThanOrEqual(integer.maximum);
      expect(enumField.members).toContain(call.input?.[enumField.name]);
      expect(call.input_closed).toBe(true);
      // A call is a direct call at the defaults, or a value turn for the integer with the enum at its default.
      expect(value === defaultValue(integer) || call.input?.[enumField.name] === enumField.members[0]).toBe(
        true,
      );
    }
    expect(calls.some((call) => call.input?.[integer.name] === defaultValue(integer))).toBe(true);
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
