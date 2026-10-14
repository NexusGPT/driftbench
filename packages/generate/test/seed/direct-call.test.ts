import { describe, expect, it } from 'vitest';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';

// Seed 3 has a read tool no flow calls: a user asks for it directly, with one argument.
const SEED = 3;

async function directCalls(withDefaults: boolean, enumDefault = false) {
  const hidden = hiddenSpec(SEED);
  const tool = hidden.tools.find(
    (entry) => !hidden.uses.some((use) => use.tool === entry.name) && !entry.sideEffect,
  );
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
  if (enumDefault) {
    // And the first member of each enum argument, as the validator's tools file writes it.
    for (const property of tool.input)
      if (property.type === 'enum')
        rendered.tools = rendered.tools.replace(
          `${property.name}: { type: string, enum: [${property.members.join(', ')}] }`,
          `${property.name}: { type: string, enum: [${property.members.join(', ')}], default: ${property.members[0]} }`,
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
  // The runs a turn asking for a returned value makes: its approved phrase names no argument.
  const asking = new Set(
    hidden.phrases
      .filter((phrase) => phrase.intent.kind === 'data' && phrase.value.startsWith(`${tool.name}.out.`))
      .map((phrase) => phrase.text),
  );
  const reports = suite.complete.flatMap((spec) =>
    spec.blocks.flatMap((block) =>
      'user' in block.when && asking.has(block.when.user)
        ? (block.expect?.tools ?? []).filter((call) => call.label === tool.name && call.count !== 0)
        : [],
    ),
  );
  return { calls, runs, reports, enumField, integer };
}

describe('a tool a user asks for directly', () => {
  it('is called once, its other arguments at their schema default, the input closed', async () => {
    const { calls, runs, enumField, integer } = await directCalls(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(runs.length).toBeGreaterThan(calls.length);
    expect(runs.map((call) => call.count)).toEqual(runs.map(() => 1));
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

describe('a tool a user asks to report a returned value', () => {
  it('is called once with every argument at its schema default, closed when each has one', async () => {
    const { reports, enumField, integer } = await directCalls(true, true);
    expect(reports.length).toBeGreaterThan(0);
    for (const call of reports) {
      expect(call.count).toBe(1);
      expect(call.input).toEqual({ [integer.name]: integer.minimum, [enumField.name]: enumField.members[0] });
      expect(call.input_closed).toBe(true);
    }
  }, 180_000);

  it('names no argument when the schema gives no default', async () => {
    const { reports } = await directCalls(false);
    expect(reports.length).toBeGreaterThan(0);
    for (const call of reports) expect(call.input).toBeUndefined();
  }, 180_000);
});
