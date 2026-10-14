import { fileURLToPath } from 'node:url';
import { type FaultSession, generateSuite, renderProposal } from '@agent-nexus/driftbench-generate';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });

import { runLadder } from '../../src/ladder';
import {
  BANK_LEVELS,
  type BankItem,
  bankItems,
  bankShape,
  causeOf,
  evaluate,
  FAULT_CLASSES,
  faultFamily,
  forecast,
  generatorLadder,
  type HiddenSpec,
  hiddenProposal,
  renderMap,
  type ScaleReport,
  SeedData,
} from '../../src/ladders/generator/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const noScale = async () => ({ error: 'scale left out of the test' }) as ScaleReport;
const only =
  (...classes: string[]) =>
  (spec: HiddenSpec) =>
    faultFamily(
      spec,
      FAULT_CLASSES.filter((cls) => classes.includes(cls.id)),
    );
const itemsOf = (...ids: string[]): BankItem[] => bankItems().filter((item) => ids.includes(item.id));

describe('the generator bank', () => {
  it('holds at least 300 items, no family under 20, every tier, unique ids, in the ladder levels', () => {
    const items = bankItems();
    expect(items.length).toBeGreaterThanOrEqual(300);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const shape = bankShape(items);
    for (const [family, tiers] of Object.entries(shape)) {
      expect(
        Object.values(tiers).reduce((sum, count) => sum + count, 0),
        family,
      ).toBeGreaterThanOrEqual(20);
    }
    for (const tier of [1, 2, 3, 4, 5] as const) expect(items.some((item) => item.tier === tier)).toBe(true);
    const levels = new Set<string>(BANK_LEVELS.map((level) => level.id));
    for (const item of items) expect(levels.has(item.level), item.id).toBe(true);
  });

  it('holds a fault family of at least 60 classes and their pairwise and three-way interactions', () => {
    const items = bankItems();
    expect(items.filter((item) => item.family.startsWith('fault-')).length).toBeGreaterThanOrEqual(60);
    // Every pair of the 28 drift and 22 deviation classes.
    expect(items.filter((item) => item.family === 'interaction-pair').length).toBe((50 * 49) / 2);
    expect(items.filter((item) => item.family === 'interaction-triple').length).toBeGreaterThanOrEqual(20);
    for (const mode of ['F', 'P', 'T'])
      expect(items.some((item) => item.id.startsWith(`mode.${mode}.`))).toBe(true);
  });

  it('builds a ladder of one level per bank level, each at threshold 1', () => {
    const ladder = generatorLadder();
    expect(ladder.levels.map((level) => level.id)).toEqual(BANK_LEVELS.map((level) => level.id));
    for (const level of ladder.levels) expect(level.threshold).toBe(1);
  });

  it('passes level 1 on the current generator and names the failing items of the first failing level', async () => {
    const ladder = generatorLadder({
      items: bankItems().filter((item) => ['generate', 'differential', 'hostile'].includes(item.level)),
    });
    const run = await runLadder(ladder, { seed: 1, root: ROOT });
    expect(run.rows[0]).toMatchObject({ id: 'generate', pass: true, observed: 1 });
    if (run.failing) {
      for (const item of run.failing.items) {
        // The frame's bank measure carries the family and the tier as fields of each failing item.
        expect(item.family).toMatch(/^\w[\w-]*$/);
        expect(item.tier).toBeGreaterThanOrEqual(1);
        expect(item.tier).toBeLessThanOrEqual(5);
        expect(item.component).toMatch(/^packages\//);
      }
    }
  });
});

describe('items with planted defects', () => {
  it('fails generate.bytes when two runs on the same map and seed differ', async () => {
    let calls = 0;
    const data = new SeedData(
      1,
      {
        generate: (prepared, options) => {
          const out = generateSuite(prepared, options);
          calls += 1;
          return {
            ...out,
            files: out.files.map((file) =>
              file.path.startsWith('specs/graph/') ? { ...file, text: `${file.text}# run ${calls}\n` } : file,
            ),
          };
        },
      },
      noScale,
    );
    const results = await evaluate(itemsOf('generate.bytes.graph', 'generate.bytes.twise'), data);
    const graph = results.find((result) => result.item.id === 'generate.bytes.graph');
    const twise = results.find((result) => result.item.id === 'generate.bytes.twise');
    expect(graph?.verdict.pass).toBe(false);
    expect(graph?.verdict.detail).toMatch(/files differ between two runs/);
    expect(twise?.verdict.pass).toBe(true);
  });

  it('fails a reference item with the follower trace when the reference skips a stage', async () => {
    const skipping = (spec: HiddenSpec): (() => FaultSession) => {
      const fault = faultFamily(spec).find(
        (entry) => entry.class === 'X3.skip' && entry.where === 'any' && entry.rate === 1,
      );
      if (fault?.def.agent.kind !== 'function') throw new Error('no X3 fault');
      return fault.def.agent.create;
    };
    const data = new SeedData(1, { cheaters: [], faults: only('X3.stay'), follower: skipping }, noScale);
    const [result] = await evaluate(itemsOf('reference.seeder.graph'), data);
    expect(result?.verdict.pass).toBe(false);
    expect(result?.verdict.detail).toMatch(/stage\.reached: reached \w+, expected \w+/);
    expect(result?.verdict.detail).toMatch(/the follower did: stage \w+; calls /);
  });

  it('kills a stage fault and names a text fault no Then reads', async () => {
    // Explicitly retain the historical weak map as a negative control. The default map now
    // has reply assertions, but a map without them must still leave the fact fault alive.
    const data = new SeedData(
      1,
      {
        cheaters: [],
        faults: only('X3.skip', 'X2.fact-flip'),
        render: (hidden) => {
          const proposal = hiddenProposal(hidden);
          proposal.relations = proposal.relations?.filter((relation) => relation.kind !== 'states');
          return { ...renderMap(hidden), map: renderProposal(proposal) };
        },
      },
      noScale,
    );
    // evaluate returns the items in bank order, so each is found by its id.
    const results = await evaluate(itemsOf('fault.X3.skip', 'fault.X2.fact-flip'), data);
    const skip = results.find((result) => result.item.id === 'fault.X3.skip');
    const flip = results.find((result) => result.item.id === 'fault.X2.fact-flip');
    expect(skip?.verdict.pass, skip?.verdict.detail).toBe(true);
    expect(flip?.verdict.pass).toBe(false);
    expect(flip?.verdict.detail).toMatch(/it lacks a must or must_not on the tool answer the reply states/);
  });

  it('leaves a family out when the run narrows the bank, and says so', async () => {
    const data = new SeedData(1, { families: ['generate'] }, noScale);
    const [left] = await evaluate(itemsOf('cheater.constant.graph'), data);
    expect(left?.verdict).toEqual({ pass: false, detail: 'the family cheaters was left out of this run' });
  });
});

describe('the hardness forecast', () => {
  it('divides the remaining items by the items fixed per pilot iteration', () => {
    const scores = [0.3, 0.31, 0.32, 0.32, 0.33, 0.34, 0.35, 0.35, 0.36, 0.37, 0.38].map((score) => score);
    const result = forecast(1000, scores);
    expect(result.passingAtZero).toBe(300);
    expect(result.passingAfter).toBe(380);
    expect(result.fixedPerIteration).toBe(8);
    expect(result.remaining).toBe(620);
    expect(result.iterations).toBeCloseTo(77.5);
    expect(result.gate).toBe(false);
    expect(forecast(1000, [0.3, 0.3]).iterations).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the cause of a failing item', () => {
  const item = (id: string) => bankItems().find((entry) => entry.id === id) as BankItem;

  it('counts every class-keyed item of a class never killed under that class kill', () => {
    expect(
      causeOf(item('fault.X2.fact-flip'), { pass: false, detail: '0 of 5 scored instances killed' }),
    ).toBe('kill.X2.fact-flip');
    expect(
      causeOf(item('adequacy.X2.fact-flip'), {
        pass: false,
        detail: 'X2.fact-flip never changes what the agent does in a complete spec',
      }),
    ).toBe('kill.X2.fact-flip');
    expect(
      causeOf(item('stable.X2.fact-flip'), {
        pass: false,
        detail: 'killed under generator seeds 2: no, 103: no, 204: no',
      }),
    ).toBe('kill.X2.fact-flip');
  });

  it('keeps an item its own cause when the class is killed but the item still fails', () => {
    expect(
      causeOf(item('stable.X2.fact-flip'), {
        pass: false,
        detail: 'killed under generator seeds 2: yes, 103: no, 204: yes',
      }),
    ).toBe('stable.X2.fact-flip');
    expect(causeOf(item('acme.fault.x1-invents-price'), { pass: false, detail: 'not killed' })).toBe(
      'acme.price-slot',
    );
  });

  it('takes the cause a verdict states, as an interaction does for a member never killed alone', () => {
    const pair = bankItems().find((entry) => entry.family === 'interaction-pair') as BankItem;
    expect(causeOf(pair, { pass: false, detail: 'lost', cause: 'kill.X1.case' })).toBe('kill.X1.case');
    expect(causeOf(pair, { pass: false, detail: 'each is killed alone' })).toBe(pair.id);
  });
});
