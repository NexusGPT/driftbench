import { type Inventory, validateInventory, validateSpec } from '@agent-nexus/driftbench-core';
import { coverage, type SpaceCoverage } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { at, HAND, map, S1, S2, S3, spec } from './support';

const hand = map(HAND);
const ALLOWED_MASS = 0.95; // 1 minus the forbidden mass: (a, D4, whatsapp) .0375 and (b, D4, whatsapp) .0125

function inventory(raw: unknown): Inventory {
  const result = validateInventory(raw);
  if (!result.ok) throw new Error(`expected a valid inventory, got ${JSON.stringify(result.errors)}`);
  return result.inventory;
}

const cellLabels = (result: SpaceCoverage) =>
  result.grid.cells.map((cell) => `${Object.values(cell.values).join(' ')}: ${cell.specs.join(',') || '-'}`);

describe('coverage of the full grid', () => {
  const result = coverage(hand, [S1, S2, S3]);

  it('lists every allowed cell with the specs covering it', () => {
    expect(result.grid).toMatchObject({ t: 3, full: true, projections: 1, total: 8, allowed: 6, covered: 3 });
    expect(cellLabels(result)).toEqual([
      'a none chat: s1,s3',
      'a none whatsapp: s2',
      'a D4_loose_confirmation chat: -',
      'b none chat: s1',
      'b none whatsapp: -',
      'b D4_loose_confirmation chat: -',
    ]);
    expect(result.grid.cells[0]?.count).toBe(2);
  });

  it('gives the raw share over the allowed cells: 3 of 6', () => {
    expect(result.grid.share).toBe(0.5);
  });

  it('gives the weighted share: the prior mass of the covered cells over the allowed mass', () => {
    // (a none chat) .3375 + (a none whatsapp) .3375 + (b none chat) .1125, over the allowed .95.
    expect(result.grid.weighted).toBeCloseTo(0.7875 / ALLOWED_MASS, 12);
  });

  it('gives the effective sample size: a shared cell splits its mass between its specs', () => {
    // s1 = .3375 / 2 + .1125, s2 = .3375, s3 = .3375 / 2; n_e = (sum)^2 / (sum of squares) = 2.8.
    expect(result.grid.effectiveSampleSize).toBeCloseTo(2.8, 12);
    expect(result.specs.map((entry) => [entry.id, entry.cells])).toEqual([
      ['s1', 2],
      ['s2', 1],
      ['s3', 1],
    ]);
    expect(result.specs[0]?.weight).toBeCloseTo(0.28125 / ALLOWED_MASS, 12);
    // Without s3, s1 holds (a none chat) alone: n_e = .7875^2 / (.45^2 + .3375^2) = 1.96.
    expect(coverage(hand, [S1, S2]).grid.effectiveSampleSize).toBeCloseTo(1.96, 12);
  });

  it('counts each value once per spec, with its share of the prior after constraints', () => {
    expect(
      result.dimensions.map((dimension) => [dimension.id, dimension.covered, dimension.allowed]),
    ).toEqual([
      ['stage', 2, 2],
      ['deviation', 2, 2],
      ['channel', 2, 2],
    ]);
    const deviation = result.dimensions[1]?.values ?? [];
    expect(deviation.map((value) => [value.id, value.specs])).toEqual([
      ['none', 3],
      ['D4_loose_confirmation', 1],
    ]);
    expect(deviation[1]?.share).toBeCloseTo(0.05 / ALLOWED_MASS, 12);
  });

  it('warns about a spec that reaches a forbidden cell, and never counts it', () => {
    expect(result.warnings).toEqual([
      {
        code: 'FORBIDDEN_CELL',
        subject: 's2',
        specs: ['s2'],
        message:
          'reaches 1 cell the constraints forbid, not counted (first: stage=a · deviation=D4_loose_confirmation · channel=whatsapp); check the spec or the constraint',
      },
    ]);
  });
});

describe('t-wise coverage', () => {
  const result = coverage(hand, [S1, S2, S3], { t: 2 });

  it('counts 8 of the 11 allowed pairs: the forbidden pair is in neither count', () => {
    expect(result.tway[0]).toEqual({
      t: 2,
      projections: 3,
      total: 12,
      allowed: 11,
      covered: 8,
      share: 8 / 11,
    });
    expect(result.grid).toMatchObject({ t: 2, full: false, allowed: 11, covered: 8, share: 8 / 11 });
    expect(result.grid.cells).toHaveLength(11);
  });

  it('averages the weighted share over the three pairs of dimensions', () => {
    // Covered marginal mass per pair: stage x deviation .9375, stage x channel .8375, deviation x channel .9.
    expect(result.grid.weighted).toBeCloseTo((0.9375 + 0.8375 + 0.9) / (3 * ALLOWED_MASS), 12);
    expect(result.grid.effectiveSampleSize).toBeCloseTo(
      2.675 ** 2 / (0.9875 ** 2 + 1.05 ** 2 + 0.6375 ** 2),
      12,
    );
  });

  it('gives triples on the full grid of a three-dimension map', () => {
    expect(coverage(hand, [S1, S2, S3]).tway.map((entry) => [entry.t, entry.covered, entry.allowed])).toEqual(
      [
        [2, 8, 11],
        [3, 3, 6],
      ],
    );
  });

  it('refuses a strength the map cannot have', () => {
    expect(() => coverage(hand, [S1], { t: 4 })).toThrow(RangeError);
  });
});

describe('mutations the tests above catch', () => {
  it('mutation: dividing by every pair instead of the allowed ones gives 8 / 12, not 8 / 11', () => {
    const [pairs] = coverage(hand, [S1, S2, S3], { t: 2 }).tway;
    const wrongDenominator = (pairs?.covered ?? 0) / (pairs?.total ?? 1);
    expect(pairs?.share).toBe(8 / 11);
    expect(wrongDenominator).not.toBeCloseTo(8 / 11, 6);
  });

  it('mutation: a dropped constraint grows the denominators and lets the forbidden pair count', () => {
    const dropped = coverage(map({ ...HAND, constraints: [] }), [S1, S2, S3], { t: 2 });
    expect(dropped.tway[0]).toMatchObject({ allowed: 12, covered: 9 });
    expect(dropped.tway[0]?.share).not.toBeCloseTo(8 / 11, 6);
    const full = coverage(map({ ...HAND, constraints: [] }), [S1, S2, S3]);
    expect(full.grid).toMatchObject({ allowed: 8, covered: 4 });
  });

  it('mutation: normalising the prior over every cell, forbidden ones included, gives .7875, not .8289', () => {
    const { weighted } = coverage(hand, [S1, S2, S3]).grid;
    expect(weighted).not.toBeCloseTo(0.7875, 6);
  });
});

describe('required cells', () => {
  it('combine the required values of every dimension that has one', () => {
    const required = map({
      ...HAND,
      dimensions: [
        {
          ...HAND.dimensions[0],
          values: HAND.dimensions[0].values.map((value) => ({ ...value, required: true })),
        },
        {
          ...HAND.dimensions[1],
          values: [HAND.dimensions[1].values[0], { ...HAND.dimensions[1].values[1], required: true }],
        },
        HAND.dimensions[2],
      ],
    });
    const result = coverage(required, [S1, S2, S3]);
    expect(result.required).toEqual([
      {
        source: 'map',
        values: { stage: 'a', deviation: 'D4_loose_confirmation' },
        covered: true,
        specs: ['s2'],
      },
      {
        source: 'map',
        values: { stage: 'b', deviation: 'D4_loose_confirmation' },
        covered: false,
        specs: [],
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('leave out a required combination the constraints forbid', () => {
    const forbidden = map({
      ...HAND,
      dimensions: [
        HAND.dimensions[0],
        {
          ...HAND.dimensions[1],
          values: [HAND.dimensions[1].values[0], { ...HAND.dimensions[1].values[1], required: true }],
        },
        {
          ...HAND.dimensions[2],
          values: [HAND.dimensions[2].values[0], { ...HAND.dimensions[2].values[1], required: true }],
        },
      ],
    });
    const result = coverage(forbidden, [S1]);
    expect(result.required).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('add each flow deviation the inventory requires, as the Phase 0 coverage counts it', () => {
    const flows = inventory({
      channels: ['chat', 'whatsapp'],
      behaviours: [{ id: 'B-001', title: 'Asks for an explicit yes' }],
      flows: [
        {
          id: 'confirm',
          title: 'Confirmation',
          behaviours: ['B-001'],
          deviations: ['D4_loose_confirmation', 'D8_tool_failure'],
        },
      ],
    });
    const member = spec({
      id: 'member',
      covers: ['B-001'],
      channel: 'whatsapp',
      blocks: [at('a')],
      perturbations: [{ id: 'loose', class: 'D4_loose_confirmation', inject_at: 1, user: 'ok' }],
    });
    const result = coverage(hand, [S1, member], { inventory: flows });
    expect(result.required).toEqual([
      {
        source: 'inventory',
        flow: 'confirm',
        deviation: 'D4_loose_confirmation',
        covered: true,
        specs: ['member'],
      },
      { source: 'inventory', flow: 'confirm', deviation: 'D8_tool_failure', covered: false, specs: [] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('are none when the map requires nothing and names no inventory: the verdict is ok', () => {
    expect(coverage(hand, [S1])).toMatchObject({ required: [], ok: true });
  });
});

describe('warnings and invalid specs', () => {
  it('group the values no dimension lists, and name a spec that falls in no cell', () => {
    const stray = spec({ id: 'stray', channel: 'email', blocks: [at('a')] });
    const result = coverage(hand, [S1, stray]);
    expect(result.warnings.filter((warning) => warning.code !== 'FORBIDDEN_CELL')).toEqual([
      {
        code: 'UNKNOWN_VALUE',
        subject: 'email',
        specs: ['stray'],
        message: 'channel email is named by stray, but no channel dimension of the map lists it',
      },
      {
        code: 'UNPLACED_SPEC',
        subject: 'stray',
        specs: ['stray'],
        message: 'falls in no allowed cell of the full grid: it places on no value of channel',
      },
    ]);
    expect(result.specs.find((entry) => entry.id === 'stray')?.cells).toBe(0);
  });

  it('say when the prior gives the allowed cells no mass, and give no weighted share', () => {
    const empty = map({
      ...HAND,
      dimensions: [HAND.dimensions[0], HAND.dimensions[1], HAND.dimensions[2]],
      prior: {
        kind: 'declared',
        weights: { deviation: { none: 0, D4_loose_confirmation: 1 }, channel: { chat: 0, whatsapp: 1 } },
      },
    });
    const result = coverage(empty, [S1]);
    expect(result.grid.weighted).toBeNull();
    expect(result.grid.effectiveSampleSize).toBeNull();
    expect(result.specs[0]?.weight).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toEqual(['PRIOR_EMPTY']);
  });

  it('list an invalid spec and never count it', () => {
    const broken = validateSpec({ id: 'broken', blocks: [{ expect: { stage: 'a' } }] }, 'specs/broken.yaml');
    const result = coverage(hand, [S1, broken]);
    expect(result.invalidSpecs).toMatchObject([
      { path: 'specs/broken.yaml', error: { code: 'BLOCK_STIMULUS_MISSING' } },
    ]);
    expect(result.specs.map((entry) => entry.id)).toEqual(['s1']);
  });
});
