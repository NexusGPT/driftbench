import { contentHash, type LoadedSpec, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { machineSignature } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { bankItems, SeedData } from '../../src/ladders/generator/bank';
import { FAULT_CLASSES, faultFamily } from '../../src/ladders/generator/faults';
import { createFollower, type Mutation } from '../../src/ladders/generator/follower';
import { type HiddenSpec, hiddenSpec, readTurn } from '../../src/ladders/generator/hidden';
import { type Generation, type GeneratorParts, generateFrom } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing dependent-prefix fixture');
  return value;
}
function loaded(input: unknown): LoadedSpec {
  const parsed = validateSpec(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return {
    ok: true,
    warnings: [],
    path: `specs/graph/${parsed.spec.id}.yaml`,
    spec: parsed.spec,
    hash: contentHash(parsed.spec),
  };
}
const parts: GeneratorParts = {
  faults: (hidden) =>
    faultFamily(
      hidden,
      FAULT_CLASSES.filter((cls) => cls.id === 'X3.stay'),
    ).filter((fault) => fault.where === 'any' && fault.rate === 1),
  cheaters: ['constant', 'echo'],
  k: 1,
  baseline: () => [],
};
async function dataFor(generated: Generation, selected: GeneratorParts = parts) {
  const data = new SeedData(generated.hidden.seed, selected, async () => ({}) as never);
  await data.memoized('generated', async () => generated);
  return data;
}
async function check(data: SeedData, id = 'minimal.X3.stay') {
  return required(bankItems().find((item) => item.id === id)).check(data);
}

// A hand-written state machine. Its unfamiliar stages and wording are not from the bank.
function fixture(middle = false, neutral = false): Generation {
  const stageIds = middle
    ? ['dock', 'identified', 'scanned', 'sent', 'held']
    : ['dock', 'scanned', 'sent', 'held'];
  const shared = middle ? ['dock', 'identified', 'scanned'] : ['dock', 'scanned'];
  const paths = ['sent', 'held'].map((end) => [...shared, end]);
  const transitions = paths
    .flatMap((path) =>
      path.slice(1).map((to, index) => ({
        id: `${path[index]}-to-${to}`,
        from: required(path[index]),
        to,
        title: `Pass the parcel from ${path[index]} to ${to}`,
        rule: `The next parcel checkpoint is ${to}.`,
      })),
    )
    .filter((edge, index, all) => all.findIndex((other) => other.id === edge.id) === index);
  const hidden: HiddenSpec = {
    ...hiddenSpec(1237),
    stages: stageIds.map((id) => ({ id, title: id, question: `Parcel checkpoint ${id}?` })),
    start: 'dock',
    goal: required(shared[1]),
    confirm: 'scanned',
    final: 'sent',
    next: {},
    transitions,
    tools: [],
    data: [],
    uses: [],
    constraints: [],
    recoveries: [],
    behaviours: [],
    personas: [],
    flows: [{ id: 'parcel', title: 'Handle a parcel', behaviours: [], deviations: [] }],
    paths: paths.map((stages, index) => ({
      id: `parcel-${index}`,
      flow: 'parcel',
      stages,
      when: {},
      quote: 'Inspect before dispatch.',
    })),
    phrases: transitions.map((edge) => ({
      dimension: 'stage_transition',
      value: edge.id,
      text: edge.title,
      lang: 'en',
      intent: { kind: 'transition' as const, edge: edge.id },
    })),
  };
  const complete = paths.map((path, index) => {
    const blocks: Spec['blocks'] = path.slice(1).map((to, at) => {
      const edge = required(transitions.find((edge) => edge.from === path[at] && edge.to === to));
      return {
        id: `step-${at}`,
        when: { user: edge.title },
        expect: { stage: to, stage_reported: true, must: [`Parcel checkpoint ${to}\\?`] },
      };
    });
    if (neutral)
      blocks.splice(blocks.length - 1, 0, {
        id: 'aside',
        when: { user: 'The parcel is on a shelf.' },
        expect: { stage: 'scanned', stage_reported: true, must: ['Parcel checkpoint scanned\\?'] },
      });
    return loaded({
      id: `parcel-${index}`,
      kind: 'conversation',
      stages: stageIds,
      metadata: { generated: { seeder: 'graph' } },
      blocks,
    });
  });
  return {
    hidden,
    generatorSeed: hidden.seed,
    first: new Map(),
    second: new Map(),
    complete,
    loaded: complete,
  };
}

describe('minimality proves removability instead of treating shared setup as redundancy', () => {
  for (const middle of [false, true]) {
    it(`keeps necessary ${middle ? 'opening and middle' : 'opening'} setup for distinct probes`, async () => {
      const data = await dataFor(fixture(middle));
      expect((await data.runs()).blocks.every((block) => block.reference[0] === 'pass')).toBe(true);
      const result = await check(data);
      expect(result.pass, result.detail).toBe(true);
      expect(await check(data, 'minimal.seeder.graph')).toMatchObject({ pass: true });
    });
  }

  it('still rejects removable nonterminal steps', async () => {
    const data = await dataFor(fixture(false, true));
    const result = await check(data);
    expect(result.pass, result.detail).toBe(false);
    expect(await check(data, 'minimal.seeder.graph')).toMatchObject({ pass: false });
  });

  it('keeps reference-neutral setup when removing it would stop testing a temporal fault', async () => {
    const generated = fixture(false, true);
    const data = await dataFor(generated, {
      ...parts,
      faults(hidden) {
        const template = required(
          faultFamily(
            hidden,
            FAULT_CLASSES.filter((cls) => cls.id === 'X4.empty'),
          ).find((fault) => fault.where === 'any' && fault.rate === 1),
        );
        return [
          ...required(parts.faults)(hidden),
          ...['sent', 'held'].map((target) => {
            const mutation: Mutation = {
              reply(texts, ctx) {
                return ctx.opportunity('reply') === 3 && ctx.stage === target ? [''] : texts;
              },
            };
            return {
              ...template,
              mutation,
              def: {
                ...template.def,
                id: `third-reply-${target}`,
                agent: { kind: 'function' as const, create: createFollower(hidden, mutation) },
              },
            };
          }),
        ];
      },
    });
    const runs = await data.runs();
    expect(runs.blocks.every((block) => block.reference[0] === 'pass')).toBe(true);
    for (const target of ['sent', 'held'])
      expect(runs.blocks.some((block) => block.faults[`third-reply-${target}`] === 'fail')).toBe(true);
    expect(await check(data)).toMatchObject({ pass: true });
    expect(await check(data, 'minimal.seeder.graph')).toMatchObject({ pass: true });
  });

  for (const standalone of [false, true]) {
    it(`still rejects duplicated ${standalone ? 'standalone' : 'terminal'} probes, even with relabelled metadata`, async () => {
      const generated = fixture();
      const first = required(generated.complete[0]);
      if (standalone) first.spec.blocks = [required(first.spec.blocks[0])];
      const copy = structuredClone(first);
      copy.spec.id = 'parcel-copy';
      copy.spec.channel = 'messaging';
      copy.spec.tags = ['persona:anonymous'];
      generated.complete = [first, copy];
      const data = await dataFor(generated);
      expect(await check(data)).toMatchObject({ pass: false });
      expect(await check(data, 'minimal.seeder.graph')).toMatchObject({ pass: false });
    });
  }

  describe('a variant a metamorphic family declares is not a removable duplicate', () => {
    /** Two one-block specs with the same test; the metadata says whether they are variants of one family. */
    function variants(member: (index: number) => Record<string, unknown> | undefined): Generation {
      const generated = fixture();
      const first = required(generated.complete[0]);
      first.spec.blocks = [required(first.spec.blocks[0])];
      delete first.spec.perturbations;
      delete first.spec.end_state;
      first.spec.id = 'phrasing-1';
      const second = structuredClone(first);
      second.spec.id = 'phrasing-2';
      [first, second].forEach((entry, index) => {
        const family = member(index);
        entry.spec.metadata = {
          generated: { seeder: 'metamorphic', ...(family ? { metamorphic: family } : {}) },
        };
      });
      generated.complete = [first, second];
      generated.loaded = [first, second];
      return generated;
    }
    const family = (index: number, of: number) => ({
      family: 'phrasings-of-one-request',
      variant: index + 1,
      of,
      relation: 'same observed outcome',
    });

    it('keeps the variants a family declares, however equal their tests are', async () => {
      const data = await dataFor(variants((index) => family(index, 2)));
      expect((await data.runs()).blocks.every((block) => block.reference[0] === 'pass')).toBe(true);
      const result = await check(data);
      expect(result.pass, result.detail).toBe(true);
    });

    it('still rejects the same two specs when no family declares them', async () => {
      const data = await dataFor(variants(() => undefined));
      expect(await check(data)).toMatchObject({ pass: false });
    });

    it('still rejects a variant the family declares beyond its count', async () => {
      const generated = variants((index) => family(index, 1));
      const data = await dataFor(generated);
      expect(await check(data)).toMatchObject({ pass: false });
    });

    it('still rejects a plain duplicate of a variant that is not in the family', async () => {
      const generated = variants((index) => family(index, 2));
      const stranger = structuredClone(required(generated.complete[0]));
      stranger.spec.id = 'phrasing-3';
      stranger.spec.metadata = { generated: { seeder: 'metamorphic' } };
      generated.complete.push(stranger);
      generated.loaded.push(stranger);
      expect(await check(await dataFor(generated))).toMatchObject({ pass: false });
    });
  });

  it('does not pass an empty fault-killing set', async () => {
    const generated = fixture();
    for (const { spec } of generated.complete) for (const block of spec.blocks) delete block.expect;
    expect(await check(await dataFor(generated))).toMatchObject({ pass: false });
  });
});

describe('fresh maps keep dependent prefixes while duplicated and untested suites still fail', () => {
  for (const seed of [1009, 2027, 4093, 8191]) {
    it(`seed ${seed}: necessary setup is preserved and standalone duplicates still fail`, async () => {
      const hidden = hiddenSpec(seed);
      const generated = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      const candidates = generated.complete.filter(
        ({ spec }) =>
          spec.kind === 'conversation' &&
          spec.blocks.length >= 3 &&
          (spec.metadata?.generated as { seeder?: string } | undefined)?.seeder === 'boundary' &&
          // This control isolates mandatory setup. A redundant self-loop is a real failure and remains so.
          spec.blocks.every((block) => {
            const read = 'user' in block.when ? readTurn(hidden, block.when.user) : undefined;
            if (read?.intent.kind !== 'transition') return true;
            const id = read.intent.edge;
            const edge = hidden.transitions.find((edge) => edge.id === id);
            return edge?.from !== edge?.to;
          }),
      );
      const first = required(candidates[0]);
      const second = required(
        candidates.find(
          ({ spec }) =>
            machineSignature(spec, 0) === machineSignature(first.spec, 0) &&
            machineSignature(spec, spec.blocks.length - 1) !==
              machineSignature(first.spec, first.spec.blocks.length - 1),
        ),
      );
      const pair = { ...generated, complete: [first, second] };
      const data = await dataFor(pair);
      expect((await data.runs()).blocks.every((block) => block.reference[0] === 'pass')).toBe(true);
      const result = await check(data);
      expect(result.pass, result.detail).toBe(true);
      expect(await check(data, 'minimal.seeder.boundary')).toMatchObject({ pass: true });

      const one = structuredClone(first);
      one.spec.blocks = [required(one.spec.blocks[0])];
      delete one.spec.perturbations;
      delete one.spec.end_state;
      const duplicate = structuredClone(one);
      duplicate.spec.id = 'duplicate-opening';
      const mutant = await dataFor({ ...generated, complete: [one, duplicate] });
      expect(await check(mutant)).toMatchObject({ pass: false });
      expect(await check(mutant, 'minimal.seeder.boundary')).toMatchObject({ pass: false });
      for (const entry of [one, duplicate]) for (const block of entry.spec.blocks) delete block.expect;
      expect(await check(await dataFor({ ...generated, complete: [one, duplicate] }))).toMatchObject({
        pass: false,
      });
    }, 300_000);
  }
});
