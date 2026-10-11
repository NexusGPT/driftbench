import { describe, expect, it } from 'vitest';
import { designPilot, designVariants, pilotFactors, stimulusText } from '../../src/pilot/design';
import { planPilot } from '../../src/pilot/run';
import { acmePilotMap, acmeSuite, bank, generatedSpec, plainSpec } from './support';

const MAP = {
  path: 'map.yaml',
  agent: 'zed',
  hash: 'map-1',
  phrasesOf: bank({
    'flow=upgrade': ['More data please.', 'I want a bigger plan.', 'Can I get more data?'],
    'deviation=D4': ['yeah sounds good', 'ok perfect'],
  }),
};

const twoBlocks = generatedSpec('s1', { behaviour: 'B-1', channel: 'chat' }, [
  { id: 'b1', user: 'More data please.', phrase: { dimension: 'flow', value: 'upgrade' } },
  {
    id: 'b2',
    injection: { class: 'D4_loose_confirmation', user: 'yeah sounds good' },
    phrase: { dimension: 'deviation', value: 'D4' },
  },
]);
const unknownPhrase = generatedSpec('s2', { behaviour: 'B-1' }, [
  { id: 'b1', user: 'Move my number.', phrase: { dimension: 'flow', value: 'porting' } },
]);
const otherCell = generatedSpec('s3', { behaviour: 'B-2' }, [
  { id: 'b1', user: 'I want a bigger plan.', phrase: { dimension: 'flow', value: 'upgrade' } },
]);

describe('designPilot', () => {
  it('crosses the approved phrases of every phrased block, wording 0 being the spec as generated', () => {
    const design = designPilot(MAP, [twoBlocks], { wordings: 3, repeats: 5 });
    const conversation = design.cells[0]?.conversations[0];
    expect(conversation?.available).toBe(6);
    expect(conversation?.variants.map((variant) => variant.choice)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const texts = conversation?.variants.map((variant) =>
      variant.loaded.spec.blocks.map((block) => stimulusText(block.when)),
    );
    expect(texts).toEqual([
      ['More data please.', 'yeah sounds good'],
      ['I want a bigger plan.', 'yeah sounds good'],
      ['Can I get more data?', 'yeah sounds good'],
    ]);
    expect(conversation?.variants[0]?.loaded.spec.blocks).toEqual(
      twoBlocks.spec.blocks.map((block) => expect.objectContaining({ id: block.id, when: block.when })),
    );
  });

  it('gives every wording its own spec id and hash, with the factors under metadata.pilot', () => {
    const design = designPilot(MAP, [twoBlocks], { wordings: 6 });
    const variants = designVariants(design);
    expect(variants.map((entry) => entry.spec.id)).toEqual([
      's1.w0',
      's1.w1',
      's1.w2',
      's1.w3',
      's1.w4',
      's1.w5',
    ]);
    expect(new Set(variants.map((entry) => entry.hash)).size).toBe(6);
    expect(pilotFactors(variants[4]?.spec as never)).toEqual({
      cell: 'behaviour=B-1',
      conversation: 's1',
      wording: 4,
      map: 'map-1',
      suite: 1,
    });
    // Wording 4 is option 1 of block 1 and option 1 of block 2: the first block varies fastest.
    expect(variants[4]?.spec.blocks.map((block) => stimulusText(block.when))).toEqual([
      'I want a bigger plan.',
      'ok perfect',
    ]);
  });

  it('names cells by the chosen dimensions and takes the first conversations by id', () => {
    const design = designPilot(MAP, [otherCell, unknownPhrase, twoBlocks], { conversations: 1 });
    expect(
      design.cells.map((cell) => [cell.cell, cell.suite, cell.conversations.map((c) => c.conversation)]),
    ).toEqual([
      ['behaviour=B-1', 2, ['s1']],
      ['behaviour=B-2', 1, ['s3']],
    ]);
    const byTwo = designPilot(MAP, [twoBlocks, otherCell], { by: ['behaviour', 'channel'] });
    expect(byTwo.cells.map((cell) => cell.cell)).toEqual([
      'behaviour=B-1,channel=chat',
      'behaviour=B-2,channel=-',
    ]);
  });

  it('keeps one wording for a block whose phrase is not in the bank, and says so', () => {
    const design = designPilot(MAP, [unknownPhrase]);
    expect(design.cells[0]?.conversations[0]?.variants).toHaveLength(1);
    expect(design.warnings).toEqual([
      'flow=porting has no approved phrase in the map, so its block keeps one wording',
    ]);
  });

  it('puts the generated text first when it is one of the bank phrases', () => {
    const design = designPilot(MAP, [otherCell]);
    expect(design.cells[0]?.conversations[0]?.phrased[0]?.options).toEqual([
      'I want a bigger plan.',
      'More data please.',
      'Can I get more data?',
    ]);
  });

  it('skips a spec the generator did not write and warns on another map', () => {
    const design = designPilot({ ...MAP, hash: 'map-2' }, [plainSpec('hand'), twoBlocks]);
    expect(design.skipped).toEqual([
      { spec: 'hand', reason: 'not generated: it has no metadata.generated.cell' },
    ]);
    expect(design.warnings).toContain(
      'the suite was generated from map map-1, the pilot reads map map-2: phrases may not match',
    );
  });

  it('refuses a design with no repeat', () => {
    expect(() => designPilot(MAP, [twoBlocks], { repeats: 0 })).toThrow(/repeats must be a whole number/);
  });
});

describe('planPilot', () => {
  it('counts runs and blocks per cell and prices them from the latest measured unit', () => {
    const design = designPilot(MAP, [twoBlocks, otherCell], { wordings: 3, repeats: 5 });
    const units = [
      { adapter: 'http', metric: 'block', usd: 0.01, measuredAt: '2026-10-01T00:00:00.000Z' },
      { adapter: 'http', metric: 'block', usd: 0.02, measuredAt: '2026-10-05T00:00:00.000Z' },
      { adapter: 'http', metric: 'judge_call', usd: 9, measuredAt: '2026-10-09T00:00:00.000Z' },
    ];
    const plan = planPilot(design, { adapter: 'http', agent: 'zed' }, units);
    expect(plan.pricing).toEqual({
      kind: 'measured',
      usdPerBlock: 0.02,
      measuredAt: '2026-10-05T00:00:00.000Z',
    });
    expect(plan.cells.map((line) => [line.cell, line.wordings, line.runs, line.blocks, line.usd])).toEqual([
      ['behaviour=B-1', 3, 15, 30, 0.6],
      ['behaviour=B-2', 3, 15, 15, 0.3],
    ]);
    expect(plan.total.runs).toBe(30);
    expect(plan.total.usd).toBeCloseTo(0.9, 10);
  });

  it('prices an in-process agent at 0 and leaves an unmeasured remote one without a figure', () => {
    const design = designPilot(MAP, [twoBlocks]);
    expect(planPilot(design, { adapter: 'function', agent: 'acme' }).total.usd).toBe(0);
    const remote = planPilot(design, { adapter: 'http' });
    expect(remote.pricing.kind).toBe('unmeasured');
    expect(remote.total.usd).toBeUndefined();
  });

  it('designs the Acme pilot from the approved map: 10 conversations a cell, wordings the bank allows', async () => {
    const design = designPilot(await acmePilotMap(), await acmeSuite());
    expect(design.skipped).toEqual([]);
    expect(design.warnings).toEqual([]);
    for (const cell of design.cells) expect(cell.conversations.length).toBe(Math.min(10, cell.suite));
    const wordings = design.cells.flatMap((cell) => cell.conversations.map((c) => c.variants.length));
    expect(Math.max(...wordings)).toBeLessThanOrEqual(3);
    expect(wordings.some((count) => count > 1)).toBe(true);
  });
});
