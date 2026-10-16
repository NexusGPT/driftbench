import { contentHash, type LoadedSpec, validateSpec } from '@agent-nexus/driftbench-core';
import {
  blockOutcome,
  COMPLETE_DIR,
  generateSuite,
  runOnce,
  stimulusText,
} from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { createFollower } from '../../src/ladders/generator/follower';
import { type HiddenSpec, hiddenSpec, readTurn, type ToolRole } from '../../src/ladders/generator/hidden';
import {
  followerAdapter,
  type Generation,
  generateFrom,
  runContext,
} from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing integer contrast fixture');
  return value;
}

// Hand-written, non-bank contract: a fictional parcel tool, unfamiliar field and range.
function fixture(role: ToolRole = 'read'): Generation {
  const hidden: HiddenSpec = {
    ...hiddenSpec(1),
    tools: [
      {
        name: 'inspect_parcels',
        role,
        sideEffect: role === 'write',
        title: 'Inspect parcels',
        input: [
          { name: 'zone', type: 'enum', members: ['east', 'west', 'north'] },
          { name: 'crates', type: 'integer', minimum: 7, maximum: 13 },
        ],
        output: [],
        slot: 'zone',
      },
    ],
    data: [],
    phrases: [],
  };
  const complete: LoadedSpec[] = [];
  for (const [partition, value] of [
    ['at-minimum', 7],
    ['above-minimum', 8],
    ['below-maximum', 12],
    ['at-maximum', 13],
  ] as const) {
    const dimension = 'inspect_parcels.in.crates';
    const id = `${dimension}.${partition}`;
    const text = `Inspect ${value} crates in the east depot.`;
    hidden.data.push({
      dimension,
      id,
      tool: 'inspect_parcels',
      direction: 'in',
      field: 'crates',
      partition,
      title: partition,
      value,
      invalid: false,
      quote: 'Crates range from 7 to 13.',
    });
    hidden.phrases.push({ dimension, value: id, text, lang: 'en', intent: { kind: 'data', value: id } });
    const parsed = validateSpec({
      id: `parcel-${partition}`,
      title: 'A parcel enquiry',
      kind: 'conversation',
      metadata: { generated: { cell: { [dimension]: id } } },
      blocks: [
        {
          id: 'prepare',
          when: { user: 'Prepare the depot enquiry.' },
          expect: { tools: [{ label: 'inspect_parcels', count: 0 }] },
        },
        {
          id: 'initial-lookup',
          when: { user: 'Look up the depot defaults.' },
          expect: {
            tools: [
              {
                label: 'inspect_parcels',
                count: role === 'write' ? 0 : 1,
                ...(role === 'write' ? {} : { input: { zone: 'east', crates: 7 } }),
              },
            ],
          },
        },
        {
          id: 'requested-value',
          when: { user: text },
          expect: {
            tools: [
              {
                label: 'inspect_parcels',
                count: role === 'write' ? 0 : 1,
                ...(role === 'write' ? {} : { input: { zone: 'east', crates: value } }),
              },
            ],
          },
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    complete.push({
      ok: true,
      warnings: [],
      path: `${partition}.yaml`,
      spec: parsed.spec,
      hash: contentHash(parsed.spec),
    });
  }
  return { hidden, generatorSeed: 1, complete, loaded: complete, first: new Map(), second: new Map() };
}

async function check(generated: Generation, role: ToolRole = 'read', pair = 'at-minimum-above-minimum') {
  return required(bankItems().find((item) => item.id === `contrast.${role}.integer.${pair}`)).check({
    generated: async () => generated,
  } as SeedData);
}

describe('integer contrast follows the requested value, not preparatory calls', () => {
  for (const role of ['read', 'list', 'write'] as const) {
    it(`${role}: correct request assertions pass despite shared setup and zero-call guards`, async () => {
      const generated = fixture(role);
      for (const pair of ['at-minimum-above-minimum', 'below-maximum-at-maximum'])
        expect(await check(generated, role, pair)).toMatchObject({ pass: true });
    });
  }

  for (const mutant of [
    'constant',
    'missing-input',
    'wrong-number',
    'string-number',
    'range',
    'missing-count',
    'no-call',
    'absent',
    'fake-stimulus',
  ] as const) {
    it(`rejects ${mutant} even when unrelated calls distinguish the suites`, async () => {
      const generated = fixture();
      const specimen = required(generated.complete[1]).spec;
      const block = required(specimen.blocks[2]);
      const assertion = required(block.expect?.tools?.[0]);
      required(required(specimen.blocks[1]).expect?.tools?.[0]).input = { crates: 99 };
      if (mutant === 'constant') assertion.input = { crates: 7 };
      if (mutant === 'missing-input') delete assertion.input;
      if (mutant === 'wrong-number') assertion.input = { crates: 10 };
      if (mutant === 'string-number') assertion.input = { crates: '8' };
      if (mutant === 'range') assertion.input = { crates: { one_of: [7, 8, 13] } };
      if (mutant === 'missing-count') delete assertion.count;
      if (mutant === 'no-call') assertion.count = 0;
      if (mutant === 'absent') specimen.blocks.pop();
      if (mutant === 'fake-stimulus') block.when = { user: 'Unrelated request.' };
      expect(await check(generated)).toMatchObject({ pass: false });
    });
  }

  it('does not allow a correct duplicate to hide an incorrect assertion', async () => {
    const generated = fixture();
    const duplicate = structuredClone(required(generated.complete[1]));
    required(required(duplicate.spec.blocks[2]).expect?.tools?.[0]).input = { crates: 7 };
    generated.complete.push(duplicate);
    expect(await check(generated)).toMatchObject({ pass: false });
  });

  it('accepts exact JSON assertions and singleton choices with an exact call range', async () => {
    const generated = fixture();
    for (const [i, loaded] of generated.complete.entries()) {
      const assertion = required(required(loaded.spec.blocks[2]).expect?.tools?.[0]);
      const value = required(assertion.input).crates;
      if (typeof value !== 'number') throw new Error('expected a numeric fixture input');
      assertion.input = { crates: i % 2 ? { exact: value } : { one_of: [value] } };
      assertion.count = { min: 1, max: 1 };
    }
    expect(await check(generated)).toMatchObject({ pass: true });
    expect(await check(generated, 'read', 'below-maximum-at-maximum')).toMatchObject({ pass: true });
  });

  it('requires explicit refusal for each direct side-effecting request', async () => {
    for (const count of [undefined, 1, { max: 1 }]) {
      const generated = fixture('write');
      required(required(required(generated.complete[1]).spec.blocks[2]).expect?.tools?.[0]).count = count;
      expect(await check(generated, 'write')).toMatchObject({ pass: false });
    }
  });

  it('reads the approved stimulus without trusting cell metadata or block labels', async () => {
    const generated = fixture();
    for (const loaded of generated.complete) {
      delete loaded.spec.metadata;
      for (const [i, block] of loaded.spec.blocks.entries()) block.id = `opaque-${i}`;
    }
    expect(await check(generated)).toMatchObject({ pass: true });
  });
});

describe('fresh generated suites retain exact integer contrast', () => {
  for (const seed of [1009, 2027, 4093, 8191]) {
    it(`seed ${seed}: accepts the contract and rejects a product that copies default integers`, async () => {
      const hidden = hiddenSpec(seed);
      const rendered = renderMap(hidden);
      const generated = await generateFrom(hidden, rendered, seed, {}, { once: true });
      expect(generated.refused).toBeUndefined();
      const items = bankItems().filter((item) => /^contrast\.[^.]+\.integer\./.test(item.id));
      expect(items).toHaveLength(6);
      for (const item of items) {
        const result = await item.check({ generated: async () => generated } as SeedData);
        expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
      }
      // Drive every distinct spec carrying one of the six target items through the real reference.
      const targetValues = new Set(
        hidden.data
          .filter(
            (value) =>
              value.direction === 'in' &&
              ['at-minimum', 'above-minimum', 'below-maximum', 'at-maximum'].includes(value.partition),
          )
          .map((value) => value.id),
      );
      const targets = generated.complete.filter(({ spec }) =>
        spec.blocks.some((block) => {
          const read = block.when && readTurn(hidden, stimulusText(block.when));
          return read?.intent.kind === 'data' && targetValues.has(read.intent.value);
        }),
      );
      expect(targets.length).toBeGreaterThan(0);
      for (const { spec } of targets) {
        const run = await runOnce(spec, followerAdapter(createFollower(hidden)), seed, runContext());
        for (const [index] of spec.blocks.entries())
          expect(blockOutcome(run, index), `${spec.id}#${index}`).toBe('pass');
      }
      // Replace the product's output at the generator seam, before disk loading and scoring.
      // This mutant ignores every explicit valid integer and emits its default instead.
      let changed = 0;
      const mutant = await generateFrom(
        hidden,
        rendered,
        seed,
        {
          generate(prepared, options) {
            const result = generateSuite(prepared, options);
            for (const file of result.files) {
              if (!file.path.startsWith(`${COMPLETE_DIR}/`) || !file.path.endsWith('.yaml')) continue;
              const spec = parse(file.text) as LoadedSpec['spec'];
              let edited = false;
              for (const block of spec.blocks) {
                const read = block.when && readTurn(hidden, stimulusText(block.when));
                if (read?.intent.kind !== 'data') continue;
                const requested = read.intent.value;
                const value = hidden.data.find((value) => value.id === requested);
                if (value?.direction !== 'in' || value.invalid) continue;
                const tool = hidden.tools.find((tool) => tool.name === value.tool);
                const property = tool?.input.find((property) => property.name === value.field);
                if (tool?.sideEffect || property?.type !== 'integer') continue;
                for (const assertion of block.expect?.tools ?? []) {
                  if (assertion.label !== tool?.name || !assertion.input) continue;
                  if (assertion.input[value.field] !== property.minimum) changed++;
                  assertion.input[value.field] = property.minimum;
                  edited = true;
                }
              }
              if (edited) file.text = stringify(spec);
            }
            return result;
          },
        },
        { once: true },
      );
      expect(changed).toBeGreaterThan(0);
      expect(mutant.complete.length).toBe(generated.complete.length);
      for (const item of items.filter((item) => !item.id.startsWith('contrast.write.'))) {
        const result = await item.check({ generated: async () => mutant } as SeedData);
        expect(result.pass, `${item.id}: ${result.detail}`).toBe(false);
      }
    }, 300_000);
  }
});
